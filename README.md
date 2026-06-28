# komodo-auth-api

OAuth 2.0 authorization server. Issues and validates RS256 JWTs for all Komodo services. Runs two binary entrypoints from a single image: a public server for client-facing OAuth flows and an internal server for service-to-service token validation.

**Capabilities**

- OAuth 2.0 token issuance — `client_credentials`, `refresh_token`, and `authorization_code` grants (`authorization_code` is flag-gated behind `ENABLE_AUTH_CODE_GRANT`; see Key Design Notes).
- Passwordless login — email OTP request/verify and WebAuthn passkey registration/login, issuing short-lived JWTs on success.
- Token lifecycle — revocation (RFC 7009), introspection (RFC 7662), and service-to-service validation.
- JWKS publication — RS256 public key served at `/.well-known/jwks.json` for downstream verification.

**Contract:** `openapi.yaml` (service root) is the source of truth for all request/response shapes.

---

## Quick Start (Local)

Build and run both containers via Docker Compose:

```bash
make bootstrap   # builds public + private images, starts containers
curl http://localhost:7011/health
```

To run the binaries directly (outside Docker), set AWS env vars so the service can load secrets from Secrets Manager:

```bash
export AWS_ENDPOINT=http://localhost:4566   # if using a local AWS mock
export AWS_SECRET_PATH=komodo/local/auth-api
go run ./cmd/public     # public server on :7011
go run ./cmd/private    # internal server on :7012
```

Testing uses testcontainers (auto-provisioned Redis) — no running stack required:

```bash
make test        # component-tier tests with race detector
```

See **Setup & Deployment** below for CDK-based AWS provisioning.

---

## Ports

| Server | Port | Audience |
|--------|------|----------|
| Public | 7011 | Browser / API consumers |
| Internal | 7012 | Service-to-service (shares public container network namespace) |

---

## Routes

### Public (7011)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Liveness probe |
| GET | `/health/ready` | Readiness probe (checks Redis connectivity) |
| GET | `/.well-known/jwks.json` | RS256 public key in JWK Set format |
| POST | `/v1/oauth/token` | Issue access token (`client_credentials`, `refresh_token`, `authorization_code`¹) |
| GET | `/v1/oauth/authorize` | Authorization code endpoint¹ |
| POST | `/v1/oauth/revoke` | Revoke a token (RFC 7009) |
| POST | `/v1/otp/request` | Generate and store a 6-digit OTP for passwordless login |
| POST | `/v1/otp/verify` | Verify OTP and issue a short-lived JWT |
| POST | `/v1/passkeys/register/begin` | Begin passkey registration ceremony |
| POST | `/v1/passkeys/register/complete` | Complete passkey registration |
| POST | `/v1/passkeys/login/begin` | Begin passkey login ceremony |
| POST | `/v1/passkeys/login/complete` | Complete passkey login and issue tokens |

¹ `GET /v1/oauth/authorize` and the `authorization_code` grant are fully implemented but disabled by default — gated behind `ENABLE_AUTH_CODE_GRANT="true"`. When disabled, both return 501.

### Internal (7012)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/health` | Liveness probe | — |
| POST | `/v1/oauth/introspect` | Token introspection (RFC 7662) | `ClientType` + `Auth` middleware (bearer token required) |
| POST | `/v1/token/validate` | Validate and decode a JWT (service-to-service) | Network-only — deliberately unauthenticated; the submitted token is itself the credential |
| GET | `/v1/clients` | List all registered OAuth clients | `ClientType` + `Auth` middleware (bearer token required) |
| GET | `/v1/clients/{id}` | Get a registered client by ID | `ClientType` + `Auth` middleware (bearer token required) |

> The internal server is bound to the private VPC subnet; routes marked **Network-only** rely on that boundary for protection. Do not expose port 7012 publicly.
>
> **`/v1/token/validate` limitation:** `ValidateAndParseClaims` pins the single configured `JWT_AUDIENCE`, so validate reports `valid:false` for a token carrying any other audience (e.g. a `komodo-apis:user` token validated by a `komodo-apis:service`-configured instance). This is by design — consumers use `JWKSVerifier` for local RS256 verification on the hot path (ADR 001); validate is for debugging and opaque-token scenarios.

---

## Environment Variables

All secrets are injected from a single Secrets Manager JSON blob at startup. The app exits on any init failure.

### Application

| Variable | Description |
|----------|-------------|
| `APP_NAME` | Service name (used in logging) |
| `LOG_LEVEL` | `debug` / `info` / `warn` / `error` |
| `ENV` | `local` / `staging` / `production` |
| `PORT` | Public server listen address (e.g. `:7011`) — public binary only |
| `PORT_PRIVATE` | Internal server listen address (e.g. `:7012`) — private binary only |

### AWS

| Variable | Description |
|----------|-------------|
| `AWS_REGION` | e.g. `us-east-2` |
| `AWS_ENDPOINT` | Override for local AWS mock (omit in production) |
| `AWS_SECRET_PATH` | Secrets Manager secret name (JSON blob). Convention: `komodo/<env>/auth-api` |

### JWT

| Variable | Description |
|----------|-------------|
| `JWT_PRIVATE_KEY` | RSA-2048 private key (PEM, PKCS#8) |
| `JWT_PUBLIC_KEY` | RSA-2048 public key (PEM, PKIX) |
| `JWT_KID` | Key ID embedded in JWK Set and token headers |
| `JWT_ISSUER` | `iss` claim value |
| `JWT_AUDIENCE` | `aud` claim value |

### ElastiCache (Redis)

| Variable | Description |
|----------|-------------|
| `AWS_ELASTICACHE_ENDPOINT` | Redis endpoint (host:port) |
| `AWS_ELASTICACHE_PASSWORD` | Redis auth token |
| `AWS_ELASTICACHE_DB` | Redis DB index |

Used for:
- OTP storage — `otp:<email>` (5 min TTL, deleted on successful verify)
- OTP attempt counter — `otp:attempts:<email>` (co-expires with OTP key; capped at 5 attempts, then 429)
- OTP redemption claim — `otp:redeemed:<email>` (5 min TTL, prevents double-redeem)
- Revocation denylist — `revoked:jti:<jti>` (auto-expires with the token's remaining TTL)
- Family revocation — `revoked_family:<family_id>` (TTL = remaining token lifetime)
- Authorization code — `authcode:<code>` (10 min TTL, single-use)
- WebAuthn session state (ceremony challenges)

### Client Registry

| Variable | Description |
|----------|-------------|
| `REGISTERED_CLIENTS` | JSON map of `{ "client-id": { "name": "...", "secret_hash": "...", "allowed_scopes": [...], "allowed_audiences": [...] } }` |

`secret_hash` is the SHA-256 hex digest of the client secret, not the plaintext: `printf '%s' '<plaintext-secret>' | shasum -a 256 | cut -d' ' -f1`.

### DynamoDB

| Variable | Description |
|----------|-------------|
| `BANNED_CUSTOMERS_TABLE` | DynamoDB table checked during OTP flows to reject banned customers. |

### Feature Flags

| Variable | Description |
|----------|-------------|
| `ENABLE_AUTH_CODE_GRANT` | `"true"` enables the `GET /v1/oauth/authorize` and `authorization_code` grant routes. Off by default — both return 501 when disabled. When enabled, both endpoints are fully functional (see Key Design Notes). |

### WebAuthn

| Variable | Description |
|----------|-------------|
| `WEBAUTHN_RP_ID` | Relying Party ID (e.g. `localhost` for local, `auth-dev.komodo.com` for DEV) |
| `WEBAUTHN_ORIGINS` | Comma-separated allowed origins for WebAuthn ceremonies |

### Service Endpoints

Downstream clients are generated locally with `oapi-codegen` into `internal/clients/{comms,user}/` from each provider's `openapi.yaml` (the auth-api server models are generated into `internal/models/`). Requests are issued through `forge-sdk-go/http/client` wrapped in `internal/clients/HttpClient`. API version is baked into the generated path at codegen time, so no `*_VERSION` env var is needed.

| Variable | Description |
|----------|-------------|
| `COMMUNICATIONS_API_URL` | Base URL of komodo-communications-api (e.g. `http://communications-api:7081`). Used by `SendEmail` to deliver OTPs. |
| `CUSTOMER_API_PRIVATE_URL` | Base URL of komodo-customer-api private port (e.g. `http://customer-api:7052`). Used by OTP verify to resolve a registered email to the user's UUID for the JWT subject. No fallback: a customer-api lookup error returns 503, and an unresolved account returns 401 (`account_not_found`). |

### Rate Limiting / Security (public server only)

| Variable | Description |
|----------|-------------|
| `IP_WHITELIST` | Comma-separated IPs to always allow |
| `IP_BLACKLIST` | Comma-separated IPs to always block |
| `MAX_CONTENT_LENGTH` | Max request body size in bytes, enforced on every public POST route |
| `IDEMPOTENCY_TTL_SEC` | Idempotency key TTL in seconds, enforced on `POST /v1/otp/request` |
| `RATE_LIMIT_RPS` | Requests per second per client |
| `RATE_LIMIT_BURST` | Burst allowance above RPS |
| `BUCKET_TTL_SECOND` | Rate limit bucket TTL |

Request validation rules (per-route field constraints applied by `RuleValidationMiddleware`) live in `internal/config/validation_rules.yaml` and are loaded **at runtime** from the path in `EVAL_RULES_PATH` (the Dockerfile copies the file to `/app/config/validation_rules.yaml`; set the var when running `go run` outside Docker). Matching is **fail-closed**: a public-chain route without a rule entry is rejected with 400.

`MAX_CONTENT_LENGTH` (default 4096 if unset/invalid) is enforced by `api.MaxContentLengthMiddleware`, applied to every public POST route ahead of the rest of the middleware chain: a request whose `Content-Length` exceeds the limit is rejected with 413, and the body is additionally wrapped in `http.MaxBytesReader` as defense-in-depth for chunked/missing `Content-Length`. No `validation_rules.yaml` entry is used for this.

`IDEMPOTENCY_TTL_SEC` (default `idempotency.DEFAULT_IDEM_TTL_SEC`, 300s, if unset/invalid) configures forge-sdk's `api/idempotency` store, applied via `IdempotencyMiddleware` to `POST /v1/otp/request` only — the one public endpoint with a side effect (sending an email via communications-api) worth deduping on client retry. Browser clients must send an `Idempotency-Key` header (8-64 chars); a repeated key within the TTL window returns `409 Conflict` with `Idempotency-Replayed: true` instead of re-sending the OTP email. The store is local/in-memory and does not dedupe across multiple instances of the public service.

| Variable | Description |
|----------|-------------|
| `EVAL_RULES_PATH` | Filesystem path to `validation_rules.yaml` |

---

## AWS Infrastructure

```
                        ┌──────────────┐
                        │  CloudFront  │  (stg/prod only)
                        └──────┬───────┘
                               │
                        ┌──────▼───────┐
                        │  ALB + WAF   │  HTTPS termination
                        └──────┬───────┘
                               │
   ┌───────────────────────────┼──────────────────────────────┐
   │  ECS Fargate (CDK)        │                               │
   │                           │                               │
   │  ┌────────────────────────▼──┐   ┌─────────────────────┐  │
   │  │ auth-api-public:7011      │   │ auth-api-private:7012│  │
   │  │ (OAuth, OTP, passkeys,    │   │ (introspect,        │  │
   │  │  JWKS)                    │   │  validate, clients) │  │
   │  └──────────┬────────────────┘   └─────────────────────┘  │
   │             │ auto-scaling (min/max per env)              │
   └─────────────┼─────────────────────────────────────────────┘
                 │
   ┌─────────────┼───────────────────────────────────────────┐
   │             │  AWS                                       │
   │  ┌──────────▼───────┐  ┌──────────────┐  ┌────────────┐ │
   │  │ Secrets Manager  │  │  ElastiCache │  │  DynamoDB  │ │
   │  │ (RSA keys, client│  │  (Redis)     │  │  (banned   │ │
   │  │  registry, Redis │  │  OTP + token │  │  customers)│ │
   │  │  credentials)    │  │  revocation  │  │            │ │
   │  └──────────────────┘  └──────────────┘  └────────────┘ │
   └─────────────────────────────────────────────────────────┘
```

- **Compute:** ECS Fargate via CDK (`deploy/cdk/main.ts`). Public service behind ALB with HTTPS + WAF; private service on internal listener. Auto-scaling configured per environment.
- **CDK constructs:** `FargatePublicService`, `FargatePrivateService`, `WafWebAcl`, and `MetricFilterAlarm` from `komodo-forge-sdk-ts/cdk/constructs`.
- **CloudFront:** Enabled for staging and production environments only.
- **WAF:** AWS Managed Rules (Common + Known Bad Inputs) plus per-path rate limits for OTP and passkey endpoints.
- **Secrets:** All sensitive config is loaded from a single Secrets Manager JSON blob (`AWS_SECRET_PATH`) at cold start; each key is exported into the process environment. The app exits on any secret load failure.
- **Redis:** ElastiCache in-transit encryption required. Keys auto-expire — no manual cleanup needed.
- **DynamoDB:** `BANNED_CUSTOMERS_TABLE` is consulted during OTP flows to reject banned customers.
- **JWT keys:** RS256, 2048-bit, with a multi-`kid` overlap window: the issuer holds an active + previous key pair, `/.well-known/jwks.json` publishes both during rotation, and keys hot-reload via `secretsmanager.Watch` — rotation is a secret update, not a redeploy. Procedure + runbook: `docs/adr/003-key-rotation.md`.

---

## Setup & Deployment

Infrastructure is managed via CDK (`deploy/cdk/main.ts`). The Makefile `deploy` target wraps CDK for convenience.

```bash
make deploy dev       # CDK deploy to DEV
make deploy staging   # CDK deploy to staging
make deploy prod      # CDK deploy to production
```

Or run CDK directly:

```bash
cd deploy/cdk && bun install && npx cdk deploy -c env=dev
```

Secrets must be pre-provisioned in AWS Secrets Manager at the path `komodo/<env>/auth-api` before the first deploy. The secret is a single JSON blob containing all sensitive config (RSA keys, client registry, Redis credentials).

---

## Commands

### Make targets (from service root)

The `Makefile` wraps the Docker build/run lifecycle and is parameterised by `ENV` (`local` | `dev` | `staging` | `prod`).

```bash
make build            # build public + private images for ENV (default: local)
make run              # start the compose stack for ENV
make bootstrap        # build + run (default goal)
make restart          # stop + run
make stop             # tear down the stack
make clean            # prune Docker artifacts
make deploy           # CDK deploy (dev, staging, prod only)
make test             # component-tier tests with race detector (= test_component)
make test_unit        # go test -short ./...
make test_component   # TEST_TIER=component go test -race ./...
make lint             # golangci-lint run ./...
make generate         # regenerate server models + downstream clients + mocks
make generate-mocks   # go generate ./... (mockgen)
```

`make build ENV=dev` (etc.) targets a non-local environment.

### Build (raw)

```bash
go build -o bin/auth-public ./cmd/public     # public binary
go build -o bin/auth-private ./cmd/private    # internal binary
```

### Codegen

```bash
make generate              # all: server models + comms + customer clients
make generate-server       # internal/models from this service's openapi.yaml
make generate-client-comms # internal/models/comms from communications-api
make generate-client-customer  # internal/models/user from customer-api
make generate-check        # fail if generated files are stale
```

### Docker (run from apis/ directory)

```bash
# Build + start both servers
docker compose -f komodo-auth-api/docker-compose.yaml up --build

# Build only
docker compose -f komodo-auth-api/docker-compose.yaml build

# Detached
docker compose -f komodo-auth-api/docker-compose.yaml up -d
```

### Local dev

```bash
make bootstrap   # build + run both containers via docker-compose
make stop        # tear down the stack
go run ./cmd/public   # run public binary directly (requires env vars)
go run ./cmd/private  # run private binary directly
```

---

## Testing

Tests live adjacent to source (`*_test.go`), split into tiers by the forge SDK `testing/testutil` helpers (`testutil.Component(t)`, `testutil.Integration(t)`, etc.). Tiers are **cumulative** and selected at runtime via the `TEST_TIER` env var; the default is `unit`.

| Tier | Selector | Requires | What runs |
|------|----------|----------|-----------|
| `unit` | default (or `TEST_TIER=unit`) | nothing | Pure logic, no I/O — runs everywhere including CI by default. |
| `component` | `TEST_TIER=component` | nothing | Hermetic handler/wiring tests with in-memory fakes. |
| `integration` | `TEST_TIER=integration` | testcontainers (auto-provisioned Redis) | Real Redis-backed OTP, token tracking, cache behavior. |
| `e2e` | `TEST_TIER=e2e` + `-tags=e2e` | running stack | Top-level `e2e/` suite (build-tag gated). |

`-short` forces unit-only regardless of `TEST_TIER`.

```bash
# Unit only (default)
go test ./...

# Component tier (includes unit) — the CI gate
make test
TEST_TIER=component go test -race ./...

# Integration tier (includes unit + component) — testcontainers auto-provisions Redis
TEST_TIER=integration go test ./internal/api/... ./internal/db/...

# E2E — build-tag + tier gated, needs a running stack
TEST_TIER=e2e go test -tags=e2e ./e2e/...

# Race detector / verbose
go test -race ./...
go test -v ./...
```

---

## cURL Examples

All examples target `localhost`. Replace ports and tokens as needed.

### Health

```bash
curl http://localhost:7011/health
```

### JWKS

```bash
curl http://localhost:7011/.well-known/jwks.json
```

### Token — client_credentials

The endpoint accepts the RFC 6749 form encoding (what the forge SDK's `WithServiceAuth`
sends) and responds with snake_case fields (`access_token`, `token_type`, `expires_in`).
Issued M2M tokens carry a `svc:<client_id>` scope (consumed by `auth.RequireServiceScope`).

```bash
curl -X POST http://localhost:7011/v1/oauth/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d 'grant_type=client_credentials&client_id=my-service&client_secret=my-secret&scope=read'
```

A JSON body with the same snake_case fields is also accepted:

```bash
curl -X POST http://localhost:7011/v1/oauth/token \
  -H "Content-Type: application/json" \
  -d '{
    "grant_type": "client_credentials",
    "client_id": "my-service",
    "client_secret": "my-secret",
    "scope": "read"
  }'
```

### Token — refresh_token

```bash
curl -X POST http://localhost:7011/v1/oauth/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d 'grant_type=refresh_token&client_id=my-service&client_secret=my-secret&refresh_token=<token>'
```

### Revoke

```bash
curl -X POST http://localhost:7011/v1/oauth/revoke \
  -H "Content-Type: application/json" \
  -d '{ "token": "<token>" }'
```

### OTP Request

```bash
curl -X POST http://localhost:7011/v1/otp/request \
  -H "Content-Type: application/json" \
  -d '{ "email": "user@example.com" }'
```

### OTP Verify

```bash
curl -X POST http://localhost:7011/v1/otp/verify \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "code": "482910"
  }'
```

### Token — authorization_code (flag-gated)

```bash
curl "http://localhost:7011/v1/oauth/authorize?response_type=code&client_id=my-service&redirect_uri=http://localhost:3000/callback&code_challenge=<S256-challenge>&code_challenge_method=S256&user_id=<uuid>"

curl -X POST http://localhost:7011/v1/oauth/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d 'grant_type=authorization_code&client_id=my-service&client_secret=my-secret&code=<auth-code>&redirect_uri=http://localhost:3000/callback&code_verifier=<plaintext-verifier>'
```

### Passkey — login

```bash
curl -X POST http://localhost:7011/v1/passkeys/login/begin \
  -H "Content-Type: application/json" \
  -d '{ "email": "user@example.com" }'

curl -X POST http://localhost:7011/v1/passkeys/login/complete \
  -H "Content-Type: application/json" \
  -d '{ "email": "user@example.com", "credential": <webauthn-assertion-response> }'
```

### Passkey — register (requires `otp:verified` or `passkey:verified` bearer token)

```bash
curl -X POST http://localhost:7011/v1/passkeys/register/begin \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{}'

curl -X POST http://localhost:7011/v1/passkeys/register/complete \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{ "credential": <webauthn-attestation-response> }'
```

### Introspect (internal port)

```bash
curl -X POST http://localhost:7012/v1/oauth/introspect \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <client-token>" \
  -d '{ "token": "<token-to-inspect>" }'
```

### Validate (internal port)

```bash
curl -X POST http://localhost:7012/v1/token/validate \
  -H "Content-Type: application/json" \
  -d '{ "token": "<token>" }'
```

### List clients (internal port)

```bash
curl http://localhost:7012/v1/clients
```

### Get client by ID (internal port)

```bash
curl http://localhost:7012/v1/clients/my-service
```

---

## Token Lifetimes

| Token | TTL | Scope |
|-------|-----|-------|
| `client_credentials` access token | 1 hour | Configured per-client in `REGISTERED_CLIENTS` |
| `refresh_token` | 30 days, sliding — rotated on every use | Inherits scopes from the originating grant |
| `authorization_code` | 10 minutes | Single-use — deleted on exchange |
| OTP-issued access token | 30 minutes | `otp:verified` |
| OTP code (Redis) | 5 minutes | Single-use — deleted on successful verify |
| OTP attempt counter (Redis) | Co-expires with OTP code | Max 5 attempts per email per OTP |
| OTP redemption claim (Redis) | 5 minutes | Prevents double-redeem of a verified OTP |
| Revocation record (Redis) | Remaining token TTL | Auto-expires with the token |
| Family revocation record (Redis) | Remaining refresh token TTL | Blocks all tokens in the revoked family |

---

## Key Design Notes

- **No auth on revoke (RFC 7009):** The revoke endpoint always returns 200 regardless of token validity. Returning errors would reveal token existence to attackers.
- **Introspect returns `{active: false}` not errors (RFC 7662):** Unparseable or expired tokens return 200 `{active: false}`, not 4xx.
- **`authorization_code` is flag-gated:** The grant is off unless `ENABLE_AUTH_CODE_GRANT="true"`. While disabled, `GET /v1/oauth/authorize` returns a direct 501 (no redirect — avoids open-redirect on an unconfigured flow) and the `authorization_code` grant on `POST /v1/oauth/token` returns 501. When enabled, both endpoints are fully functional. The `/authorize` endpoint requires a `user_id` query parameter (placeholder for login-UI session integration). PKCE S256 is required.
- **OTP delivery is wired:** `internal/clients/HttpClient.SendEmail` calls communications-api directly using the locally-generated client. Delivery failures are non-fatal — the OTP is already stored in Redis, so the handler logs the error and returns 200. Returning a 5xx would let an attacker probe email existence or comms availability by comparing responses.
- **OTP attempt limiting (INCR-first):** Verify atomically increments `otp:attempts:<email>` *before* checking the submitted code; once the returned count exceeds `MaxAttempts` (5) the request is rejected with 429 before the OTP is even looked up. The counter is deleted on successful verify. This closes the check-then-act race where concurrent requests could each read a pre-limit count and all slip past the cap.
- **OTP subject resolution:** Every OTP token requires a resolved user UUID via `customer-api.GetUserCredentials` (called with a 30s service token). The JWT `sub` is the bare UUID — the `USER#` prefix is a DynamoDB key artifact and never appears in tokens or cross-service payloads. There is no guest/email-subject fallback: a customer-api lookup error returns 503, and an unresolved account (valid OTP, no matching customer-api record) returns 401. OTP exists only to authenticate an existing account or verify email during account creation — both require a resolved identity.
- **Internal port auth split:** `/v1/oauth/introspect`, `/v1/clients`, and `/v1/clients/{id}` run through `ClientType` + `Auth` middleware (bearer token required) — the client registry exposes `allowed_scopes` per client and must not be enumerable by any caller that can merely reach the private listener. `/v1/token/validate` is the sole exception: it is deliberately unauthenticated, since the submitted token is itself the credential being validated. All internal routes additionally rely on network-level isolation (VPC private subnet). Do not expose port 7012 publicly.
- **RS256 only:** ECDSA and other key types are not supported at the JWKS endpoint. Keys are parsed from PEM at startup and hot-reloaded on rotation; the active and previous `kid` are both verifiable and published during the overlap window (`docs/adr/003-key-rotation.md`).
