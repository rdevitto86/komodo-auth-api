# Data Model — Komodo Auth API

> **Status:** Frozen for V1 — 2026-06-12. Auth-api holds **no durable user data** — user records, email→ID mapping, and passkey credential public keys live in `komodo-customer-api`. Everything here is ephemeral TTL'd operational state or service-owned secrets.

## Redis (ElastiCache)

Key prefixes from `internal/db/cache.go`. All keys self-expire; no manual cleanup.

| Key | Value | TTL | Purpose |
|---|---|---|---|
| `otp:<email>` | 6-digit code | 5 min | Pending OTP; single-use — deleted on successful verify, redemption serialized by an atomic `SetNX` claim (Phase 8a; no `GETDEL` dependency) |
| `otp:attempts:<email>` | counter | co-expires with OTP | INCR-first attempt cap (max 5, then 429); deleted on success |
| `otp:cooldown:<email>` | sentinel | 60s (`db.OTPCooldownSeconds`) | `SETNX` re-request throttle; conflict → 429 + `Retry-After` |
| `otp:redeemed:<email>` | sentinel | 5 min | Atomic `SetNX` redemption claim preventing double-redeem of OTP codes |
| `revoked:jti:<jti>` | sentinel | remaining token lifetime | Revocation denylist — consulted by introspect, validate, refresh |
| `revoked_family:<family_id>` | sentinel | remaining refresh token lifetime | Family reuse revocation — all tokens in the family are rejected |
| `authcode:<code>` | JSON `AuthCodeEntry` (`client_id`, `redirect_uri`, `scope`, `user_id`, `code_challenge`) | 10 min | Single-use authorization code for the `authorization_code` grant; stored via `SetNX` |
| `webauthn:reg:<USER#id>` / `webauthn:login:<ceremony-uuid>` *(Phase 3b)* | go-webauthn `SessionData` | 5 min | Single-use ceremony state (ADR 002 §5); same atomic `SetNX` redemption claim as OTP (Phase 8a) |

## Secrets Manager

| Secret | Shape | Notes |
|---|---|---|
| Service config blob (`AWS_SECRET_PATH`) | JSON map of all config keys | Loaded at cold start, exported to process env; exit on failure |
| JWT signing keys | flat `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY` / `JWT_KID` in the config blob; in-process **active + previous** pair on rotation | Hot-reloaded via `secretsmanager.Watch`; migration to a single JSON keyset secret (`{activeKid, keys[]}`) is the ADR 003 target shape |
| `REGISTERED_CLIENTS` | `{ "<client-id>": { name, secret_hash, allowed_scopes: [], allowed_audiences: [], allowed_redirect_uris: [] } }` | Fail-closed: empty `allowed_scopes` ⇒ deny all; explicit `"*"` for wildcard. `allowed_redirect_uris` validated by the `authorization_code` grant. Secrets stored as SHA-256 hashes (`secret_hash`); registry is hot-reloaded via Watch |
| `WEBAUTHN_RP_ID` | string | Relying party ID for WebAuthn ceremonies (per-environment) |
| `WEBAUTHN_ORIGINS` | string | Allowed origins for WebAuthn ceremonies (per-environment) |

## DynamoDB — banned customers (read-only)

| Attribute | Type | Notes |
|---|---|---|
| PK | `EMAIL#<email>` | |
| `reason`, `banned_at`, `banned_by` | string | |
| `expires_at` | number (TTL) | optional — temporary bans |

Consulted before any user-token issuance (OTP request wired; remaining paths per TODO).

## JWT Claims

| Claim | Content |
|---|---|
| `iss` | `JWT_ISSUER` |
| `aud` | per-service (M2M) or user audience — plane-separation enforcement |
| `sub` | bare UUID for user tokens (no `USER#` prefix, no email, no guest); `client_id` for M2M |
| `scp` | scopes array — M2M: `svc:<client_id>` + granted scopes; OTP-issued: `otp:verified` |
| `azp` | authorized party — the `client_id` that requested the token; required on all refresh tokens; refresh endpoint verifies presenting client matches |
| `family_id` | refresh token family ID for reuse detection; all rotated refresh tokens in a chain share the same `family_id` |
| `jti` | revocation handle |
| `exp`/`iat` | per token-lifetime table (PRD) |
| header `kid` | active signing key ID |
