# ADR 004 — V1 Phased Implementation Plan

- **Status:** Active (Phases 0–6, 8, 8a, 8c, 9b complete; 7 partial — CI/deploy/edge/observability done, runbooks/k6/certs open; 9a deploy blockers open; 9c partially resolved (log-redaction audit, CDK alarms, azp cleanup done; Route53/DNS, k6 baseline, runbooks open); 8b cross-repo deferred, non-blocking)
- **Date:** 2026-06-17 (retrospective; work began 2026-05-17)
- **Deciders:** rad
- **Supersedes:** —
- **Related:** ADR 001 (token verification), ADR 002 (passkeys), ADR 003 (key rotation)

## Context

The auth-api is the single token issuer for the Komodo platform, holding the private signing key while every other service is verify-only (ADR 001). V1 takes the service from initial OTP implementation to production-ready with passkey login, refresh-token security, and operational hardening — all pre-prod (zero live consumers), which means breaking changes are free and the sequencing optimizes for risk reduction, not backward compatibility.

The work is organized into Phases 0–8c, sequenced by risk (0–3 first), with interleaving where dependencies allow (4–6 parallel, 3b parallel with 4); Phases 8/8a are post-audit remediation added 2026-06-17, 8b is a cross-repo SDK / standardization track, and 8c is the deferred authorization_code/PKCE grant (both 8b and 8c non-blocking for V1). Every phase exits on the same gate: `go build ./... && go vet ./... && TEST_TIER=component go test -race ./...` green.

## Phase Overview

| Phase | Name | Status | Resolved | Gate commit |
|---|---|---|---|---|
| 0 | Foundation (token centralization) | ✅ | 2026-06-09 | `122a8e7` |
| 1 | Security correctness | ✅ | 2026-06-20 | `9f263b8` |
| 2 | Robustness & correctness plumbing | ⚠️ Partial (SDK MGET only) | — | `38e7e4d` |
| 3 | Operational hardening | ✅ | 2026-06-14 | `38e7e4d` |
| 3b | Passkeys / WebAuthn | ✅ | 2026-06-14 | `3516245` |
| 4 | Testing retrofit | ✅ | 2026-06-21 | `e49eb36` |
| 4b | Coverage enforcement | ✅ | 2026-06-21 | `5b92879` |
| 4c | OpenAPI 3.1 migration | ✅ | 2026-06-15 | `e49eb36` |
| 5 | Docs + cross-repo closure | ✅ Auth-api | 2026-06-17 | `beee313` |
| 5a | Passkey session refresh | ✅ | 2026-06-16 | `beee313` |
| 5b | Family reuse revocation | ✅ | 2026-06-17 | `c23dab7` |
| 6 | Build/config alignment | ✅ | 2026-06-21 | — |
| 7 | Production launch readiness | ⚠️ Partial (see open items) | — | — |
| 8 | V1 audit remediation | ✅ | 2026-06-17 | `bf2332b` |
| 8a | Push to 9/9 + DEV 100% (in-repo) | ✅ | 2026-06-20 | — |
| 8b | SDK primitives + standardization review (cross-repo, non-blocking) | Open | — | — |
| 8c | authorization_code + PKCE-S256 grant (flag-gated, off in prod) | ✅ | 2026-06-22 | `2ddfa43` |
| 9 | Production deployment readiness | ⚠️ Partial (9b done; 9a open; 9c partial) | — | — |

**Local/dev ready** achieved 2026-06-16 (Phases 0–3b, 4, 4b, 4c complete). **Prod ready** = local/dev ready + Phase 7 remaining items (runbooks, k6, passkey prod params, ACM certs, remaining observability) + Phase 5 cross-repo closure.

---

## Phase 0 — Foundation (token centralization)

**Commits:** `c630e00` → `122a8e7`

Internalized token minting from the universal forge-sdk into `internal/jwt` (instance-based, injected). Established auth-api as the sole private-key holder; all other services verify-only via `auth.JWKSVerifier` (ADR 001).

**Key deliverables:**
- OTP request/verify endpoints (`POST /v1/otp/request`, `POST /v1/otp/verify`)
- `client_credentials` grant with form-encoded + JSON support, RFC 6749 snake_case responses
- Signing key sourced from Secrets Manager, injected (never env, never logged)
- `secretsmanager.Watch` wired for rotation; `Signer`/`TokenAuthority` interface seam for V2 KMS
- Core dumps disabled via `security/os/host.DisableCoreDumps()` (forge-sdk v0.17.1)
- JTI revocation denylist (`StoreRevoked` on `/v1/oauth/revoke`, TTL = remaining lifetime)
- Multi-`kid` JWKS rotation overlap window (ADR 003)
- M2M tokens carry `svc:<client_id>` scope + per-service `aud`
- Self-minting exception: auth-api uses `getOrRefreshSvcJWT` rather than calling its own token endpoint

## Phase 1 — Security correctness

**Commits:** `9f263b8`, `ca769df`

In-process security hardening with no infra dependencies.

**Delivered:**
- Atomic OTP attempt counter with rate limiting (`MaxOTPAttempts = 5`)
- OTP cooldown enforcement (`OTPCooldownSeconds = 60`)
- Guest-login removal: `POST /v1/otp/verify` returns 401 for unresolved emails (no email-as-subject fallback)

**Still open (moved to Phase 8a — NOT SDK-blocked):**
- Atomic OTP single-use redemption. The `Get→compare→Delete` double-redeem window remains exploitable under concurrent requests, but the original "blocked on forge-sdk-go `GetDel`/`Eval`" framing was **wrong** (corrected 2026-06-17): an atomic `SetNX` redemption claim closes it in-process today, using a primitive the SDK already exposes. Tracked + fixed under Phase 8a P0.

## Phase 2 — Robustness & correctness plumbing

**Commits:** `38e7e4d`, `20737b9`, `df38183`–`ccc27d9`

Context threading, error handling, layered restructuring.

**Delivered:**
- Restructured into `internal/api`/`db`/`clients` layers
- Context propagation through all cache and HTTP paths
- Goroutine bounding on async email sends (semaphore)
- Body-cap enforcement on HTTP client responses
- Client registry with hot-reload + secret-hash compare (`bcrypt` → SHA-256 for non-password secrets)
- Verb-phrase error strings across all packages

**Still open (low priority):**
- Redis pipelining (`MGET`) — blocked on SDK
- Pre-existing broken integration test (`TestOAuthTokenHandler_Integration_RefreshToken_ValidNonRevoked`)
- Comment doctrine violations in `otp.go` and `clients/comms.go` / `clients/user.go`

## Phase 3 — Operational hardening ✅

**Commits:** `38e7e4d`

**Delivered:**
- Idempotency on `POST /v1/otp/request` (`IDEMPOTENCY_TTL_SEC`)
- `MAX_CONTENT_LENGTH` enforcement on every public POST endpoint

## Phase 3b — Passkeys / WebAuthn ✅

**Commits:** `3516245`, `beee313`

**Delivered:**
- Passkey registration ceremony (`/v1/passkeys/register/begin`, `/v1/passkeys/register/complete`)
- Passkey login ceremony (`/v1/passkeys/login/begin`, `/v1/passkeys/login/complete`)
- Sign-count regression = log-and-allow via go-webauthn `CloneWarning` (ADR 002)
- Subject format standardized to bare UUID (2026-06-16, `beee313`)

## Phase 4 — Testing retrofit ✅

**Commits:** `5b92879`, `e49eb36`

**Delivered:**
- gomock v0.6.0 mocks → `internal/testutil/mocks/` (`generate-mocks` Makefile target)
- `testcontainers-go` + `modules/redis` for integration tests (`newIntegrationCacheClient`)
- Makefile test tiers: `test` / `test_component` / `test_integration` / `test_e2e` / `test_unit`
- `.golangci.yaml` v2 schema
- Integration + E2E coverage (`internal/api/integration_test.go`, `e2e/chain_test.go`)
- Table-driven subtests across OTP/OAuth tests

**Decisions carried:**
- `fakeEC` stays over `MockCacheClientCallers` (exercises real `CacheClient` logic)
- Canned-value `&fakeHttpClient{}` stubs; gomock only for error-injection / call-count assertions
- LocalStack/Secrets Manager testcontainers deferred until a test exercises SM

**Still open (gated on Phase 7 CI):**
- `go test -race` in CI
- Migrate pre-existing integration tests from `localhost:6379` to testcontainers
- Narrow gosec suppressions to `_test.go` path scope

### Phase 4b — Coverage enforcement ✅ (local)

**Commits:** `5b92879`

All per-package floors met at component tier (oauth 94% / webauthn 94% / jwt 88% / db 89% / clients 83% / api 81%). CI wiring of the 80% floor gated on Phase 7.

### Phase 4c — OpenAPI 3.1 migration ✅

**Commits:** `e49eb36`

Migrated all three specs to OpenAPI 3.1.2. `oapi-codegen` pinned to PR #2336 head (native 3.1 support). Fleet generator decision: stay on oapi-codegen, types-only, hand-rolled handlers.

## Phase 5 — Docs + cross-repo closure (auth-api complete)

**Commits:** `beee313`, `c23dab7`

### Phase 5 (base) — Refresh-path banned check + cross-service verification

**Delivered (2026-06-16):**
- Refresh-path banned check fixed: `GetUserByID(uuid)→email` client method; refresh discriminates user vs service by `svc:` scope; calls `IsBanned(email)` for users (fail-open)
- `komodo-customer-api` credentials contract verified; bare-UUID standard ratified
- README and docs corrected to bare-UUID standard

**Cross-repo items (tracked, not auth-api work):**
- comms-api `otp` template store — blocked (comms-api has no template store)
- ui/ snake_case type regen — zero blast radius (auth.ts is empty); tracked in `ui/TODO.md`
- ui/ guest-OTP-login audit — forward constraint; tracked in `ui/TODO.md`
- customer-api `password_hash` `omitempty` — cosmetic, next customer-api touch

### Phase 5a — Passkey session refresh ✅

**Delivered (2026-06-16, swe→QA PASS):**
- `azp` (authorized-party) claim on `CustomClaims`; `SignTokenWithAZP` mint path
- `PasskeyLoginBeginRequest` gains required `client_id` (BREAKING); begin validates against `Registry.Get`
- Refresh endpoint validates `azp` instead of `subject == client_id`; backward-compat fallback for pre-5a tokens
- Rotated access token subject fixed to `claims.Subject` (was `reqBody.ClientId`)
- Ban-on-refresh gate now reachable for user tokens

**Key decision:** `ParseClaims` confirmed safe for refresh tokens — golang-jwt/v5 rejects expired tokens by default; switching to `ValidateAndParseClaims` would break refresh (pins single configured audience). Locked by regression test.

### Phase 5b — Refresh-token family reuse revocation ✅

**Delivered (2026-06-17, swe→QA PASS):**
- `family_id` claim on `CustomClaims`; `SignRefreshToken` stamps at issuance (passkey login, client_credentials offline_access, rotation)
- `refreshRevocationDenied` checks both jti revocation and family revocation
- On reuse detection (revoked jti + family_id present): `StoreRevokedFamily` revokes entire family
- `revoked_family:<id>` Redis key with TTL = remaining token lifetime
- 3 component tests: reuse→family revocation, family-revoked rejection, family ID propagation through rotation

**Design decision:** dedicated `revoked_family:<id>` key checked alongside the jti denylist (not extending the denylist with a family dimension). Simpler, same O(1) lookup cost.

**Key decision (5B):** OTP login stays short-lived — no refresh token. Passkey (5a) is the durable-session credential; re-auth via fresh email code on 30-min lapse is intended.

## Phase 6 — Build/config alignment (open)

**Scope:**
- Delete dead Makefile `run` per-ENV `ifeq` machinery (compose doesn't interpolate the exported vars)
- Resolve secret-path convention clash: `komodo-auth-api/<env>/all-secrets` (local) vs `komodo/<env>/auth-api` (AWS)
- Fix README Quick Start local secret path
- Makefile nits: missing `.PHONY` targets, dead `clean` rm, `ENV=dev` LocalStack ambiguity

## Phase 7 — Production launch readiness (open)

**Scope (all high/medium priority):**
- **[H]** CI merge gate: build / vet / golangci-lint / `TEST_TIER=component go test -race` / govulncheck / `make generate-check` / per-package 80% coverage floor
- **[H]** Deploy scripts: `deploy/deploy_staging.sh` + `deploy_prod.sh` + prod secrets seeding runbook
- **[H]** Edge infra: CloudFront + WAF, TLS cert + launch domain, security groups locking :7012 to VPC
- **[H]** Observability: CloudWatch dashboards + alarms (issuance error rate, OTP abuse signals, Redis reachability, 5xx rate, JWKS availability); log redaction audit
- **[M]** Runbooks: key-rotation (ADR 003) + emergency revocation/incident procedure
- **[M]** k6 measured baseline: `/v1/otp/verify`, `/v1/oauth/token`, passkey assertion
- **[M]** Passkey prod parameters: final RP ID/origins (needs launch domain, ADR 002)

## Phase 8 — V1 audit remediation ✅ (blockers resolved)

**Commit:** `bf2332b` (2026-06-17)

End-to-end readiness audit (code read + `build`/`vet`/component-`-race` + local CI-gate reproduction) — the delta between "docs say done" and actual state. The three blockers are fixed: refresh rotation no longer leaks a `svc:` scope into user tokens (user-session scope gating), the passkey-register transports bug (leading empty strings), and the CI coverage gate (was parsing per-function and counting generated `mocks/` at 0% → fixed to per-package with documented exclusions). Six hardening items (negative tests, doc reconcile, nil-guard symmetry) were partially addressed; the residue rolls into 8a. Itemized list lives in `TODO.md` (Phase 8).

## Phase 8a — Push to 9/9 + DEV 100% (in-repo; open)

The in-repo delta to lift every readiness category to ~9/10 and DEV to ~100%, **excluding** external deps (comms-api template store, customer-api contract, AWS edge infra / WAF / SG, KMS). Itemized + sequenced P0→P2 in `TODO.md` (Phase 8a); the ADR records only the headline correction:

- **OTP single-use is NOT SDK-blocked.** Phases 1 and the original "SDK capability finding" framed single-use redemption as blocked on a forge-sdk `GetDel`/`Eval` addition. That was wrong: an atomic `SetNX` redemption claim (already used for the OTP cooldown) closes the `Get→compare→Delete` double-redeem window in-process today. The same `SetNX` claim closes single-use passkey ceremony state. This reverses the Phase 1 "accepted SDK-blocked trade" — see the corrected Consequences bullet below.

## Phase 8b — SDK primitives + standardization review (cross-repo; non-blocking)

A parallel quality / standardization track in `komodo-forge-sdk-go`, sequenced after 8a: implement the demoted-to-convenience redis primitives, release, repin, refactor. The concrete asks — `GetDel` (for the `authorization_code` single-use exchange, **not** a replacement for the OTP `SetNX` claim, which would reintroduce a wrong-guess DoS), `MGET` (one-RTT OTP-verify saving), and optional `Eval`/Lua — plus a deliberate read of auth-api for genuinely universal code to promote into the SDK under a hard bar (truly universal **and** benefits another app). Strong promotion candidates: the JWT custom-claims schema (`scp`/`azp`/`family_id`, so the fleet decodes claims identically) and a generic `SetNX`-based single-use claim helper. Explicitly excluded: token minting / private-key custody (ADR 001), revocation storage, and OTP/passkey/registry logic. Itemized in `TODO.md` (Phase 8b); not a V1 prod gate.

## Phase 8c — authorization_code + PKCE-S256 grant ✅

**Commit:** `2ddfa43` (2026-06-22)

Carved out of Phase 8a (the in-repo feature item was deferred to its own focused effort, 2026-06-18). `/authorize` issues a code; the `code → {client_id, redirect_uri, scope, code_challenge}` mapping is stored single-use in Redis (`SetNX`, 10-min TTL); `/token` exchanges the code with an S256 `code_verifier` check (RFC 7636) and validates `redirect_uri` against the client registry's `allowed_redirect_uris`. Gated behind `ENABLE_AUTH_CODE_GRANT` (off in prod), so non-blocking for V1; the login-UI / session layer remains external.

## Phase 9 — Production deployment readiness (open; 9b complete)

Added 2026-06-21 from a full readiness assessment. The application code is prod-grade; this phase is the operational last mile — deploy path, data stores, and operational proof.

**9a (deploy blockers):** CI auto-triggers disabled; seed script omits WEBAUTHN secrets (local path fixed 2026-06-22 via `deploy/local/init-secrets.sh`; AWS DEV seed still open); ACM cert ARNs empty; CDK provisions no data stores or IAM grants. All must land before anything reaches AWS.

**9b (logic bugs) ✅ resolved 2026-06-22:** OTP re-login false-reject (cleared stale redemption claim on new issuance); M2M `offline_access` refresh scope stripping (refresh token now carries granted scopes); cross-client user token revocation (azp guard added); OTP-verify goroutine panic recovery (defer recover added); `/health/ready` info leak (generic body, details logged). Gate green.

**9c (operational, partial):** Log-redaction audit, CDK alarms (Redis/JWKS), and empty-azp backward-compat fallback removal are done. Still open: Route53/DNS, dashboards, k6 baseline, runbooks.

**Infra split (2026-06-22):** Auth-api local infra moved to `deploy/local/` (per-service DynamoDB + secrets init scripts). Root LocalStack `run.sh` discovers `apis/*/deploy/local/init.sh` automatically. Auth-api tables + secrets removed from monolithic `infra/local/localstack/init/scripts/`.

## Consequences

- Risk-first sequencing (0–3) ensured security and operational correctness before feature expansion (4–5).
- ~~The SDK capability gap (no `GetDel`/`Eval`) leaves a known OTP double-redeem window (Phase 1); accepted as the correct trade vs. bypassing the SDK.~~ **Corrected 2026-06-17 (Phase 8a):** the window is closable in-process with an atomic `SetNX` redemption claim — `GetDel`/`Eval` are ergonomic conveniences, not correctness prerequisites. The fix is tracked under Phase 8a P0; the SDK gap is no longer an accepted security trade.
- Passkey session refresh (5a) was not in the original plan — it was discovered when the refresh endpoint rejected all user tokens. The phased structure caught the bug (5 depends on 3b; integration tests exposed the gap).
- Family reuse revocation (5b) follows OAuth 2.0 BCP and closes the last refresh-token theft vector within auth-api's control.
- Local/dev ready was achieved at the Phase 4b/4c boundary (2026-06-16); prod ready is Phase 7.
- All auth-api implementation phases (0–5b) have passed the swe→QA cross-review gate.

## Commit History (auth-api)

| Commit | Date | Phase(s) | Summary |
|---|---|---|---|
| `c630e00` | 2026-06-06 | 0 | OTP request/verify endpoints |
| `20737b9` | 2026-06-09 | 0, 2 | Restructure into api/db/clients layers |
| `ca769df` | 2026-06-10 | 1 | Atomic OTP attempt counter + test gaps |
| `fd2864d` | 2026-06-10 | 0 | SDK bump v0.15.1, TEST_TIER gating |
| `df38183`–`ccc27d9` | 2026-06-11 | 2 | OAuth/OTP/db/client refactors |
| `122a8e7` | 2026-06-12 | 0 | Centralize token issuance on forge-sdk v0.17.0 |
| `9f263b8` | 2026-06-12 | 0, 1 | OAuth package restructure + Phase 0/1 hardening + ADRs 001–003 |
| `38e7e4d` | 2026-06-13 | 2, 3 | Phase 2 + Phase 3 (Batch A/B) hardening |
| `b547f55` | 2026-06-13 | 2 | Client-registry hot-reload + secret-hash compare |
| `3516245` | 2026-06-14 | 1–3, 3b | Phase 1–3 hardening + Phase 3b passkey registration |
| `5b92879` | 2026-06-15 | 4, 4a, 4b | Passkey login flow + testing retrofit + build tiers |
| `e49eb36` | 2026-06-15 | 4, 4c | Complete Phase 4 (4c regen + integration/E2E/lint) |
| `beee313` | 2026-06-16 | 5, 5a | Standardize JWT sub on bare UUID — repair passkey login/register |
| `c23dab7` | 2026-06-17 | 5, 5a, 5b | Family reuse revocation + refresh session + comment cleanup + dep refresh |
| `bf2332b` | 2026-06-17 | 8 | Audit remediation — 3 security/correctness blockers + 6 hardening items |
| `2ddfa43` | 2026-06-22 | 8c, 9 | CDK infrastructure via komodo-forge-sdk-ts v0.4.0 + Phase 8 audit + test hardening |
