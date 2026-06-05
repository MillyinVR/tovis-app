# Sprint 2 NFC / Claim Trust-Boundary Audit

## Status

Complete for Sprint 2 targeted scope  
Remaining risk: raw-token storage and deeper NFC entropy/rate-limit hardening remain follow-up items

## Scope

This audit covers Sprint 2 trust-boundary hardening for:

- client claim-link behavior
- claim-page state handling
- raw claim token risk
- NFC tap intent behavior
- NFC short-code redirect behavior
- known future hardening around token hashing, card/code entropy, rate limits, and audit depth

This audit verifies behavior covered by tests. It does not claim full production operational proof, deployed staging proof, or complete token architecture migration.

## Claim-link flow

Covered in Sprint 2:

- lib/clients/clientClaimLinks.test.ts
- lib/clients/clientClaim.test.ts
- app/claim/[token]/page.test.tsx

Verified:

- revoked links cannot be claimed
- already-claimed client identities cannot be claimed again
- wrong signed-in client gets mismatch state
- missing invite/client/booking fails safely
- successful claim writes accepted audit state
- update races return deterministic states
- claim mutation prevents wrong-client claim
- page renders safe state-specific UI
- claim page handles missing, revoked, already-claimed, mismatch, unverified, non-client, ready, and conflict states

## Claim-link trust-boundary decision

Claim-link behavior is covered for Sprint 2.

Current behavior is acceptable for Sprint 2 because:

- revoked links are blocked
- already-claimed identities are blocked
- wrong-client claims are blocked
- missing data fails safely
- race outcomes are deterministic
- accepted claim state is audited
- public claim UI renders controlled states instead of leaking unsafe details

This does not mean the long-term token storage model is final.

## Raw token risk

ProClientInvite.token is currently looked up directly.

This is documented as accepted temporary behavior for Sprint 2, but should be hardened later.

Recommended future migration:

- store only a token hash
- compare hashed incoming claim token
- add token expiry if not already present
- add revoked/used audit metadata
- consider using a ClientActionToken-style model
- add migration/backfill plan if existing live invite links must remain valid
- document token rotation/expiration behavior before broader public rollout

## NFC / tap-code flow

Covered in Sprint 2:

- app/t/[cardId]/page.test.tsx
- app/c/[code]/page.test.tsx

Verified:

- NFC tap page rejects missing cards
- NFC tap page rejects inactive cards
- NFC tap page creates tap intents with 30-minute expiry
- NFC tap page stores userId when a signed-in user is present
- NFC tap page derives claim intents
- NFC tap page derives Pro booking intents
- NFC tap page derives salon white-label intents
- NFC tap page rejects unsafe external next overrides
- NFC tap page rejects protocol-relative next overrides
- NFC short-code page normalizes codes before lookup
- NFC short-code page rejects missing cards
- NFC short-code page rejects inactive cards
- NFC short-code page redirects active cards to /t/[cardId]

## NFC / tap-code trust-boundary decision

NFC/tap-code behavior is covered for Sprint 2 targeted scope.

Current behavior is acceptable for Sprint 2 because:

- missing/inactive cards do not proceed
- short codes are normalized before lookup
- active short codes redirect through the canonical tap route
- tap intent creation is time-limited
- signed-in user context is stored when present
- unsafe redirect overrides are rejected
- intent type derivation is covered for claim, Pro booking, and salon white-label paths

This does not mean NFC/tap-code is fully hardened for public rollout.

## Remaining NFC / tap-code risks

The following are still follow-up hardening items:

- confirm card IDs are non-enumerable
- confirm short codes are high entropy or rate-limited
- add rate limiting around /c/[code] and /t/[cardId]
- confirm revoked/deactivated cards cannot initiate booking in deployed environments
- verify unready Pros cannot be booked through tap-code flow
- verify booking intent handoff is logged with enough audit context
- verify duplicate tap behavior is idempotent or safely repeatable
- consider audit events for tap intent creation
- review whether safe local next overrides should be restricted to an allowlist
- document tenant/white-label behavior once tenant model exists

## Launch-readiness treatment

Sprint 2 claim/NFC trust-boundary behavior is locally covered by tests.

This supports private beta readiness, but it does not replace:

- deployed staging proof
- rate-limit proof for NFC/tap-code routes
- live observability proof
- Sentry dashboard proof
- Slack alert routing proof
- public rollout token-hardening decisions
- tenant isolation proof if white-label NFC is in public scope

## Required evidence

Before marking this audit complete in launch docs, record the focused test run.

text id="ed61qc" Command: Commit: Branch: Environment: Result: Test files: Tests: Failures: Decision: 

Recommended focused command:

bash id="8cbsy4" pnpm test -- \   lib/clients/clientClaimLinks.test.ts \   lib/clients/clientClaim.test.ts \   app/claim/[token]/page.test.tsx \   app/t/[cardId]/page.test.tsx \   app/c/[code]/page.test.tsx 

If the project uses a different Vitest invocation for these files, record the actual command that was run.

## Sprint 2 decision

Claim-link behavior is covered for Sprint 2.

NFC/tap-code behavior is now covered for Sprint 2 targeted scope.

Raw claim-token lookup remains an accepted temporary risk.

NFC card/code entropy, rate limiting, duplicate-tap behavior, deployed proof, and deeper public-rollout hardening remain follow-up work.

## Follow-up tracker

| Follow-up | Status | Launch treatment |
|---|---|---|
| Migrate ProClientInvite.token to hashed token storage | TODO | Public-rollout hardening unless accepted as risk |
| Add/confirm claim-token expiry | TODO | Recommended before broader rollout |
| Add revoked/used audit metadata if missing | TODO | Recommended before broader rollout |
| Confirm NFC card IDs are non-enumerable | TODO | Required before public rollout if NFC is public |
| Confirm short-code entropy or rate limiting | TODO | Required before public rollout if short codes are public |
| Add rate limits for /c/[code] and /t/[cardId] | TODO | Required before public rollout if NFC is public |
| Verify unready Pros cannot be booked through tap-code flow | TODO | Required if tap-code booking is in launch scope |
| Verify duplicate-tap behavior | TODO | Required before public rollout if NFC is public |
| Add tap intent audit event proof | TODO | Recommended before public rollout |
| Review local next override allowlist | TODO | Recommended before public rollout |
| Define tenant behavior for NFC cards | TODO | Required before white-label public scope |

## Related files

- lib/clients/clientClaimLinks.test.ts
- lib/clients/clientClaim.test.ts
- app/claim/[token]/page.test.tsx
- app/t/[cardId]/page.test.tsx
- app/c/[code]/page.test.tsx

## Maintenance rule

Do not mark claim/NFC trust-boundary work complete just because the pages render.

The boundary is complete only when invalid, revoked, already-used, mismatched, unsafe-redirect, inactive-card, and duplicate/race cases fail safely, and when remaining raw-token or enumerable-code risks are explicitly tracked.