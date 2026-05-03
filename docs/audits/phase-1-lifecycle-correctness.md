# Phase 1 Baseline - Lifecycle Correctness

Branch: audit/phase-1-lifecycle-correctness
Based on Phase 0 commit: 47573a9

## Scope

Phase 1 stayed limited to booking/session lifecycle correctness.

## Implemented

- Added BookingStatus.IN_PROGRESS to blocking booking conflict statuses.
- Added conflict-query tests proving:
  - IN_PROGRESS bookings block availability.
  - CANCELLED bookings do not block availability.
- Added AFTER-photo closeout enforcement.
- Added client checkout tests proving:
  - eligible booking completes when aftercare, checkout/payment, and AFTER photos are present.
  - payment can be collected without completing the booking when AFTER photos are missing.
- Updated closeout audit tests to expect AFTER-photo media count before completion.

## Verified existing behavior

- BEFORE-photo gate already exists before SERVICE_IN_PROGRESS.
- Direct SessionStep.DONE transition is blocked.
- Payment/checkout closeout is required before completion.

## Targeted test command

pnpm vitest run lib/booking/conflictQueries.test.ts lib/booking/writeBoundary.media.test.ts lib/booking/writeBoundary.idempotency.test.ts lib/booking/writeBoundary.closeoutAudit.test.ts lib/booking/writeBoundary.clientCheckout.test.ts

Result:

PASS - 5 test files passed, 38 tests passed.

## Typecheck

Command:

pnpm typecheck

Result:

FAIL - existing Phase 0 Looks/feed viewerSaved errors remain.

Observed errors:

- app/(main)/looks/_components/LooksFeed.test.tsx: viewerSaved may be undefined.
- lib/looks/mappers.test.ts: viewerSaved missing in mapper test inputs.

No new booking lifecycle type errors were observed.

## Phase 1 completion criteria

- IN_PROGRESS blocks conflicts.
- BEFORE photos are required before service-in-progress.
- AFTER photos are required before booking completion.
- Payment/checkout remains required before booking completion.
- Targeted lifecycle tests pass.
