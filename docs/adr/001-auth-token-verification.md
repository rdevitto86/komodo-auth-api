# ADR 001 — Auth Token Verification Pattern

- **Status:** Accepted
- **Date:** 2026-06-12 (drafted 2026-06-03)
- **Deciders:** rad
- **Supersedes:** —

## Context

Every Komodo service must decide how to verify bearer JWTs on inbound requests. The naive pattern — calling `POST /v1/oauth/introspect` on every request — was rejected: it makes auth-api a synchronous single point of failure for the entire platform and adds a ~5–10ms RTT tax to every consumer request on the hot path. The auth-api must sit on the issuance path only, not the per-request path.

## Decision

**Phase 1 (now):** consumers verify RS256 JWTs **locally** via forge-sdk `auth.JWKSVerifier`. The SDK caches public keys by `kid`, resolves the verifying key from the token header, and re-fetches JWKS once on a cache miss — key rotation is handled transparently, and no Redis or network hop is required at request time.

**Phase 2 (when Redis is in the consumer infra budget):** add a local in-process bloom-filter JTI denylist, background-refreshed from Redis, to close the revocation gap for long-lived tokens without reintroducing a per-request network hop.

## Consumer Contract

- Inject `auth.Verifier` (forge-sdk); never call introspect on the request hot path.
- `POST /v1/oauth/introspect` remains available for opaque tokens, revocation-sensitive decisions, and debugging only.
- Services obtain their own M2M tokens via the `client_credentials` grant (`http/client.WithServiceAuth`); auth-api alone self-mints (issuer exception).

## Revocation SLA

Local verification cannot see revocations until token expiry; the accepted lag per token type:

| Token type | Revocation SLA |
|---|---|
| User access (OTP/passkey) | accept TTL window for Phase 1 (30-min TTL — PRD decision 2026-06-12) |
| M2M access | 30s (short cache + 1h TTL) |
| Refresh | immediate at next use — refresh always hits auth-api, which checks the JTI denylist and rotates |

## Consequences

- Auth-api availability affects logins and refreshes, never steady-state request verification.
- The revocation lag above is a deliberate trade; anything needing immediate revocation must consult introspect explicitly or wait for the Phase 2 bloom denylist.
- JWKS availability matters at key-flip time only (consumer caches + one-shot refetch absorb normal downtime); CloudFront fronting (V2) removes even that.
- Refresh-token rotation-on-use (TODO Phase 2) gives replay detection without changing this pattern.
