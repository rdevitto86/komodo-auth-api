# TODO

> **Current Version:** V1 (pre-release). Structure: this file is organized by major version
> (V1/V2/V3), and V1 work is organized into Phases 0–7. Phases 0–3 are sequenced by risk; 4–6 can
> interleave; 3b runs parallel with 4 once Phase 3's registry injection lands; 4b (coverage
> enforcement) starts once Phase 4's mocks/testcontainers land, parallel with 5/6. Every phase
> exits on the same gate: `go build ./... && go vet ./... && TEST_TIER=component go test -race
> ./...` green, plus `golangci-lint run` once the lint config is fixed and the tool is installed
> (Phase 4).

---

## V1 (Pre-release — Current)

### Shipped architecture (context — 2026-06-09, forge-sdk v0.17.0)

> **Architecture decision:** the Auth API is the *single* token issuer and the *only* service that
> holds the private signing key. Every other service is verify-only (`auth.JWKSVerifier`) and
> obtains its own service tokens via the OAuth2 `client_credentials` grant
> (`http/client.WithServiceAuth`). The universal SDK carries **no** private-key code — minting
> lives here, in auth-api. Documented in ADR 001.

- Minting internalized into `internal/jwt` (instance-based, injected); the `crypto/jwt` shim is
  gone and `crypto/oauth` → `security/oauth`. The universal SDK is no longer used for issuance.
- Signing key sourced from Secrets Manager and **injected** (never in env, never logged); core
  dumps disabled via `security/os/host.DisableCoreDumps()` (forge-sdk v0.17.1); `secretsmanager.Watch`
  wired for rotation; a `Signer`/`TokenAuthority` interface seam lets the v2 KMS signer drop in
  without touching call sites.
- Multi-`kid` JWKS rotation overlap window — verification accepts the active **or** previous key
  by `kid`, and `/.well-known/jwks.json` publishes both during the overlap (ADR 003).
- `jti` revocation denylist — `StoreRevoked` on `/v1/oauth/revoke` (TTL = remaining lifetime),
  consulted by introspect, validate, and refresh.
- M2M tokens carry a `svc:<client_id>` scope (for `auth.RequireServiceScope`) and a per-service
  `aud`; `POST /v1/oauth/token` accepts form-encoded **and** JSON `client_credentials` with RFC
  6749 snake_case responses (`access_token`/`token_type`/`expires_in`).

**Deferred by decision:** auth-api keeps **self-minting** its own downstream service token rather
than routing through `WithServiceAuth` — as the issuer it already holds the key, so calling its
own token endpoint over HTTP would be a needless circular round-trip (`getOrRefreshSvcJWT`).
`WithServiceAuth` is the pattern for every *other* (non-issuer) service.

### Latency baseline (reference — modeled 2026-05-17, not measured)

| Endpoint | p50 | p90 | p99 | Dominant cost |
|---|---|---|---|---|
| `GET /health` | <1ms | 1ms | 2ms | — |
| `GET /.well-known/jwks.json` | 1-2ms | 3ms | 5ms | middleware |
| `POST /v1/oauth/token` | 5-10ms | 12-15ms | 20-30ms | RS256 sign × 1-2 |
| `POST /v1/oauth/revoke` | 3-5ms | 6-8ms | 12-20ms | EC Set JTI |
| `POST /v1/otp/request` | 3-5ms | 6-8ms | 12-20ms | EC Set + middleware (SendEmail async) |
| **`POST /v1/otp/verify`** | **20-30ms** | **35-50ms** | **60-100ms** | user-api HTTP + 2× RS256 sign |
| `POST /v1/oauth/introspect` (priv) | 3-5ms | 6-8ms | 12-20ms | EC Get JTI + JWT verify |
| `POST /v1/token/validate` (priv) | 2-4ms | 5-7ms | 10-15ms | JWT verify |
| `GET /v1/clients` (priv) | 1-2ms | 3ms | 5ms | in-mem map |

**Competitive context** (public SaaS / industry benchmarks, order-of-magnitude only):
- Auth0 token: ~30-50ms p50 / ~100-200ms p99 · Cognito: ~30-80ms p50 / ~150-300ms p99 · Stripe
  internal auth: ~10-20ms p50 / ~40-60ms p99.
- Auth0 MFA verify: ~50-80ms p50 / ~150-250ms p99 · Okta MFA: ~50-100ms p50 / ~150-250ms p99.
- Auth0 introspect: ~20-40ms p50 / ~80-150ms p99 · Stripe internal: ~5-10ms p50 / ~20-30ms p99.

**Verdict:** Token / introspect / revoke / JWKS / health are **above industry average** for a
1-engineer service on cost-optimized AWS — don't touch them. OTP verify is **middle of the pack
and sits right at the 100ms perceptual-snappiness threshold at p99** — the one place a 1% tail
spike hurts UX directly (login funnel friction). Address (Phase 7 k6 baseline once deployed).

**Architecture decision (made):** consumers use forge-sdk `auth.JWKSVerifier` for local RS256
verify — not `POST /v1/oauth/introspect` on the hot path. Introspect remains for opaque tokens and
debugging (ADR 001).

### SDK capability finding (gates Phase 1 OTP work)

forge-sdk v0.19.1 (repinned 2026-06-20) `db/redis` exposes `Get`, `Set`, `Incr`, `SetNX`, `Expire`,
`Exists`, `Delete`, `Ping` — but **no `GetDel` and no `Eval`/Lua**. ⚠️ **CORRECTED 2026-06-17 (see Phase 8a):** the
earlier conclusion that single-use OTP redemption is "blocked on an SDK addition" was wrong. `GETDEL`
(atomic get-and-delete) is the *convenient* primitive, not the *only* one — an atomic `SetNX`
redemption claim (`SetNX(otp:redeemed:<email>, …)`, a primitive the SDK already exposes and that
`GenerateAndStoreOTP` already uses for the cooldown, `db/otp.go:16`) closes the Get→compare→Delete
double-redeem window in-process **without** `GetDel`/`Eval`. The same `SetNX` claim closes single-use
passkey ceremony state (Phase 3b). `GetDel`/`MGET` stay SDK-tracked as ergonomic / one-RTT
improvements only — **not** correctness blockers (`komodo-forge-sdk-go/TODO.md`, `db/redis`).

---

### Phase 1 — Security correctness ✅ (resolved — Phase 8a P0, 2026-06-20)

- ✅ **Atomic OTP verify — single-use redemption (2026-06-20, Phase 8a P0).** `SetNX` redemption claim
  implemented in `VerifyOTP`. Concurrent-verify regression test asserts exactly 1/10 succeeds.
  Same `ClaimSession` pattern covers single-use passkey ceremony state.

---

### Phase 2 — Robustness & correctness plumbing

- **[L]** **Redis pipelining: combine `GetAttempts` + OTP `Get` into one `MGET`.** Saves one RTT
  (~1ms). Blocks on SDK `MGET` (already in `forge-sdk-go/TODO.md` aws/elasticache bulk ops). Not
  implemented — SDK-blocked, as noted.
- **[L] ✅ Fixed (2026-06-20):** `TestOAuthTokenHandler_Integration_RefreshToken_ValidNonRevoked`
  rewritten with proper `ClientId`/`ClientSecret` and migrated to testcontainers.
- **[L] ✅ Deleted (2026-06-20):** All multi-line inline comments in `internal/db/otp.go` removed.
- **[L] ✅ Deleted (2026-06-20):** Name-restating function docs on `internal/clients/comms.go`
  `SendEmail` and `internal/clients/user.go` `GetUserCredentials` removed.

---

### Phase 3 — Operational hardening ✅ (resolved 2026-06-14)

Idempotency (`IDEMPOTENCY_TTL_SEC`) on `POST /v1/otp/request` + `MAX_CONTENT_LENGTH` on every public POST. Shipped; no open items.

---

### Phase 3b — Passkeys / WebAuthn ✅ (resolved 2026-06-14)

Register + login ceremonies shipped per ADR 002 (sign-count regression = log-and-allow via go-webauthn `CloneWarning`). Subject format corrected to the bare-UUID standard 2026-06-16 (see Phase 5). No open items.

---

### Phase 4 — Testing retrofit (parallel with 2–3; rebase on their interface changes)

**Shipped (✅ 2026-06-14/16):** gomock v0.6.0 mocks → `internal/testutil/mocks/` (`generate-mocks`
target); `testcontainers-go` + `modules/redis` (`newIntegrationCacheClient`); Makefile test tiers
(`test`/`test_component`/`test_integration`/`test_e2e`/`test_unit`); `.golangci.yaml` v2 schema;
integration + E2E coverage (`internal/api/integration_test.go`, `e2e/chain_test.go`) — the
local/dev-ready gate; table-driven subtests across otp/oauth tests.

**Decisions carried forward (don't re-litigate):**
- `fakeEC` (`db.CacheClientOperations`) stays — it backs `db.NewFromOperations` and exercises
  real `CacheClient` business logic; mocking `CacheClientCallers` directly would re-derive that
  logic as expectations (strictly worse). `MockCacheClientCallers`/`MockTokenAuthority` generated
  but unconsumed; `TokenAuthority` is the candidate once a test needs `SignToken` without a real
  RSA keypair.
- Canned-value `&fakeHttpClient{...}` stubs stay; gomock `EXPECT()` only for error-injection /
  call-count assertions.
- LocalStack/Secrets Manager testcontainers module deferred until a test exercises Secrets
  Manager (only read in `cmd/*` bootstrap today).

**Open:**
- **[L] ✅ Done (2026-06-21).** `go test -race` in CI — both component and integration tiers run with
  `-race` in the `gate-auth-api` job.
- **[L] ✅ Migrated (2026-06-20).** All integration tests (`TestOTPRequestHandler_Integration_*`,
  `TestOTPVerify_Integration_*`, `TestOAuthIntrospectHandler_Integration_*`,
  `TestOAuthTokenHandler_Integration_*`) migrated from `localhost:6379` to testcontainers.
- **[L] ✅ Fixed (2026-06-20).** `TestOAuthTokenHandler_Integration_RefreshToken_ValidNonRevoked`
  rewritten with proper `ClientId`/`ClientSecret` + testcontainers.
- **[L] ✅ CLOSED (2026-06-20).** Gosec narrowing investigated — not viable. `G101`/`G104` fire on
  production code (env-var name constants, URL path constants, intentionally-unhandled calls). Global
  suppression stays. Documented in `.golangci.yaml` rationale.

---

### Phase 4b — Coverage enforcement ✅ local work done (2026-06-15); only CI wiring left (gated on Phase 7)

> Target: **≥80% per package**. Local work complete — all per-package floors met at component tier.
> **Updated 2026-06-20:** api 90.3% / db 89.2% / clients 86.0% / oauth 94% / webauthn 94% / jwt 88%;
> `cmd/*` bootstrap exempt.

**Coverage-floor exclusions (must be encoded when the CI gate lands):**
- `internal/models*` — `oapi-codegen` output + path constants (0% is structural, not a gap).
- `cmd/*` `main` / `loadDependencies` / `configureIdempotencyStore` — bootstrap/I-O orchestration
  with no injection seam (exercised by `make run` / e2e, not unit tests). Covering would require a
  DI refactor purely for coverage.

**Sub-100% survivors, left by decision (not floor blockers):** `db/cache.go` `New`/`Reachable`
(integration-tier only, testcontainers); `db/otp.go` `generateOTPCode` 75% (`crypto/rand` error
path not deterministically triggerable); `clients/comms.go` `SendEmail` 71.4% (async
semaphore-full drop — timing-flaky); `internal/api` `handleRefreshToken` 74.7% / `OTPVerifyHandler`
72.1% / passkey handlers (per-function polish, package over floor).

**Open:**
- **[M] ✅ Done (2026-06-21).** 80% coverage floor wired into CI `gate-auth-api` job. Per-package
  thresholds: 80% default, 70% for `internal/clients`, 75% for `internal/db`. Exclusions:
  `internal/models*`, `internal/testutil/mocks`, `cmd/*`.

---

### Phase 4c — API contract standardization → OpenAPI 3.1 ✅ migration done (2026-06-15); 2 follow-ups

> **Why in V1, not V2:** auth-api is the first prod-ready API and the fleet reference impl; every
> service after it will be authored in 3.1. Migrating the contract was cheapest pre-prod (zero live
> consumers). Hard gate (must precede the Phase 7 `generate-check`/coverage CI merge-gate) is met.

**Outcome — fleet generator decision (carried): stay on oapi-codegen, types-only, hand-rolled
handlers.** Shipped (QA-passed): `OAPI_CODEGEN_VERSION` pinned to PR #2336 head; all three specs on
`3.1.2`; `nullable`→`type:[T,null]`; `contentEncoding: base64url` on WebAuthn blobs; models
regenerated (only delta = inert, unused `xxxContextKey` constants — grep-confirmed zero consumers).

**Deliberately deferred (decision — do not re-add):** `const` on literal fields (`token_type`,
credential `type`, `grant_type`) — oapi-codegen degrades `const` to `interface{}` (worse than plain
string); typed `enum:[X]` would generate a typed constant but break assignments across the ~13
consumers for cosmetic gain. Skip unless a consumer-update pass is in scope. `JWK.n`/`JWK.e` and
`CredentialCreation/AssertionResponseBody.id` left as plain string by decision (JOSE-not-WebAuthn /
go-webauthn types them as opaque `string`).

**Follow-ups:**
- **`make generate-check` ✅ fixed + committed (2026-06-15).** **Carried policy: machine-generated
  `DO NOT EDIT` files (`*.gen.go`, `internal/testutil/mocks/*`) are EXEMPT from the zero-comment
  doctrine** — accept generator output verbatim; exclude from any future comment lint (not yet
  codified in `comments.md`).
- **[M]** **Repin oapi-codegen off the branch pseudo-version** once native 3.1+ support lands in a
  stable oapi-codegen release. The current pin is PR #2336's branch head; latest **stable** is still
  v2.7.1 with no native 3.1, PR #2336 unmerged (checked 2026-06-15). **Gate is the generator, not the
  spec:** OpenAPI **3.2.0** is already final (OAI, 2025-09-19) and strictly 3.1-compatible, but adds
  only `query` method / Tag taxonomy / streaming — none of which we use, and the generator can't
  consume it stably anyway. When the generator ships stable support (likely 3.1+3.2 together, 3.2
  being a strict superset), repin to the release; optionally relabel specs `3.1.2 → 3.2.0` as a
  pure label bump (no 3.2 constructs adopted). Also decide whether the typed `xxxContextKey`
  constants are wanted long-term or worth flagging upstream before the PR merges.
- **[L]** **Fleet ordering constraint:** no *other* service ships on a divergent generator. comms-api
  + user-api specs are now on 3.1.0 (consumed by auth-api's codegen); any service authoring its own
  3.1 contract uses the same pinned generator until the stable release repin above.

---

### Phase 5 — Docs + cross-repo closure (auth-api work complete 2026-06-17; cross-repo items remain)

- **[M] [SECURITY] ✅ Refresh-path banned check fixed (2026-06-16) — correct but currently unreachable for users; activated by 5a.**
  Was dead two ways: stale `USER#` prefix guard (subjects are bare UUIDs now → always false) +
  `IsBanned` passed a UUID to an **email-keyed** lookup (`EMAIL#<email>`, `banned.go:57`). Fix
  shipped (swe→QA PASS, 4 gates green): added `GetUserByID(uuid)→email` client method (existing
  `GET /v1/users/{id}`); refresh path discriminates user vs service by the `svc:` scope and calls
  `IsBanned(email)` for users (fail-open, matching issuance paths `otp.go:50`/`passkeys_auth.go:288`).
  **Caveat that spawned 5a:** the refresh endpoint rejects ALL user tokens at `oauth_token.go:235`
  (`claims.Subject != reqBody.ClientId` — only true for M2M), so no user refresh reaches this check
  today. It's defensive + future-proof (skips M2M correctly) but inert until 5a lands. **Risk was
  overstated earlier:** real ban eviction is ≤30 min (user access TTL=1800s), not 30 days —
  issuance gates already block banned users at login, OTP issues no refresh token, and passkey
  refresh tokens are rejected at line 235. No live 30-day hole existed.

#### Phase 5a — Passkey session refresh ✅ DONE (2026-06-16, swe→QA PASS, 4 gates green)
> Completed the half-built passkey session: passkey login issued a 30-day refresh token the refresh
> endpoint rejected every time (`oauth_token.go:235` checked `subject == client_id`, only true for M2M).
**Shipped (BFF / confidential-client model):**
- `azp` (authorized-party) claim added to `CustomClaims`; new `SignTokenWithAZP` mint path (`SignToken`
  delegates with azp=""); `TokenAuthority` interface + mocks extended.
- Passkey login: `PasskeyLoginBeginRequest` gains a **required** `client_id` (BREAKING to that endpoint;
  openapi.yaml regenerated); begin validates it's a registered client (`Registry.Get`, no secret) and
  stores it on `WebAuthnLoginSession`; complete stamps `azp = session.ClientID` on the refresh token.
- Refresh endpoint: line 235 now rejects `claims.Azp != reqBody.ClientId` (empty-azp → backward-compat
  fallback to `subject == client_id` for pre-5a tokens); M2M + rotated refresh tokens also stamp `azp`;
  rotated **access** token subject fixed to `claims.Subject` (was `reqBody.ClientId`).
- Ban-on-refresh gate (3A) now reachable for user tokens; covered end-to-end by tests.

#### Phase 5a follow-ups (QA cross-review — dispositioned 2026-06-16)
- ✅ **`ParseClaims` expiry concern — FALSE ALARM, resolved via regression test (NOT a code change).**
  Verified empirically: golang-jwt/v5's default validator rejects expired tokens (`ErrTokenExpired`),
  so `ParseClaims` already rejects them; audience is validated downstream via `rec.AllowedAudiences`;
  issuer is bounded by the signing key. Switching to `ValidateAndParseClaims` would BREAK refresh — it
  pins the single configured `ks.aud` while refresh tokens carry varying audiences (user vs M2M). Locked
  in by `TestOAuthTokenHandler_Component_RefreshToken_ExpiredToken_Rejected` (expired azp token → 401,
  not rotated). **Do NOT swap to `ValidateAndParseClaims`.**
- ✅ azp assertion added to the passkey-complete happy path; begin-guard tests added
  (`MissingClientID_Returns400`, `UnknownClientID_Returns401`); misleading ban test fixed to the azp path.
- ✅ **[L]** Empty-azp backward-compat fallback removed (2026-06-22). All pre-5a tokens expired.
- ✅ **Pre-existing comments in `internal/jwt/jwt.go` (field notes) and `passkeys_auth.go:29` (1MB
  annotation) deleted (2026-06-17).** QA PASS.

#### Phase 5b — Refresh-token family reuse revocation ✅ (resolved 2026-06-17, swe→QA PASS)
> Family reuse revocation per OAuth 2.0 BCP "automatic reuse detection." Detected reuse revokes
> the entire token family (theft response), not just the one presented token.
- ✅ `family_id` claim on `CustomClaims`; `SignRefreshToken` stamps it at issuance (passkey login +
  client_credentials offline_access + rotation); `refreshRevocationDenied` checks both jti and
  family revocation; `StoreRevokedFamily`/`IsFamilyRevoked` in `db/tokens.go`; `revoked_family:<id>`
  Redis key with TTL = remaining token lifetime. 3 component tests: reuse→family revocation, family-
  revoked rejection, family ID propagation through rotation. All green with `-race`.

- **[L] ✅ DECISION (2026-06-16): OTP login stays short-lived — NO refresh token (decision 5B).**
  README (line 457) scopes OTP to "authenticate an existing account or verify email during account
  creation" — bootstrap/lightweight login; passkey (5a) is the durable-session credential. Re-auth
  via a fresh email code on the 30-min lapse is intended. Revisit only if OTP is promoted to a full
  persistent login.
- **[M]** **`komodo-communications-api`** — register the `otp` template in the S3 template store.
  **SendEmail body-shape leg ✅ verified (2026-06-16):** `to`/`template_id`/`template_data` align
  byte-for-byte across consumer, comms-api handler, and spec; auth-api sends `template_id:"otp"`
  with `template_data:{code:<6-digit>, ttl:1800}`. **Template registration still OPEN and larger
  than a registration:** comms-api has **no template store at all** yet — only a `StubProvider`
  that logs `template_id` and never resolves it (`internal/provider/provider.go`). "Register the
  otp template" = build the S3 template store + register `otp`; tracked in comms-api's own TODO.
  Not an auth-api edit. OTP email can't deliver end-to-end until comms-api ships this.
- **[M] ✅ `komodo-user-api` credentials contract verified + passkey bug fixed (2026-06-16).** Path is
  `GET /v1/users/credentials`; shape aligns. **Ratified standard (carried): JWT `sub` and all
  cross-service user IDs are the bare UUID; `USER#` is DynamoDB-only.** Passkey register+login (which
  wrongly expected `USER#<uuid>` and 500'd against real data) + all fixtures realigned to bare UUID
  (swe→QA PASS, 4 gates green). Minor open: user-api `password_hash` emits `""` not omitted vs
  spec-optional — add `omitempty` on next user-api touch (cosmetic).
- **[L] ✅ Docs (2026-06-16):** no `docs/README.md` (root README is canonical — decided, don't
  re-raise); README env-table fallback note fixed (no-fallback 503/401) and both `USER#`-as-subject
  refs corrected to the bare-UUID standard.
- **[M]** **`ui/` token-response migration** — update OTP-verify / token consumers from camelCase to
  snake_case (`access_token`, `token_type`, `expires_in`). (Audited 2026-06-16: it's a type-regen
  via `scripts/gen-types.ts`; no live consumer yet — `ui/` `server/auth.ts` is empty. Tracked in
  `ui/TODO.md`.)
- **[M]** **`ui/` — audit for guest-OTP-login assumptions.** Phase 1 (2026-06-12) removed the
  email-as-`sub` fallback: `POST /v1/otp/verify` now returns 401 (`account_not_found`) for any
  email with no resolved `USER#id`, instead of issuing a token with the email as subject ("guest
  login"). Any `ui/` flow that called OTP verify for unauthenticated/guest checkout and expected a
  token back will now get a 401 — audit and update those flows (e.g., route guest checkout away
  from OTP verify entirely).
- ✅ **Routine dep refresh (2026-06-17).** `go get -u ./... && go mod tidy`. Notable:
  `go-webauthn/webauthn` v0.13.0→v0.17.4, AWS SDK minor bumps, `fxamacker/cbor` v2.8→v2.9,
  `redis/go-redis` v9.17→v9.20. Full suite green. **Advisory (QA 2026-06-17):** scan the
  `go-webauthn/webauthn` changelog for behavioral changes in assertion verification before prod
  deploy (4 minor versions is a wide gap).
- **[L] ✅ Negative tests added (2026-06-20, Phase 8a P1).** `refreshRevocationDenied` cache-error
  deny paths now covered by `TestOAuthTokenHandler_Component_RefreshToken_CacheError_IsFamilyRevoked_Returns500`
  and related error-injection tests.

---

### Phase 6 — Build/config alignment ✅ (resolved 2026-06-21)

- ✅ **Makefile `run` env plumbing cleaned (2026-06-20).** Removed dead `AWS_REGION`, `AWS_SECRET_PATH`,
  `AWS_ENDPOINT` top-level vars and per-ENV `ifeq` lines that set them; removed dead compose exports
  (`ENV`, `APP_NAME`, `AWS_REGION`, `AWS_ENDPOINT`, `AWS_SECRET_PATH`). Kept `VERSION`, `LOG_LEVEL`,
  `RESTART_POLICY`, `MEM_LIMIT`, `DISTROLESS_TAG` (all flow through compose interpolation).
- ✅ **Secret-path convention unified (2026-06-21).** Both local and AWS now use `komodo/<env>/<service>`.
  LocalStack init, docker-compose, env.shared, and README all normalized from the old
  `komodo-<service>/<env>/all-secrets` to `komodo/<env>/<service>`. CDK config already used the new
  convention for AWS envs.
- ✅ **README Quick Start path fixed (2026-06-21).** Updated to `komodo/local/auth-api`.
- ✅ **Makefile nits resolved (2026-06-20).** `.PHONY` now lists all targets; `clean` is Docker prune
  (no dead `rm -rf bin`); dead per-ENV `AWS_ENDPOINT` LocalStack/dev ambiguity removed.
- ✅ **CDK cdk.json fixed (2026-06-21).** Changed `"app": "go run ."` to `"app": "npx ts-node main.ts"`.

---

### Phase 7 — Production launch readiness (the "prod ready" delta; after Phases 0–3b)

> Local/dev ready (below) ≠ prod ready. This phase is the difference: real-AWS edge infra,
> observability, and operational proof. Doc set (PRD / HLD / ADR 001 / DATA-MODEL) frozen
> 2026-06-12 — agents execute against it without further spec input.

- ✅ **[H] CI merge gate (2026-06-21).** `gate-auth-api` job in `.github/workflows/ci.yml`: build /
  vet / golangci-lint / generate-check / component tests with -race + 80% per-package coverage floor
  (excluding `internal/models*`, `internal/testutil/mocks`, `cmd/*`) / integration tests / govulncheck.
  CDK synth + CDK tests (vitest) added to the same gate.
- ✅ **[H] Deploy scripts replaced by CDK (2026-06-21).** Old bash `deploy_dev.sh`/`deploy_staging.sh`/
  `deploy_prod.sh` deleted. `deploy/cdk/` (TypeScript, aws-cdk-lib) owns the full Fargate stack:
  ECS task def (public:7011 + private:7012), ALB with HTTPS + HTTP→HTTPS redirect, auto-scaling,
  ECR image lookup, Secrets Manager grants. Per-env config in `config.ts` (dev/stg/prod).
  `cdk deploy -c env=<env>` replaces bash scripts. Prod secrets seeding still manual (see runbooks).
- ✅ **[H] Edge infra (2026-06-21).** Implemented in `deploy/cdk/stack.ts`:
  - **HTTPS**: ACM cert lookup, HTTPS listener on 443, HTTP→HTTPS 301 redirect, SslPolicy.RECOMMENDED_TLS.
  - **WAFv2**: 5 rules — AWSManagedRulesCommonRuleSet, KnownBadInputsRuleSet, global rate limit
    (2000/5min/IP), OTP rate limit (100/5min/IP on `/v1/otp/*`), passkey rate limit
    (100/5min/IP on `/v1/passkeys/*`). Associated with ALB.
  - **CloudFront**: Conditional (off for dev, on for stg/prod). HTTPS-only origin to ALB, caching
    disabled for auth endpoints, JWKS cache behavior (5min default, 1hr max TTL). HTTP/2+3.
  - **Security groups**: ALB SG allows 80/443; Task SG locks 7011 to ALB, 7012 to VPC CIDR.
  All covered by 40 CDK tests (vitest, 100% statement coverage).
- ✅ **[H] Observability (2026-06-21).** 8 CloudWatch alarms in CDK: CPU high, memory high,
  unhealthy targets, 5xx errors (existing 4) + issuance 5xx rate, OTP abuse (429s), OTP brute-force
  (401s), ALB P99 latency (new 4 via MetricFilters on the ECS log group).
  **Still open:** Redis reachability alarm, JWKS availability alarm, CloudWatch dashboards
  (not alarms), log redaction audit.
- **[M]** **Runbooks** — key-rotation runbook into ops docs (ADR 003) + emergency
  revocation/incident procedure; dry-run one full rotation in dev (ADR 003 implementation-status
  pending items).
- **[M]** **k6 measured baseline** against deployed dev (`/v1/otp/verify`, `/v1/oauth/token`) —
  retire the modeled latency table above; add passkey assertion once 3b ships.
- **[M]** **Passkey DEV parameters** — RP ID/origins for `auth-dev.komodo.com` per ADR 002.
- **[M]** **ACM certificate** — provision cert for `auth-dev.komodo.com` (ALB, us-east-2). Populate
  `certificateArn` in `DEV_CONFIG` (`deploy/cdk/main.ts`).

---

### Phase 8 — V1 audit remediation ✅ (all items resolved 2026-06-17 → 2026-06-20)

> Findings from an end-to-end readiness audit (code read + `go build`/`vet`/component-`-race` +
> local reproduction of the CI gate). All items resolved across Phase 8 commit (`bf2332b`) and the
> Phase 8a implementation session (2026-06-20).

- ✅ **[H] [SECURITY] Refresh rotation scope leak fixed (2026-06-17, `bf2332b`).** `isUserSession`
  gate added; user-session refreshes get `passkey:verified` scope (no `svc:`). Component tests assert
  no `svc:` scope on passkey-refreshed tokens and retention of `passkey:verified`.

- ✅ **[H] Passkey refresh audience fixed (2026-06-20).** User sessions (`azp != subject`) bypass the
  `AllowedAudiences` gate — the audience was set by auth-api at login time. M2M tokens still enforced.
  Proven by `TestOAuthTokenHandler_Component_RefreshToken_PasskeyUserAudience_ServiceOnlyClient` and
  `TestOAuthTokenHandler_Component_RefreshToken_M2MAudience_StillEnforced`.

- ✅ **[H] CI coverage gate fixed (2026-06-17, `bf2332b`).** Switched to per-package coverage from
  `go test -cover`, excluding `internal/testutil/mocks/`, `internal/models`, and `cmd/`.

- ✅ **[M] Passkey-register transports bug fixed (2026-06-17, `bf2332b`).** Changed to
  `make([]string, 0, len(...))`. Register test with non-empty transport set added.

- ✅ **[M] OTP attempt-counter pre-inflation.** Addressed: `IncrOTPAttempts` now checks
  `Exists(otpKeyPrefix+email)` first — only increments when an active OTP exists. No OTP = no counter
  increment = no lockout.

- ✅ **[L] Nil-guard in family revocation (2026-06-20).** Both `ExpiresAt` reads in
  `refreshRevocationDenied` now check `claims.ExpiresAt != nil`.

- ✅ **[M] Negative tests for cache-error deny paths (2026-06-20).** Error-injection tests added:
  `TestOAuthTokenHandler_Component_RefreshToken_CacheError_IsFamilyRevoked_Returns500`,
  `TestOAuthTokenHandler_Component_RefreshToken_BanCheck_*` paths, passkey replay/error tests.

- ✅ **[M] Docs reconciled (2026-06-17/20).** README `/v1/token/validate` limitation documented
  (line 74). Phase references aligned.

- ✅ **[L] `/v1/token/validate` single-audience limitation documented** in README (line 74).

---

### Phase 8a — Push to 9/9 + DEV 100% ✅ (resolved 2026-06-20)

> The in-repo delta to lift every readiness category to ~9/10 and DEV to ~100%, deliberately
> excluding external dependencies (comms-api template store, user-api contract, AWS edge infra / WAF /
> SG isolation, KMS). All P0/P1/P2 items resolved 2026-06-20. Gate green: `go build ./... && go vet
> ./... && TEST_TIER=component go test -race -count=1 ./...` + `golangci-lint run` = 0 issues.

#### P0 — security + correctness ✅ (all resolved 2026-06-20)

- ✅ **[H] [SECURITY] OTP single-use `SetNX` redemption claim implemented.** `VerifyOTP` now calls
  `SetNX(otp:redeemed:<email>, sentinel, 300s)` after the constant-time compare passes. Concurrent
  requests get `ErrOTPAlreadyRedeemed` (409). Handler returns distinct 409 for already-redeemed vs
  401 for invalid. Concurrent-verify test asserts exactly 1/10 succeeds (`p8a_security_test.go`).

- ✅ **[H] [SECURITY] Passkey ceremony single-use via `ClaimSession`.** Both
  `PasskeyRegisterCompleteHandler` (`ClaimSession("reg:"+sub)`) and `PasskeyLoginCompleteHandler`
  (`ClaimSession("login:"+challenge)`) now atomically claim the session before consuming it. Replay
  detected → 409. Tests: `ReplayDetected_Returns409` in both passkey test files.

- ✅ **[H] Passkey-refresh audience bypass for user sessions.** `isUserSession` check moved above the
  `AllowedAudiences` gate; user sessions skip the gate entirely. Proven by component tests against a
  service-only registry that still succeeds for user refresh.

- ✅ **[M] [SECURITY] OTP code removed from logs.** `logger.Debug("generated OTP", …)` no longer
  includes `otp.code` attribute. Test `TestOTPRequestHandler_Component_OTPCodeNotInResponseBody`
  asserts the code doesn't leak in the response body.

#### P1 — test / coverage / CI proof ✅ (resolved 2026-06-20)

- ✅ **[M] Negative + error-injection tests added.** `refreshRevocationDenied` cache-error paths,
  `GetUserByID` error path (ban lookup), passkey-register with non-empty transports, passkey-login
  replay detection, sign-token error paths (client_credentials + refresh). All at component tier.

- ✅ **[M] Integration tests migrated to testcontainers.** All `localhost:6379` tests
  (`TestOTPRequestHandler_Integration_*`, `TestOTPVerify_Integration_*`,
  `TestOAuthIntrospectHandler_Integration_*`, `TestOAuthTokenHandler_Integration_*`) now use
  `startRedisContainer(t)`. No external Redis dependency.

- ✅ **[M] Coverage push complete.** `internal/api` 90.3% / `internal/db` 89.2% / `internal/clients`
  86.0% — all exceed the 80% floor by ≥6 points (component tier, 2026-06-20).

#### P2 — DEV→100% config hygiene, quality, feature mechanics ✅ (resolved 2026-06-20)

- ✅ **[M] Phase 6 build/config alignment complete (2026-06-20).** Dead Makefile AWS plumbing deleted;
  secret-path convention documented (local vs deploy split is intentional); README Quick Start already
  correct. See Phase 6 section.

- ✅ **[L] Comment-doctrine cleanup (2026-06-20).** No surviving inline comments in production code
  (grep-verified). Gosec narrowing investigated and determined not viable — closed.

- **[M] → MOVED to Phase 8c (2026-06-18).** The `authorization_code` + PKCE-S256 grant mechanics were
  deferred out of 8a to their own phase/session. See "Phase 8c" below.

- ✅ **[L] Go benchmarks added (2026-06-20).** `BenchmarkVerifyOTP` in `internal/db/otp_test.go`.
  Full p99 validation still needs the Phase 7 k6 baseline against a deployed target.

- ✅ **[L] Doc reconciliation (2026-06-17).** SDK-blocked rationale retired in Phase 1 + ADR 004.

---

### Phase 8b — SDK primitives + standardization review (cross-repo: `komodo-forge-sdk-go`; parallel, non-blocking)

> Sequenced after 8a's `SetNX` fix lands. Flow: **(1)** implement the primitives in
> `komodo-forge-sdk-go`, **(2)** pass the SDK's own test gate + cut a semver release, **(3)** ✅ repin
> auth-api's `go.mod` (v0.19.1, 2026-06-20), **(4)** refactor auth-api call sites. This is a quality / standardization track —
> **not** a V1 blocker for DEV (8a already closes correctness in-process). **Promotion bar
> (hard):** code moves into the SDK only if it is *truly universal* **and** would benefit another app.
> Auth-domain logic stays in auth-api per ADR 001 — see the "do NOT promote" list below.

#### 8b.A — SDK redis primitives (the concrete asks; demoted from "blockers" to conveniences by 8a)

- **[M]** **`GetDel` — atomic get-and-delete.** ⚠️ **Review finding (do not get this wrong on pull-in):**
  `GetDel` is **NOT** a replacement for the OTP/passkey `SetNX` redemption claim. `GetDel` deletes the
  key *before* any correctness check, so using it in `VerifyOTP` would let a single **wrong** guess
  delete the victim's live OTP — a free account-level DoS. Its correct home is single-use-where-read-
  *is*-redemption: the `authorization_code` exchange (Phase 8a P2 / V2), where the code itself is the
  secret. Add it for that path; leave OTP/passkey on `SetNX`.
- **[L]** **`MGET` / bulk get.** The one genuine latency win: combine `GetOTPAttempts` + OTP `Get`
  into a single round trip (~1ms off `/v1/otp/verify`). Already stubbed in `komodo-forge-sdk-go/TODO.md`
  (`aws/elasticache` bulk ops). Gate on the Phase 7 k6 baseline showing the RTT actually matters.
- **[L]** **`Eval`/Lua — optional, defer.** Would collapse OTP compare-and-delete into one atomic,
  DoS-safe server-side call (cleaner than the two-call `SetNX` claim) but adds script-cache / `NOSCRIPT`
  handling to the SDK surface. Only pursue if post-k6 the OTP-verify RTT budget demands shaving the
  extra `SetNX` hop. Not worth the SDK complexity otherwise.

#### 8b.B — standardization review (promote only if it clears the bar)

> Run a deliberate read of auth-api against the bar before promoting anything. Most of the cross-cutting
> surface (rate-limit / IP-access / security-headers / sanitization / idempotency / `MaxContentLength`
> middleware, `WithServiceAuth`, `JWKSVerifier`) **already** lives in the SDK — confirm none has drifted.
> Net-new candidates surfaced by this audit:

| Candidate | Universal? | Disposition |
|---|---|---|
| **Shared JWT custom-claims schema** (`scp`/`azp`/`family_id`, `internal/jwt/jwt.go:13`) | Yes — every verify-only service decodes these | **[M] Strong — highest value.** Promote the claims *type* (not minting) to the SDK `auth` package so the fleet decodes claims identically; prevents per-service claim drift. Pairs with `JWKSVerifier`. |
| **Generic single-use claim** (`ClaimOnce(ctx, key, ttl)` over `SetNX`, the 8a OTP/passkey pattern) | Yes — nonces, ceremony state, one-time tokens | **[M]** Promote to SDK `db/redis` (or `api/idempotency`) once the 8a in-repo version is proven. |
| **HTTP response body-cap** (`internal/clients/HttpClient` response wrapping) | Yes — any service calling downstreams | **[L]** Promote *only if* not already covered by `http/client`; verify first. |

**Do NOT promote (fail the bar — auth-domain, stays in auth-api):**
- Token **minting** / private-key custody — ADR 001: auth-api is the *sole* key holder; this must never enter the universal SDK.
- Revocation denylist + family-revocation storage (`db/tokens.go`) — auth-domain; the consumer-side story is the V2 bloom-filter, not an SDK primitive.
- OTP / passkey ceremony / client-registry logic — auth-domain.
- `getOrRefreshSvcJWT` self-mint — issuer-only; non-issuers already use `WithServiceAuth`.

#### 8b exit

SDK changes exit on `komodo-forge-sdk-go`'s own gate + release; the auth-api repin + refactor exits on
the standard phase gate (`build`/`vet`/`TEST_TIER=component go test -race`). Update the SDK-capability
finding (top of this file) once `GetDel`/`MGET` ship, retiring the "missing primitive" notes.

---

### Phase 8c — authorization_code + PKCE-S256 grant (deferred from 8a P2; own session)

> Carved out of 8a P2 (2026-06-18) as its own focused effort. Non-blocking for V1 (flag off).
> swe → QA cross-review.

- ✅ **[M]** **Implement the `authorization_code` + PKCE-S256 grant mechanics behind the existing flag**
  (`internal/api/oauth_token.go` `handleAuthorizationCode` — currently a `NotImplemented` stub — and
  `oauth_authorize.go`). Implemented 2026-06-22: `/authorize` validates params, requires
  `code_challenge` + `code_challenge_method=S256`, issues a code stored via `SetNX` with 10-min TTL;
  `/token` exchanges with S256 `code_verifier` check (RFC 7636), validates `redirect_uri` against
  registry, issues access + refresh tokens. User identity via `user_id` query param (login-UI
  external). Uses `Get` + `Delete` for code exchange (pending `GetDel` in 8b). Gated with
  `ENABLE_AUTH_CODE_GRANT` off by default.
- ✅ **Tests:** S256 happy path, wrong-verifier reject, single-use replay reject, disabled-flag 501,
  redirect_uri validation, client_id mismatch, expired/missing code, unknown client. DB layer unit
  tests for store/get/delete auth code. Gate green.
- ✅ **XSS fix (2026-06-22, QA finding).** `sendAuthorizeDirectError` now uses `html.EscapeString` on
  all interpolated values.

**QA cross-review PASS (2026-06-22).** Two tracked findings (gate on feature flag being off):
- **[M] TOCTOU on auth code exchange** — `Get`+`Delete` is non-atomic. PKCE verifier limits
  exploitability. Resolves when SDK ships `GetDel` (Phase 8b).
- **[M] Unauthenticated `user_id` parameter** — `/authorize` accepts any `user_id` without session
  auth. Safe while `ENABLE_AUTH_CODE_GRANT` is off. Must gate behind a session layer before enabling.

---

### Phase 9 — DEV deployment readiness (AWS DEV blockers + audit bugs)

> Findings from a full readiness assessment (2026-06-21): code read across all handlers/jwt/db/oauth/
> clients/middleware + CDK/CI/Docker/secret-seed review, with the local gate **verified green** —
> `go build ./...` ✅, `go vet ./...` ✅, `golangci-lint run` = 0 issues ✅, `govulncheck ./...` = 0
> vulns ✅, `TEST_TIER=component go test -race -cover ./...` ✅ (api 90.3% / db 89.2% / clients 86.0% /
> jwt 88.4% / oauth 94.1% / webauthn 94.1%). **The application code is prod-grade; this phase is the
> operational last mile** — the deploy path won't reach a running AWS env, plus a small set of real
> logic bugs the read surfaced. Exit gate unchanged + `cdk synth`/CDK vitest green + **one clean
> dry-run deploy to DEV that boots both binaries and passes `/health/ready`.**
>
> **9b logic bugs resolved 2026-06-22** (5/5 fixed, gate green).
>
> **Scope note (2026-06-22):** STG and PROD environments removed from phased planning. CDK configs
> for stg/prod remain in code as scaffolding but are not tracked here. Re-scope when DEV is validated
> and a production timeline exists.

#### 9a — DEV deploy blockers (nothing reaches AWS DEV until these land)

- ✅ **[H] CI auto-triggers already enabled.** `.github/workflows/ci.yml` triggers on
  `pull_request` + `push` to `main` + `workflow_dispatch`. (Stale TODO item — verified 2026-06-22.)

- **[H] CDK DEV deploy fails — ACM cert ARN is a placeholder.** `DEV_CONFIG` in
  `deploy/cdk/main.ts` sets `certificateArn: 'PLACEHOLDER-acm-cert-arn-us-east-2'`.
  `FargatePublicService` builds an HTTPS listener from this value — deploy fails on a placeholder.
  Provision one ACM cert for `auth-dev.komodo.com` in us-east-2 and populate the ARN.
  DEV skips CloudFront (`main.ts:279`), so no `cloudFrontCertificateArn` needed.

- **[L] DEV CDK skips data-store grants (by design).** `main.ts:279` early-returns for DEV — no
  WAF, alarms, DynamoDB grants, or ElastiCache SG rules. ElastiCache and DynamoDB are pre-provisioned
  dependencies (like VPC and ECR). The app boots; `/health/ready` degrades if Redis is unreachable
  but the ALB liveness check (`/health`) still passes. Acceptable for DEV — revisit if DEV needs
  the banned-customers table (add `bannedCustomersTable` to `DEV_CONFIG` and remove the early return
  guard, or grant separately).

#### 9b — Verified logic bugs ✅ (all resolved 2026-06-22)

- ✅ **[M] OTP re-login false-reject fixed (2026-06-22).** `GenerateAndStoreOTP` now deletes
  `otp:redeemed:<email>` before storing the new OTP code, clearing any stale redemption claim from a
  previous code. Re-login within the 300s redemption window no longer false-rejects.

- ✅ **[M] M2M `offline_access` refresh now preserves granted scopes (2026-06-22).**
  `handleClientCredentials` now signs the refresh token with `["offline_access"] + grantedScopes`
  instead of only `["offline_access"]`. On rotation, the access token retains the originally-granted
  scopes (e.g. `read`).

- ✅ **[L] [SECURITY] Cross-client user token revocation fixed (2026-06-22).** Added an `azp` guard
  for user-subject tokens: if the token's `azp` claim is set and doesn't match the requesting
  `client_id`, revocation is rejected with 403. M2M tokens (subject is a registered client) still use
  the existing subject-match guard.

- ✅ **[L] OTP-verify goroutines now recover from panics (2026-06-22).** Both goroutines in
  `OTPVerifyHandler` (`VerifyOTP` and `GetUserCredentials`) now have `defer recover()` that logs the
  panic value and sends an error on the channel, matching the `SendEmail` pattern in `comms.go`.

- ✅ **[L] `/health/ready` no longer leaks internal details (2026-06-22).** `HealthReadyHandler` now
  returns only `{"status":"unavailable"}` on failure; the actual error is logged via `logger.Error`.
  Existing health tests updated to assert internal details (URLs, dependency names) are absent from the
  response body.

#### 9c — Operational completeness (DEV validation)

- ✅ **[M] Log-redaction audit CLEAN (2026-06-22).** Full sweep across all production Go code — no PII,
  secrets, OTP codes, or sensitive data in logs, error responses, or debug output. `logger.RedactStrict`
  in bootstrap; no email/token/key material in any `logger.*` call; error responses use generic strings.
- ✅ **[M] CDK alarms for Redis reachability + JWKS availability (2026-06-22).** Two `MetricFilterAlarm`
  instances added to `buildAuthAlarms`: `RedisUnreachable` (threshold 3/5min, matches readiness check
  structured logs) and `JwksUnavailable` (threshold 5/5min, matches 5xx on `/.well-known/jwks.json`).
  Non-dev only (inherits early-return at `main.ts:279`). 19/19 CDK tests pass.
- **[M] CloudWatch dashboards** (not just alarms) — still open.
- **[M] Route53 / DNS for DEV.** The ALB is created but nothing maps `auth-dev.komodo.com` to it.
  Add an A-alias record (gated on the ACM cert in 9a).
- ✅ **[L] Remove the empty-`azp` backward-compat fallback** (2026-06-22). Removed the `else` branch
  from `handleRefreshToken` that fell back to `subject == client_id` when `azp` was empty. Refresh
  path now unconditionally requires `azp == client_id`. Updated all tests that used legacy empty-azp
  tokens to use `SignTokenWithAZP`. The backward-compat test was converted to verify empty-azp tokens
  are now rejected (401).
- **[M] k6 measured baseline (carried from Phase 7).** Retire the modeled latency table against
  deployed DEV once 9a unblocks (`/v1/otp/verify`, `/v1/oauth/token`, passkey assertion). The
  OTP-verify p99 sits at the 100ms perceptual threshold — measure before claiming it.
- **[M] Runbooks (carried from Phase 7).** Key-rotation (ADR 003), emergency revocation, incident
  procedure; dry-run one full rotation in DEV after 9a.

#### 9d — Confirmed still-blocked (do not pull in; tracked elsewhere)

- `oapi-codegen` repin — upstream stable 3.1 not shipped (Phase 4c).
- `MGET` OTP-verify RTT shave — SDK-blocked (Phase 2 / 8b).

---

### Definition of "local/dev ready" for V1 — ✅ ACHIEVED (2026-06-16)

Phases 0–3 + 3b ✅ (security + ops + passkeys); Phase 4 mocks/testcontainers/tiers/table-driven +
integration + E2E ✅; Phase 4b 80% per-package floor ✅; Phase 4c OpenAPI 3.1 ✅. Component-tier tests
(testcontainers + mocks) are the local validation gate.

**DEV ready** = local/dev ready + Phase 9a DEV blocker resolved (ACM cert) + Phase 9c operational
items. Phases 6, 8, 8a all resolved (2026-06-20).

### Explicitly deferred (do not pull into V1 — see V2 below)

- KMS-backed signer → V2 (Signer seam ready).
- Bloom-filter JTI denylist → V2 (needs Redis budget).
- ~~CloudFront-fronted JWKS → V2.~~ ✅ Implemented in Phase 7 CDK (2026-06-21) — JWKS cache behavior
  on CloudFront with 5min/1hr TTL.
- `authorization_code` grant + social IdP login → V2 (blocked on login UI; PRD Non-Goals already
  scope social IdP to V2).
- k6 load test for `/v1/otp/verify` → Phase 7 (needs a deployed target, not a version bump).

---

## V2 (Next Major Version)

> Not yet phased — sequencing begins once V1 reaches "prod ready" and these are scoped against
> real V1 metrics (measured latency, passkey adoption, social-login demand).

- **[L]** Migrate token signing from in-memory PEM → KMS-backed signer. V1 holds the RS256 private
  key in memory (Secrets-Manager-sourced, never env, never logged; core dumps disabled via
  `security/os/host.DisableCoreDumps()`). For v2, move signing behind `kms:Sign` so the key never
  materializes in-process — defends against full memory compromise. Gate on token volume / p99
  latency tolerance (per-sign KMS adds a network hop to the `/oauth/token` + `/otp/verify` hot
  path). Aligns with the ES256 migration: P-256 is a native KMS key spec. The V1 `Signer` interface
  is built to let this drop in without touching call sites.
  - **`mlock` was evaluated and rejected (2026-06-09), do not re-propose:** in a GC language
    `mlock` cannot pin "the key" — the PEM is copied many times (SM response → string → []byte →
    parsed `rsa.PrivateKey`/`big.Int` → signing buffers) and the GC can relocate/copy it
    afterward. Making it real requires `mlockall(MCL_CURRENT|MCL_FUTURE)` (pins all process
    memory, fights the GC, needs a raised container `RLIMIT_MEMLOCK`) for marginal gain. KMS-sign
    is the correct defense against in-memory key exposure, not `mlock`.
- **[M]** Bloom-filter JTI denylist. Local in-process bloom, background-refreshed from Redis.
  ~99.9% of valid tokens skip the `EC.Get` hop entirely (~1ms saved per introspect/validate).
  False-positive rate decision + rebuild cadence to design. This is ADR 001's "Phase 2"
  (verification-maturity phase — distinct from this file's V1 implementation Phase 0–7); needs a
  Redis-cost budget line before scoping.
- ~~**[L]** JWKS via CloudFront with long `Cache-Control` + key-id rotation.~~ ✅ Done (Phase 7, 2026-06-21).
  CloudFront caches `/.well-known/jwks.json` with 5min default / 1hr max TTL. Key rotation still uses
  the multi-`kid` overlap window (ADR 003); CDN invalidation can be added when needed.
- **[L]** Implement the `authorization_code` grant flow + social IdP login (PRD Non-Goals already
  scope social IdP to V2). Blocked on the SvelteKit login UI; gate behind an env-var toggle so the
  endpoint is cleanly disabled until ready. `openapi.yaml` already documents the target
  `/v1/oauth/authorize` contract (PKCE, `code`/`redirect_uri`); both handlers are currently 501
  stubs.
  - **`/v1/oauth/authorize`:** check session/cookie auth, redirecting to login with a return URL
    if absent; show a consent screen for the requested scopes; validate scope against the
    client's `allowed_scopes`; generate a short-lived single-use authorization code; store it
    with `clientId`, `redirectUri`, `scope`, `user_id`, and `codeChallenge` in cache; redirect
    back to `redirectUri` with `code` and `state`.
  - **`/v1/oauth/token` (`authorization_code` grant):** look up the stored code and reject if
    missing/expired; verify it was issued to the presenting `client_id` with a matching
    `redirect_uri`; verify `code_verifier` against the stored `code_challenge` (PKCE, RFC 7636);
    wire `s.BannedChecker.IsBanned` once the code resolves to a user email, issue access +
    refresh tokens, and delete the used code.
- **[L]** Add `otp:verified` scope to `komodo-access-api`'s `access.json` once that service is
  scaffolded (access-api doesn't exist yet — RBAC/scope enforcement is out of auth-api's V1 scope
  per the PRD).

---

## V3 (Future Major Version)

- **[L]** Migrate to Rust for version 3.0 — evaluate Axum-based implementation; not a near-term
  priority.
