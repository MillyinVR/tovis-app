# Sprint 2 Closeout — Token + idempotency hardening

## Status

Complete for Sprint 2 targeted scope  
Launch treatment: Locally/code complete; deployed staging proof and broader public-rollout hardening remain separate Phase 2 launch-readiness work

## Goal

Harden public/token-based flows so active aftercare, rebook, claim-link, and NFC/tap-code paths cannot regress to unsafe legacy behavior.

Sprint 2 focused on:

- aftercare secure-link access
- client rebook idempotency
- aftercare publicToken deprecation guardrails
- client claim-link behavior
- claim-page state handling
- NFC tap intent behavior
- short-code redirect behavior
- documenting remaining raw-token migration risk
- documenting remaining NFC/tap-code public-rollout hardening

## Scope boundary

This closeout records Sprint 2 code/test completion.

It does not claim:

- deployed staging proof
- live Sentry dashboard proof
- Slack alert-routing proof
- provider-dashboard proof
- public-rollout readiness
- full token architecture migration
- complete NFC/tap-code abuse hardening

Those remain tracked in Phase 2 launch-readiness docs.

## Files changed

### Aftercare token hardening

- lib/aftercare/aftercarePublicTokenDeprecation.test.ts
- lib/aftercare/unclaimedAftercareAccess.ts
- lib/aftercare/unclaimedAftercareAccess.test.ts
- app/api/client/rebook/[token]/route.test.ts

### Client claim hardening

- lib/clients/clientClaimLinks.test.ts
- lib/clients/clientClaim.test.ts
- app/claim/[token]/page.test.tsx

### NFC / tap-code hardening

- app/t/[cardId]/page.test.tsx
- app/c/[code]/page.test.tsx

## Acceptance criteria

- [x] Active aftercare/rebook paths do not use aftercare.publicToken.
- [x] Active aftercare/rebook paths are backed by ClientActionToken.
- [x] AftercareSummary.publicToken is allowed only as a legacy schema field for now.
- [x] Public-token regression guard exists.
- [x] Public aftercare read resolver comment reflects current ClientActionToken-backed behavior.
- [x] Rebook GET resolves token-backed access without consuming token usage.
- [x] Rebook GET does not expose publicToken.
- [x] Rebook POST uses token-scoped idempotency actor key.
- [x] Rebook POST does not create duplicate bookings on handled/replayed idempotency responses.
- [x] Rebook POST marks token used only after successful booking creation.
- [x] Rebook POST fails idempotency on mutation/token usage errors.
- [x] Claim-link creation/update behavior is tested.
- [x] Claim-link public state behavior is tested.
- [x] Claim-link accepted audit behavior is tested.
- [x] Claim mutation prevents wrong-client claim.
- [x] Claim mutation handles revoked, already-claimed, missing-client, mismatch, conflict, and race states.
- [x] Claim page renders/redirects correctly for missing, revoked, already-claimed, mismatch, unverified, non-client, ready, and conflict states.
- [x] NFC tap page rejects missing/inactive cards.
- [x] NFC tap page creates tap intents with 30-minute expiry.
- [x] NFC tap page stores userId when a user is present.
- [x] NFC tap page derives claim, Pro booking, and salon white-label intents.
- [x] NFC tap page rejects unsafe external/protocol-relative next overrides.
- [x] NFC short-code page normalizes codes before lookup.
- [x] NFC short-code page rejects missing/inactive cards.
- [x] NFC short-code page redirects active cards to /t/[cardId].

## Verified behavior

### Aftercare / rebook

Verified:

- active aftercare access no longer depends on AftercareSummary.publicToken
- rebook access resolves through token-backed access
- rebook GET does not consume token usage
- rebook GET does not expose publicToken
- rebook POST uses token-scoped idempotency actor keys
- replayed/handled idempotency responses do not create duplicate bookings
- token usage is marked only after successful booking creation
- mutation/token usage errors fail idempotency safely

### Client claim links

Verified:

- revoked links cannot be claimed
- already-claimed client identities cannot be claimed again
- wrong signed-in client gets mismatch state
- missing invite/client/booking fails safely
- successful claim writes accepted audit state
- update races return deterministic states
- claim mutation prevents wrong-client claim
- claim page renders safe state-specific UI

### NFC / tap-code

Verified:

- missing cards are rejected
- inactive cards are rejected
- tap intents are created with 30-minute expiry
- userId is stored when a user is present
- claim, Pro booking, and salon white-label intents are derived
- unsafe external next overrides are rejected
- protocol-relative next overrides are rejected
- short codes are normalized before lookup
- missing/inactive short-code targets are rejected
- active short codes redirect to /t/[cardId]

## Known remaining risk

### AftercareSummary.publicToken

AftercareSummary.publicToken still exists in Prisma as a legacy schema field.

Current policy:

- active aftercare access must use ClientActionToken(kind = AFTERCARE_ACCESS)
- active client/pro API responses must not expose publicToken
- active rebook links must not be built from publicToken
- AftercareSummary.publicToken remains tolerated only as a legacy schema field until migration/removal

Future migration:

1. Confirm no active rows depend on AftercareSummary.publicToken.
2. Backfill ClientActionToken access for any legacy sent aftercare summaries if needed.
3. Add telemetry for any legacy fallback usage if fallback remains.
4. Drop AftercareSummary.publicToken in a later migration.

### ProClientInvite.token

Client claim links currently use raw ProClientInvite.token lookup.

Current status:

- behavior is covered by tests
- revoked/already-claimed/mismatch/race outcomes are covered
- wrong-client claims are blocked
- accepted claim state is audited
- this is accepted temporarily for Sprint 2

Future hardening:

- migrate claim links to hashed token storage or a ClientActionToken-style model
- avoid raw token lookup in long-term production design
- consider expiry/rotation if claim links are long-lived
- add revoked/used audit metadata if missing
- document migration behavior for existing live invite links before dropping raw-token lookup

### NFC card IDs and short codes

NFC tap and short-code behavior is now covered by page tests.

Current status:

- missing/inactive cards are rejected
- short-code normalization is covered
- active short codes redirect to canonical tap route
- unsafe external/protocol-relative redirects are rejected
- tap intent creation is covered

Future hardening:

- confirm card IDs are non-enumerable
- confirm short codes are high entropy or rate-limited
- add rate limiting around /c/[code] and /t/[cardId]
- verify revoked/deactivated cards cannot initiate booking in deployed environments
- verify unready Pros cannot be booked through tap-code flow
- verify booking intent handoff is logged with enough audit context
- verify idempotency / duplicate-tap behavior
- consider audit events for tap intent creation
- review whether safe local next overrides should be restricted to an allowlist
- document tenant/white-label behavior once tenant model exists

## Launch-readiness treatment

Sprint 2 is complete for targeted code/test hardening.

This supports launch readiness, but does not replace Phase 2 operational proof.

Before private beta, still required:

- staging deploy proof
- health/readiness proof
- Sentry release/environment event proof
- core booking smoke proof
- payment/webhook proof if payments are enabled
- media/private-media proof if media is enabled
- Slack or approved alert destination proof
- rollback owner/path

Before public rollout, still required:

- named backup owner
- tested P1 escalation path
- live Sentry/provider dashboard proof
- alert-routing proof
- load proof against target environment
- chaos/failure proof
- provider quota/capacity proof
- final go/no-go signoff

## Test commands

Recommended focused Sprint 2 verification:

bash pnpm test -- \   lib/aftercare/aftercarePublicTokenDeprecation.test.ts \   lib/aftercare/unclaimedAftercareAccess.test.ts \   app/api/client/rebook/[token]/route.test.ts \   lib/clients/clientClaimLinks.test.ts \   lib/clients/clientClaim.test.ts \   app/claim/[token]/page.test.tsx \   app/t/[cardId]/page.test.tsx \   app/c/[code]/page.test.tsx  pnpm typecheck 

Recommended broader verification:

bash pnpm test pnpm typecheck 

## Evidence template

Record the actual completed run here when closing the sprint.

text Command: Commit: Branch: Environment: Result: Test files: Tests: Failures: Typecheck: Decision: 

## Sprint 2 decision

Sprint 2 token/idempotency hardening is complete for targeted scope.

Aftercare/rebook active paths are ClientActionToken-backed.

Rebook idempotency behavior is covered.

Claim-link behavior is covered.

NFC/tap-code targeted behavior is covered.

Remaining raw-token, card/code entropy, rate-limit, duplicate-tap, deployed-proof, and public-rollout hardening items are tracked as follow-up work, not as missing Sprint 2 implementation.

## Follow-up tracker

| Follow-up | Status | Launch treatment |
|---|---|---|
| Confirm no active rows depend on AftercareSummary.publicToken | TODO | Required before dropping legacy field |
| Backfill ClientActionToken access for any legacy aftercare summaries if needed | TODO | Required if legacy rows exist |
| Drop AftercareSummary.publicToken | TODO | Later migration |
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
| Add deployed staging proof for token/NFC flows | TODO | Required before public rollout if flows are public |

## Related documents

- docs/launch-readiness/checklist.md
- docs/launch-readiness/go-no-go.md
- docs/launch-readiness/private-beta-checklist.md
- docs/launch-readiness/public-rollout-checklist.md
- docs/launch-readiness/risk-register.md
- docs/launch-readiness/sentry-dashboard.md
- docs/launch-readiness/slack-alerts.md
- docs/privacy/phase-1-privacy-proof.md
- docs/privacy/phase-1-remaining-work.md

## Maintenance rule

Do not mark token or NFC hardening complete just because the happy path works.

The boundary is complete only when invalid, revoked, already-used, mismatched, replayed, unsafe-redirect, inactive-card, and race cases fail safely, and when remaining raw-token or enumerable-code risks are explicitly tracked.