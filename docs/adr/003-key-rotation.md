# ADR 003 — RS256 Signing-Key Rotation

- **Status:** Accepted — core mechanism shipped (forge-sdk v0.17.0, 2026-06-09); keyset-secret migration and operational proof pending (see Implementation Status)
- **Date:** 2026-06-12 (converted from `docs/key-rotation-design.md`, proposed 2026-05)
- **Deciders:** rad
- **Supersedes:** `docs/key-rotation-design.md` (removed; full original analysis in git history)

## Context

With a single signing key, swapping the key invalidates every live token at once: old-`kid` tokens become unverifiable the moment the old public key leaves JWKS, and with 30-day refresh tokens that means a fleet-wide auth outage lasting up to a month of stragglers. Rotation (routine hygiene or compromise response) must be a zero-downtime runbook, not a deploy-and-pray. This is a key-lifecycle problem, not a crypto problem: the issuer must hold **more than one valid key at a time** and move traffic between them.

## Decision

1. **Keyset model: one active signer, N verify-only keys.** Signing always uses the active key and stamps its `kid`; JWKS publishes every key in the set; all verification (consumers via `JWKSVerifier`, issuer hot paths) resolves the key by the token's `kid`. **Invariant: a key's public half stays in JWKS for at least one max-token-TTL window after it stops signing** — tokens outlive the decision to stop signing; the public key must outlive the tokens.
2. **Secret shape (target): one Secrets Manager secret holding a JSON keyset** — `{ activeKid, keys: [{kid, alg, status, privateKeyPem?, publicKeyPem}] }`. Single secret ⇒ atomic reads (no partial-state race), atomic rotation steps (each runbook step is one `PutSecretValue`; version history is the audit log), and `activeKid` lives with the key material instead of a drift-prone separate env var. Verify-only entries carry no private key. **Rejected:** N separate secrets (reintroduces the partial-read race; no atomic step semantics).
3. **Manual, runbook-driven rotation for v1.** Scheduled/automated rotation (SM rotation Lambda) is deliberately deferred until the manual path is proven.
4. **Hot reload, no deploy.** The issuer watches the secret (`secretsmanager.Watch`); a rotation is a secret write, not a redeploy.

## As-built vs target

What shipped (v0.17.0) is a **two-slot** realization of the keyset model inside `internal/jwt`: an atomic `active` + `previous` key pair. On a watched secret update, the incoming key becomes active and the prior key slides to `previous`; verification accepts either `kid`; JWKS publishes both. The secret still carries flat `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY` / `JWT_KID` — the JSON keyset shape of Decision 2 is **not yet migrated**.

Consequences of the gap: the overlap window holds at most two keys, and the "pre-publish before signing" staging step below collapses (a new key signs immediately on rotation). Both are acceptable — the SDK verifier's refetch-on-`kid`-miss absorbs propagation, so the collapse costs a one-time JWKS refetch spike, not correctness. The keyset-secret migration restores full staging and >2-key overlap.

## Rotation Runbook

`T_max` = longest live token TTL = **30 days** (refresh). Target-state procedure (keyset secret); with today's two-slot implementation, steps 1–2 are a single secret write.

| Step | Keyset state | JWKS serves | Signs | Effect |
|---|---|---|---|---|
| 0. Steady state | A active | A | A | Baseline |
| 1. Add new key verify-only | A active, B verify-only | A + B | A | B propagates to consumer caches before anything depends on it |
| 2. Flip active signer | B active, A verify-only | A + B | **B** | New tokens carry `kid=B`; old `kid=A` tokens still verify |
| 3. **Wait ≥ `T_max`** | unchanged | A + B | B | Every token signed under A expires. **The wait is the safety guarantee — never skip it** |
| 4. Retire old key | B active | B | B | A removed; no live token references it |

**Emergency rotation (compromise):** the 30-day wait is the opposite of what you want — old tokens should die. Do steps 1→2 immediately, then revoke outstanding refresh-token JTIs via the Redis denylist and retire A early. Access tokens signed under A remain valid until their 30-min TTL lapses — accepted (matches the ADR 001 revocation SLA).

**The 30-day window is a lever, not a fixed cost:** refresh-token rotation-on-use (TODO Phase 2, decided with the sliding-session model) churns live refresh tokens well under 30 days in practice, letting emergency retirement lean on revocation rather than the full window.

## Edge Cases

- Token with a retired `kid` fails verification — correct; the mitigation is honoring the wait, not softening verification.
- Consumer cache staleness is bounded by max(verifier `CacheTTL` 5m, JWKS `Cache-Control`); a fresh `kid` triggers the verifier's one-shot refetch. Lowering JWKS `max-age` to ≤300s (TODO Phase 3) aligns the passive horizon.
- Loader fails fast at startup on a missing/invalid active key — a signer with no active key must never serve.
- Only auth-api signs. If that ever changes, every signer loads the same keyset secret — another reason it is single and centrally owned.

## Implementation Status (2026-06-12)

| Item | State |
|---|---|
| In-process overlap (active + previous, atomic), `kid`-resolved verification, JWKS publishes both, `sm.Watch` hot reload, RS256 pinned | ✅ shipped (forge-sdk v0.17.0; minting instance-based in `internal/jwt`) |
| JSON keyset secret migration (Decision 2 shape; removes the 2-key limit, restores staged pre-publish, retires flat `JWT_*` keys) | Pending — V2-adjacent; not a V1 blocker given the two-slot mechanism works |
| JWKS `Cache-Control` ≤300s | TODO Phase 3 |
| Runbook into ops docs + full dry-run in dev (add → flip → compressed wait → retire, no verification failures) | TODO Phase 7 |
| Scheduled rotation automation | Deferred until the manual path is proven |
