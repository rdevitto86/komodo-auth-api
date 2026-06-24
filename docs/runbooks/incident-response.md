# Auth-API Incident Response & Emergency Revocation

## Severity classification

| Severity | Condition | Impact |
|----------|-----------|--------|
| **P1** | Signing key compromised | Attacker can forge tokens for any user/service |
| **P1** | Auth-api down (both containers) | No new logins, no token issuance, no token refresh |
| **P2** | Redis down | OTP unavailable, refresh revocation checks fail-closed (deny all refreshes), JTI revocation not enforced on introspect |
| **P2** | Elevated 5xx rate (>5% sustained) | Degraded auth for subset of requests |
| **P3** | Single-endpoint degradation | Partial feature loss (e.g., passkey registration down, introspect slow) |
| **P3** | OTP abuse spike | Credential stuffing or brute-force attempt |

## Immediate actions by severity

### P1: Signing key compromised

1. **Rotate the signing key immediately.** Follow the [emergency rotation procedure](./key-rotation.md#emergency-rotation-compromised-key).
2. Revoke all active refresh token families (see [Emergency revocation](#emergency-token-revocation) below).
3. Notify downstream services to re-fetch JWKS — forge-sdk consumers auto-refetch on kid mismatch; non-SDK consumers need manual cache clear.
4. Access tokens remain valid until their TTL expires (up to 1 hour for M2M, shorter for user tokens). Evaluate whether to instruct downstream services to reject all tokens temporarily.
5. Engage security team. Preserve all logs.

### P1: Auth-api down

Triage in this order:

1. **Container health:**
   ```bash
   aws ecs describe-services --cluster komodo-<env> --services auth-api
   # local/dev: docker ps --filter "name=auth-api"
   ```

2. **Check logs for panic/OOM:**
   ```bash
   docker logs auth-api-public --tail 200
   docker logs auth-api-private --tail 200
   # CloudWatch: filter by service=komodo-auth-api, level=ERROR|FATAL
   ```

3. **Secrets Manager accessibility:**
   ```bash
   aws secretsmanager get-secret-value --secret-id "komodo/<env>/auth-api" --query 'Name' --output text
   ```

4. **Redis reachability:**
   ```bash
   redis-cli -h <redis-host> PING
   ```

5. **Network:**
   - Security group rules (ports 7011 public, 7012 private/internal)
   - DNS resolution for service discovery
   - Load balancer target health

6. **Restart containers:**
   ```bash
   aws ecs update-service --cluster komodo-<env> --service auth-api --force-new-deployment
   # local/dev: docker compose restart auth-api-public auth-api-private
   ```

7. **Verify recovery:**
   ```bash
   curl -f http://localhost:7011/health
   curl -f http://localhost:7012/health
   ```

If persistent after restart: check for recent deploy changes, secret format corruption, or resource exhaustion (disk, memory, file descriptors).

### P2: Redis down

**Impact:**
- OTP login flow is unavailable (`GenerateAndStoreOTP`, `VerifyOTP` fail)
- Refresh token grants fail-closed — `refreshRevocationDenied` returns an error on cache failure, denying all refresh attempts
- JTI revocation is not enforced (new revocations cannot be stored; existing revocations cannot be checked)
- WebAuthn session storage is unavailable (passkey registration/login broken)

**Actions:**

1. **Diagnose Redis:**
   ```bash
   redis-cli -h <redis-host> PING
   redis-cli -h <redis-host> INFO server
   ```

2. **Check ElastiCache/Redis service status** in AWS console or CLI.

3. **Restore Redis.** If a failover replica exists, promote it. If not, restart the Redis instance.

4. **Verify recovery:**
   ```bash
   curl -f http://localhost:7011/health
   # Health endpoint calls CacheClient.Reachable() which runs an EXISTS check
   ```

5. OTP codes issued before the outage are lost (TTL-based, in-memory in Redis). Users with pending OTP flows must restart.

### P3: OTP abuse spike

1. **Check rate-limiting metrics.** OTP rate limiting is in-process: 5 attempts max, 60-second cooldown per email (`MaxOTPAttempts = 5`, `OTPCooldownSeconds = 60`).

2. **Check 429 response rate** in CloudWatch or access logs.

3. **If sustained beyond rate limits:**
   - Check WAF rules for the auth-api ALB
   - Add offending IPs to the `IP_BLACKLIST` secret key in Secrets Manager (the public container loads this via `sdkconfig.IP_BLACKLIST`)
   - Consider temporarily increasing the OTP cooldown (requires code change and deploy)

4. **If distributed (many IPs):** engage security team for WAF rule update or CloudFront geographic restrictions.

## Emergency token revocation

### Single token

Use the revoke endpoint on the private/internal port:
```bash
curl -X POST http://auth-internal.<env>:7012/v1/oauth/revoke \
  -u <client-id>:<client-secret> \
  -H 'Content-Type: application/json' \
  -d '{"token": "<the-token-string>"}'
```
This parses the token, extracts its JTI, and stores it in Redis with a TTL matching the token's remaining lifetime.

### Single refresh token family

Identify the family ID from logs or by decoding the refresh token:
```bash
echo "<refresh-token>" | cut -d. -f2 | base64 -d 2>/dev/null | jq '.family_id'
```

Store the family revocation directly in Redis:
```bash
redis-cli -h <redis-host> SET "revoked_family:<family-id>" "1" EX <ttl-seconds>
```
Use the refresh token's remaining TTL (max 30 days = 2592000 seconds). All tokens in the family will be rejected on the next refresh attempt.

### All refresh tokens for a client

No bulk-revoke-by-client endpoint exists yet. Options:

1. **Redis key scan** (use with caution in production):
   ```bash
   redis-cli -h <redis-host> --scan --pattern "revoked_family:*"
   ```
   This only shows already-revoked families. To revoke all families for a client, you need to identify them from logs or token introspection.

2. **Rotate the client's secret** in the client registry — the client can no longer authenticate to refresh, so existing refresh tokens become useless.

3. **File a ticket** for the bulk-revoke-by-client endpoint (not yet built).

### Nuclear option: signing key rotation

Rotate the signing key and remove the old key from JWKS. All tokens signed with the old kid become unverifiable immediately. This affects every user and every service.

**Use only when:** confirmed key compromise, or a broad token leak where individual revocation is impractical.

Follow the [key rotation runbook](./key-rotation.md). After rotation, the old key remains in JWKS (two-slot overlap) — to force immediate invalidation, you must perform a *second* rotation to push the compromised key out of both slots.

## Post-incident

1. **Preserve logs.** Ensure CloudWatch log group retention is set (default: check current retention policy). Export relevant time ranges if needed.

2. **Timeline.** Document:
   - Detection time
   - First response action
   - Mitigation time
   - Full resolution time

3. **Root cause analysis.** Identify what failed, why, and what prevented faster detection/resolution.

4. **Action items:**
   - Update this runbook with lessons learned
   - File tickets for any missing tooling (bulk revocation, alerting gaps, monitoring blind spots)
   - Review and update alerting thresholds if detection was slow

5. **Communication.** Notify affected downstream service owners with:
   - What happened
   - Impact window
   - Whether any action is needed on their side (e.g., cache clear, token re-fetch)
