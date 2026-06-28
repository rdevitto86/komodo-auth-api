# ADR 002 — Passkey (WebAuthn) Ceremonies

- **Status:** Accepted (one deferred value: production RP ID — see §2)
- **Date:** 2026-06-12
- **Deciders:** rad
- **Supersedes:** —

## Context

The PRD (frozen 2026-06-12) makes passkeys the primary V1 user-authentication method, with email OTP as the permanent fallback and email-verification factor. Komodo stores no passwords anywhere. Auth-api runs the WebAuthn ceremonies and mints tokens; customer-api owns the credential records (public keys only — the passkey private key never leaves the user's device).

## Decisions

### 1. Library

`github.com/go-webauthn/webauthn` — the de facto Go standard, actively maintained. No credible alternative evaluated further.

### 2. RP ID and origins

The RP ID is the domain name permanently stamped into every passkey at creation; browsers only offer a passkey on the stamped domain (the anti-phishing property). It is **non-transferable** — changing it orphans every registered passkey.

- **RP ID = the bare root domain** (never a subdomain). Subdomains all inherit it (`www.`, `shop.`, …), so site reorganization under the root is free. Confirmed 2026-06-12: the launch plan uses subdomains under one root, so passkeys registered at launch are safe for future states.
- Configured via the Secrets Manager blob: `WEBAUTHN_RP_ID`, `WEBAUTHN_ORIGINS` (exact scheme+host+port list allowed to initiate ceremonies).
- Per env: local = `localhost` (browser-special-cased; works today). Staging = staging domain or skip (throwaway). **Production = TBD — must be set to the final customer-facing root domain before the first real customer registers a passkey.** Development does not wait on it.

### 3. Ceremony parameters

| Parameter | Value | Rationale |
|---|---|---|
| Attestation | `none` | CA-chain/metadata verification buys nothing for consumer e-com; avoids privacy prompts |
| User verification | `required` | Passkey is the sole login factor; UV (biometric/PIN) makes it possession + inherence — 2FA-equivalent |
| Resident key | `preferred` | Modern platform authenticators create discoverable credentials anyway; old security keys still register. V1 login is **email-first** (email → `allowCredentials` from customer-api); a username-less one-tap flow can be added later without re-registering anyone |
| COSE algorithms | ES256 primary, RS256 fallback | Platform-authenticator standard (unrelated to the JWT RS256) |
| Sign-count regression | Log-and-allow + telemetry | Synced passkeys (iCloud/Google) legitimately report 0; rejecting locks out the mainstream case. Revisit at MFA (V2) |
| Ceremony timeout | 60s client-side | WebAuthn convention |
| Exclude credentials | On registration | Prevents duplicate registration of the same authenticator |
| Passkeys per user | Max 10 | Multi-device support with a sane abuse bound |

### 4. Endpoints

| Endpoint | Auth | Notes |
|---|---|---|
| `POST /v1/passkeys/register/begin` / `complete` | Valid user token required (OTP-verified suffices) | Registration binds to a proven identity — no anonymous registration |
| `POST /v1/passkeys/login/begin` / `complete` | Public | Full hostile-traffic middleware chain; rate limits sized to this being the new unauthenticated surface |

### 5. Ceremony state

go-webauthn `SessionData` stored in Redis, mirroring the OTP pattern: `webauthn:reg:<USER#id>` and `webauthn:login:<ceremony-uuid>`, 5-min TTL, single-use — deleted on complete, redemption serialized by an atomic `SetNX` claim (Phase 8a; the same in-process single-use mechanism as OTP, no `GETDEL` dependency).

### 6. Issued token

Successful assertion issues the standard user pair: 30-min access token (PRD decision 2026-06-12) with scope `passkey:verified` (parallel to `otp:verified` — downstream treats either as "authenticated user") + 30-day sliding refresh token. Banned-customer gate runs before issuance. RFC 8176 `amr` claim noted as a V2 consideration, not built now.

### 7. Credential storage (customer-api)

Customer-api owns the records, CRUD on its private plane, specced in its `openapi.yaml` before auth-api ceremony work starts (see its PRD alignment section). Fields: credential ID (base64url), COSE public key, sign count, transports, AAGUID, backup-eligible/backup-state flags, created/last-used. Auth-api stores none of it.

## Consequences

- Prod RP ID is the single deferred value; it gates launch promotion of passkeys, not development. If the domain is uncertain at launch, promote OTP login and flip passkeys on when final — a config change, zero code.
- The login `begin` endpoint is a new unauthenticated public surface; WAF/rate-limit sizing in TODO Phase 7 must account for it.
- Email-first login means the login page always collects email before the passkey prompt; the one-tap flow is a forward-compatible follow-up, not a V1 redesign.
