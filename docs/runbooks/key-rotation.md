# JWT Signing Key Rotation

## When to rotate

| Trigger | Urgency | Notes |
|---------|---------|-------|
| Scheduled (quarterly recommended) | Normal | Plan during low-traffic window |
| Key compromise | Emergency | See [Emergency Rotation](#emergency-rotation-compromised-key) |
| kid collision | Immediate | Extremely unlikely with UUIDs; treat as emergency if it occurs |

## Pre-rotation checklist

1. Verify JWKS endpoint is healthy:
   ```bash
   curl -s https://auth.<env>.komodo.com/.well-known/jwks.json | jq '.keys | length'
   ```
2. Record the current active `kid`:
   ```bash
   curl -s https://auth.<env>.komodo.com/.well-known/jwks.json | jq -r '.keys[0].kid'
   ```
3. Confirm you have AWS Secrets Manager write access to `komodo/<env>/auth-api`
4. Confirm the auth-api containers are running and `secretsmanager.Watch` is active (check logs for recent poll entries)

## Rotation steps

### 1. Generate a new RSA-2048 keypair

```bash
NEW_KID=$(uuidgen | tr '[:upper:]' '[:lower:]')

openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -outform PEM -out new-private.pem

openssl pkey -in new-private.pem -pubout -outform PEM -out new-public.pem

echo "New kid: $NEW_KID"
```

Verify the key:
```bash
openssl rsa -in new-private.pem -check -noout
```

### 2. Update Secrets Manager

```bash
ENV=production  # or staging, dev

aws secretsmanager put-secret-value \
  --secret-id "komodo/${ENV}/auth-api" \
  --secret-string "$(jq -n \
    --arg priv "$(cat new-private.pem)" \
    --arg pub  "$(cat new-public.pem)" \
    --arg kid  "$NEW_KID" \
    '{JWT_PRIVATE_KEY: $priv, JWT_PUBLIC_KEY: $pub, JWT_KID: $kid}'
  )"
```

### 3. Wait for hot reload

The service picks up the new secret via `secretsmanager.Watch` (no restart needed). `Keys.Reload()` promotes the current active key to `previous` and loads the new key as `active`. Both keys are now served by the JWKS endpoint.

Watch logs for the reload confirmation:
```bash
# CloudWatch or docker logs
grep -i "reload\|rotation\|kid" <log-source>
```

### 4. Verify

Confirm JWKS publishes two keys:
```bash
curl -s https://auth.<env>.komodo.com/.well-known/jwks.json | jq '.keys | length'
# Expected: 2
```

Confirm the new kid is active (first key in the array):
```bash
curl -s https://auth.<env>.komodo.com/.well-known/jwks.json | jq -r '.keys[0].kid'
# Expected: $NEW_KID
```

Issue a test token and verify it carries the new kid:
```bash
TOKEN=$(curl -s -X POST https://auth.<env>.komodo.com/v1/oauth/token \
  -d grant_type=client_credentials \
  -d client_id=<test-client> \
  -d client_secret=<test-secret> | jq -r '.access_token')

echo "$TOKEN" | cut -d. -f1 | base64 -d 2>/dev/null | jq '.kid'
# Expected: $NEW_KID
```

### 5. Clean up local key material

```bash
shred -u new-private.pem new-public.pem
```

## Overlap window

The old key remains in JWKS as `previous` until the next rotation (or manual removal). All tokens signed with the old kid remain valid until their natural expiry. Consumer SDKs (forge-sdk `JWKSVerifier`) refetch JWKS on kid cache miss, so the transition is transparent.

| Token type | TTL | Max overlap needed |
|------------|-----|-------------------|
| User access token | 30 min | 30 min |
| M2M access token | 1 hour | 1 hour |
| Refresh token | 30 days | 30 days |

Do not remove the old key from JWKS until at least 30 days after rotation (the longest-lived refresh token TTL). With the current two-slot implementation, the old key is automatically displaced on the *next* rotation — so spacing rotations at least 30 days apart guarantees no valid token becomes unverifiable.

## Emergency rotation (compromised key)

Follow all steps above, then additionally:

1. **Revoke all active refresh token families.** This forces every user and M2M client to re-authenticate:
   ```bash
   # Option A: revoke known families individually via the revoke endpoint
   curl -X POST https://auth-internal.<env>.komodo.com:7012/v1/oauth/revoke \
     -u <client-id>:<client-secret> \
     -H 'Content-Type: application/json' \
     -d '{"token": "<refresh-token>"}'

   # Option B: flush the Redis revocation keyspace (nuclear — all cached state lost)
   redis-cli -h <redis-host> KEYS "revoked_family:*"  # inspect first
   redis-cli -h <redis-host> FLUSHDB                   # if justified
   ```

2. **Access token exposure window.** Access tokens signed with the compromised key remain valid until expiry. TTLs:
   - User tokens: 30 minutes (`accessTokenTTL = 3600` is 1h in code, but user-facing OTP flow uses `userAccessTTL` — verify the active constant)
   - M2M tokens: 1 hour

   **Trade-off:** flushing Redis and waiting for access token expiry is simpler but leaves a window. For a confirmed key compromise, the window may be acceptable given the short TTLs. For high-severity compromise, notify downstream services to temporarily reject all tokens (circuit-breaker) while the rotation completes.

3. **Notify downstream consumers** to re-fetch JWKS immediately (clear their local cache). Forge-sdk consumers do this automatically on kid mismatch, but non-SDK consumers may need manual intervention.

4. **File an incident report** per the [incident response runbook](./incident-response.md).

## Rollback

If the new key causes issues:

1. Re-upload the previous key material to Secrets Manager:
   ```bash
   aws secretsmanager put-secret-value \
     --secret-id "komodo/${ENV}/auth-api" \
     --secret-string "$(jq -n \
       --arg priv "$(cat old-private.pem)" \
       --arg pub  "$(cat old-public.pem)" \
       --arg kid  "<old-kid>" \
       '{JWT_PRIVATE_KEY: $priv, JWT_PUBLIC_KEY: $pub, JWT_KID: $kid}'
     )"
   ```
2. The service hot-reloads and re-promotes the old key as active.
3. Tokens signed with the briefly-active new key will fail verification once the new key falls out of the two-slot window (next rotation). If those tokens must be invalidated immediately, revoke them individually or by family.

**Prerequisite:** you must have retained the old key material. Always archive the previous keypair in a secure location before rotation.
