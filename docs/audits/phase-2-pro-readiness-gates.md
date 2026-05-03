# Phase 2 Baseline - Pro Readiness Gates

Branch: audit/phase-2-pro-readiness-gates
Based on Phase 1 commit: d3e33b3

## Scope

Phase 2 stayed limited to Pro readiness and bookability enforcement.

## Implemented

- Added `PRO_NOT_READY` booking error.
- Hardened `lib/pro/readiness/proReadiness.ts` as the authoritative Pro bookability evaluator.
- Added transaction-compatible readiness checking with `checkProReadinessWithDb`.
- Required explicitly bookable, ready locations for Pro readiness.
- Ignored invalid draft/unbookable locations when a valid bookable location exists.
- Added booking write-boundary readiness gate for:
  - `createHold`
  - `finalizeBookingFromHold`
  - `createProBooking`
- Added Pro-created booking preflight in `createProBookingWithClient` so unready Pros fail before client/invite side effects.

## Verified behavior

- Unready Pros cannot create holds.
- Unready Pros cannot finalize bookings from holds.
- Unready Pros cannot create Pro-side bookings.
- Pro-created booking preflight blocks before:
  - resolving or creating clients
  - creating bookings
  - creating invite links
  - enqueueing invite delivery
- Search/discovery regression tests still pass.
- Public search/discovery remains constrained to approved public Pro surfaces.

## Targeted test command

pnpm vitest run lib/pro/readiness/proReadiness.test.ts lib/booking/createProBookingWithClient.test.ts lib/booking/writeBoundary.overrideAudit.test.ts lib/booking/writeBoundary.readiness.test.ts lib/search/pros.test.ts lib/discovery/nearbyPros.test.ts app/api/pros/nearby/route.test.ts

Result:

PASS - 7 test files passed, 48 tests passed.

Note:

The `app/api/pros/nearby/route.test.ts` suite intentionally logs an error in its 500-path test. The suite passes.

## Typecheck

Command:

pnpm typecheck

Result:

FAIL - existing Phase 0 Looks/feed viewerSaved errors remain.

Observed errors:

- app/(main)/looks/_components/LooksFeed.test.tsx: viewerSaved may be undefined.
- lib/looks/mappers.test.ts: viewerSaved missing in mapper test inputs.

No new Pro readiness or booking lifecycle type errors were observed.

Expected baseline:

Phase 0 documented existing Looks/feed viewerSaved type errors. Those are out of scope for Phase 2 unless new readiness or booking lifecycle errors appear.

## Phase 2 completion criteria

- Pro readiness is enforced by backend mutation gates.
- Pro readiness evaluator has dedicated unit tests.
- Hold creation blocks unready Pros.
- Client booking finalization blocks unready Pros.
- Pro-created booking blocks unready Pros.
- Pro-created booking preflight avoids side effects when Pro is unready.
- Search/discovery tests pass.
- Targeted Phase 2 tests pass.
