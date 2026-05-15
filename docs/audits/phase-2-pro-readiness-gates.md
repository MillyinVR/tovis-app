# Phase 2 Baseline - Pro Readiness Gates

Branch: audit/phase-2-pro-readiness-gates  
Based on Phase 1 commit: d3e33b3

## Scope

Phase 2 stayed limited to Pro readiness and bookability enforcement.

## Implemented

- Added `PRO_NOT_READY` booking error.
- Hardened `lib/pro/readiness/proReadiness.ts` as the authoritative Pro bookability evaluator.
- Added transaction-compatible readiness checking with `checkProReadinessWithDb`.
- Added entry-point-aware readiness checking with `checkProReadinessForEntryPointWithDb`.
- Required explicitly bookable, ready locations for Pro readiness.
- Ignored invalid draft/unbookable locations when a valid bookable location exists.
- Added booking write-boundary readiness gates for:
  - `createHold`
  - `finalizeBookingFromHold`
  - `createProBooking`
- Passed `bookingEntryPoint` through booking write-boundary calls so readiness can be evaluated against the user’s booking path.
- Added Pro-created booking preflight in `createProBookingWithClient` so unready Pros fail before client/invite side effects.

## Entry-point behavior

Booking write paths now call `checkProReadinessForEntryPointWithDb`.

Current booking entry points:

- Client hold creation: `BROAD_DISCOVERY`
- Client booking finalization: `BROAD_DISCOVERY`
- Pro-created booking: `DIRECT_PROFILE`

Search/discovery indexing still uses `checkProReadinessWithDb` because it checks general searchable/bookable visibility, not a specific booking creation path.

## Verified behavior

- Unready Pros cannot create holds.
- Unready Pros cannot finalize bookings from holds.
- Unready Pros cannot create Pro-side bookings.
- Pro-created booking preflight blocks before:
  - resolving or creating clients
  - creating bookings
  - creating invite links
  - enqueueing invite delivery
- Booking readiness gates receive the expected `bookingEntryPoint`.
- Search/discovery regression tests still pass.
- Public search/discovery remains constrained to approved public Pro surfaces.

## Targeted test command

```bash
pnpm vitest run lib/pro/readiness/proReadiness.test.ts lib/booking/createProBookingWithClient.test.ts lib/booking/writeBoundary.overrideAudit.test.ts lib/booking/writeBoundary.readiness.test.ts lib/booking/writeBoundary.mobileRadius.test.ts lib/search/pros.test.ts lib/discovery/nearbyPros.test.ts app/api/pros/nearby/route.test.ts