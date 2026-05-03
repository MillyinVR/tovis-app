# Phase 7 Baseline - Lifecycle Integration Coverage

Branch: audit/phase-7-lifecycle-integration-coverage
Based on Phase 6 commit: 20b2e56

## Scope

Phase 7 stayed limited to end-to-end lifecycle integration coverage around the booking write boundary.

## Findings

The repo already had strong focused coverage for individual lifecycle gates:

- Media uploads enforce phase/session-step rules.
- Direct `SessionStep.DONE` transitions are blocked.
- Client checkout/payment closeout is guarded by aftercare, payment, and media state.
- Client checkout product edits are guarded by aftercare and payment/closeout state.
- Client review eligibility is guarded by ownership, completion, aftercare, checkout, payment, and duplicate-review state.
- Client rebook is guarded by ownership, source booking completion, aftercare, checkout, and payment state.
- Client review media options route is covered by route-level tests from Phase 6.

The DB-backed integration runner exists, but local DB integration could not be run in this environment because the test Postgres/Docker dependency was unavailable. Phase 7 therefore added runnable normal Vitest lifecycle integration coverage around the write boundary instead of adding an un-runnable DB integration test.

## Implemented

- Added `lib/booking/writeBoundary.lifecycleIntegration.test.ts`.
- Added a stitched lifecycle contract test proving:
  - session start advances the booking into consultation
  - BEFORE media cannot be uploaded outside the BEFORE_PHOTOS step
  - BEFORE media can be uploaded during BEFORE_PHOTOS
  - service-in-progress requires BEFORE media
  - finishing the service advances to FINISH_REVIEW
  - checkout/payment can be collected without completing the booking when AFTER photos are missing
  - AFTER media can be uploaded during AFTER_PHOTOS
  - checkout/payment completes the booking once AFTER photos and closeout requirements are present
  - completed closeout unlocks client review eligibility
  - completed aftercare closeout supports client rebook
- Added explicit coverage that direct `SessionStep.DONE` transitions remain blocked so closeout owns completion.

## Why

Earlier phases hardened individual lifecycle pieces. Phase 7 adds a connected contract test that proves the key gates work together in sequence.

This avoids relying only on isolated tests while keeping the suite runnable without Docker or a local test database.

## Targeted test command

pnpm vitest run lib/booking/writeBoundary.lifecycleIntegration.test.ts lib/booking/writeBoundary.media.test.ts lib/booking/writeBoundary.idempotency.test.ts lib/booking/writeBoundary.clientCheckout.test.ts lib/booking/writeBoundary.clientCheckoutProducts.test.ts lib/booking/writeBoundary.clientReviewEligibility.test.ts lib/booking/writeBoundary.clientRebook.test.ts lib/booking/writeBoundary.closeoutAudit.test.ts app/api/client/bookings/[id]/review-media-options/route.test.ts

Result:

PASS - 9 test files passed, 59 tests passed.

## Integration DB baseline

Command attempted:

node scripts/with-test-db.mjs npx vitest run --config vitest.integration.config.mts tests/integration/bookingConcurrency.test.ts

Result:

NOT RUN - local test database unavailable.

Observed issue:

- Prisma could not reach the test database on `127.0.0.1:5433`.
- Docker Desktop/Postgres test container was unavailable in the local environment.

This is an environment limitation, not a Phase 7 code failure.

## Typecheck

Command:

pnpm typecheck

Result:

FAIL - existing Phase 0 Looks/feed viewerSaved errors remain.

Observed errors:

- app/(main)/looks/_components/LooksFeed.test.tsx: viewerSaved may be undefined.
- lib/looks/mappers.test.ts: viewerSaved missing in mapper test inputs.

No new lifecycle integration, booking write-boundary, closeout, review, or rebook type errors were observed.

## Phase 7 completion criteria

- Connected lifecycle write-boundary contract test added.
- Direct DONE transition remains blocked.
- Lifecycle targeted group passes.
- DB integration limitation documented.
- Existing typecheck baseline remains unchanged.
