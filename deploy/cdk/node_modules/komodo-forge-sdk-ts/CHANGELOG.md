# Changelog

All notable changes to `@komodo-forge-sdk/typescript` will be documented here.

---

## [0.4.0] — 2026-06-22

### Added
- **Biome formatter** — tabs, single quotes, trailing commas, 120-char line width, import organization; CI-gated via `format:check`
- **Config validators** — `isValidARN`, `isValidDomain`, `isValidCpu`, `isValidMemory`, `isValidCapacity`, `isValidEnvironment`, `isValidVersion`, `isValidRegion`, `isValidRegionDeploy`, `isValidAccount`, `isValidTags`, `isValidUpstreamDownstreamUrl`, `validateConfig`
- **`env` field on `EnvConfig`** — explicit environment identifier (`dev`/`staging`/`prod`), separate from `name` (service name)
- **`tags` field on `EnvConfig`** — `Record<string, string>` propagated via `cdk.Tags.of(stack).add()`; default configs include `owner`, `managedBy`, `environment`
- **`createRegionDeploy` helper** — factory for `RegionDeploy` objects
- **`release.sh` version-match guard** — release fails if CHANGELOG version doesn't match package.json / target version
- **`Region` type export** — extracted from `RegionDeploy` for reuse

### Changed
- **`EnvConfig.name`** — now represents the service/app name (defaults to `''`); previously carried the environment value
- **Default config tag keys** — standardized to lowercase (`owner`, `managedBy`, `environment`) to match `TagsConfig` interface
- **`TagsConfig`** — expanded with `version`, `tier`, `autoStart`, `dataClassification` fields
- **`createTags`** — defaults `owner` to `'Komodo Future Solutions'` and `managedBy` to `'cdk'` when called without args
- **`defaultTags`** — returns `managedBy: 'cdk'` (was `'Komodo Future Solutions'`)
- **Staging/prod regions** — `us-west-2` now `enabled: true` by default

## [0.3.3] — 2026-06-22

### Changed
- **FargatePublicService / FargatePrivateService** — extracted shared logic (task def, container, secret grant, auto-scaling, CPU/memory alarms) into `buildFargateService` helper to eliminate duplication
- **WafWebAcl** — `scope` is now configurable (`'REGIONAL'` | `'CLOUDFRONT'`), defaults to `'REGIONAL'`
- **MetricFilterAlarm** — `metricValue` and `defaultValue` are now configurable props with existing defaults

## [0.3.2] — 2026-06-22

### Added
- **CDK Constructs** — Higher-level reusable infrastructure constructs:
  - `FargatePublicService` — complete public-facing Fargate service with ALB, SGs, auto-scaling, and standard alarms
  - `FargatePrivateService` — VPC-internal Fargate service with SGs, auto-scaling, and standard alarms
  - `WafWebAcl` — WAF WebACL with managed rule groups, global rate limiting, and path-scoped rate limits
  - `MetricFilterAlarm` — combined CloudWatch Logs metric filter and alarm
- Tests for all new constructs

## [0.3.1] — 2026-06-22

### Fixed
- **Observability barrel export** — `src/deploy/cdk/observability/index.ts` was empty; now re-exports `alarms` and `logs` modules
- **Missing package exports** — added `./cdk` barrel export and `./cdk/constants` export to package.json

## [0.3.0] — 2026-06-22

### Added
- **AWS CDK Deployment Templates** — Comprehensive CDK modules for infrastructure-as-code deployment:
  - **Compute** — Fargate and Lambda constructs
  - **Config** — Configuration management for CDK stacks
  - **Constructs** — Reusable CDK construct library
  - **Messaging** — SNS and SQS messaging constructs
  - **Networking** — VPC and security group constructs
  - **Observability** — CloudWatch alarms and log management
  - **Security** — IAM, KMS, and Secrets Manager constructs
- **oxlint** — Fast Rust-based linter configuration replacing ESLint
- **CHANGELOG.md** — Added changelog to track project changes
- Package exports for CDK deployment modules (`./cdk/*`)

### Changed
- Replaced ESLint with oxlint for faster linting (removed eslint.config.mts and src/shared/eslint/)
- Updated package.json scripts: `lint` and `lint:fix` now use oxlint
- Updated CI workflow to use oxlint instead of ESLint
- `pnpm release` now releases the current `package.json` version when called with no arguments
- Updated dependencies to include aws-cdk-lib and constructs for CDK support

---

## [0.2.1] — 2026-06-06

### Added
- `pnpm fresh` script — wipes `node_modules`, upgrades all deps to latest, and reinstalls from scratch

### Changed
- All dependencies upgraded to latest versions
- pnpm upgraded to 11.5.2 via corepack

---

## [0.2.0] — 2026-06-06

### Added
- **Middleware** — full suite: authentication, CORS, rate limiting, request validation, and error handling
- **Observability** — OpenTelemetry tracing and metrics support
- **HTTP client** — retry logic, request/response interceptors, typed error classes (`src/shared/http/errors/`)
- **WebSocket** — full implementation of the WebSocket handler
- **Security** — new shared security utilities module (`src/shared/security/`)
- **Config** — `constants.ts` module and configurator submodule
- **Release scripts** — `scripts/release.sh` and `scripts/_lib.sh` for automated version bump, build, tag, and push
- `pnpm release` script wired up in `package.json`

### Changed
- AWS module: `dynamo` renamed to `dynamodb`, `rds` renamed to `aurora`
- Health check handler expanded
- `.gitignore` hardened — covers env files, secrets, `.claude/`, OS artifacts

---

## [0.1.0] — 2026-03-24

### Added
- Initial SDK scaffold migrated and adapted from `forge-sdk-ts`
- Top-level directory reorganization: `backend/` → `api/`, `frontend/` → `client/`
- `dist/` exports committed to repo; CI workflow added (`.github/workflows/build.yml`)
- **Logging** — full Komodo logger implementation split across: `base`, `config`, `format`, `handler`, `schema`, `logger`, `worker` (browser + Node)
- **API adapters** — auth, entitlements, events, feature-flags, payments, user (each with adapter, models, index, and test stub)
- **AWS wrappers** — CloudFront, CloudWatch, DynamoDB, Lambda, RDS, S3, Secrets Manager, SES, SNS, SQS
- **Client utilities** — browser helpers, pagination, service stubs
- **Shared modules** — concurrency, crypto, HTTP (client, correlation, utils), redaction, utils (formatting, objects, type-guards, validation)
- **Config** — configurator, types, utils with full test coverage
- **ESLint config** exported from `shared/eslint`
- Test stubs added across all modules (vitest)
