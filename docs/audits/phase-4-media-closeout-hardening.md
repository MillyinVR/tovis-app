# Phase 4 Baseline - Media Closeout Hardening

Branch: audit/phase-4-media-closeout-hardening
Based on Phase 3 commit: b77d704

## Scope

Phase 4 stayed limited to booking session media upload and closeout hardening.

## Findings

The media lifecycle already had several important protections:

- Booking media is created through `uploadProBookingMedia`.
- Booking media uploads verify the booking belongs to the authenticated professional.
- Completed, pending, and cancelled bookings are rejected by the write boundary.
- BEFORE media is only accepted during `BEFORE_PHOTOS`.
- AFTER media is only accepted during `AFTER_PHOTOS`.
- Session media is stored in the private media bucket.
- The media metadata route verifies uploaded objects exist before writing database rows.
- GET `/api/pro/bookings/[id]/media` verifies booking ownership before returning media rows.

## Implemented

- Hardened POST `/api/pro/bookings/[id]/media`.
- Replaced booking-level storage path validation with booking-and-phase-level validation.
- `storagePath` must now be under `bookings/<bookingId>/<phase>/`.
- `thumbPath`, when present, must also be under `bookings/<bookingId>/<phase>/`.
- Added route tests proving forged phase-mismatched storage metadata is rejected before:
  - idempotency ledger work
  - storage existence checks
  - media write-boundary calls

## Why

The signed upload route already generates booking-scoped and phase-scoped paths, such as:

- `bookings/<bookingId>/before/...`
- `bookings/<bookingId>/after/...`
- `bookings/<bookingId>/other/...`

However, the final media metadata-save route still accepts browser-submitted `storageBucket`, `storagePath`, `thumbBucket`, and `thumbPath`. Server-side metadata saves must re-check the same path contract because browser-submitted metadata is not trusted input.

## Targeted test command

pnpm vitest run "app/api/pro/bookings/[id]/media/route.test.ts" lib/booking/writeBoundary.media.test.ts lib/booking/writeBoundary.closeoutAudit.test.ts lib/booking/writeBoundary.clientCheckout.test.ts lib/aftercare/unclaimedAftercareAccess.test.ts

Result:

PASS - 5 test files passed, 44 tests passed.

Note:

The `app/api/pro/bookings/[id]/media/route.test.ts` suite intentionally logs an error in its 500-path test. The suite passes.

## Typecheck

Command:

pnpm typecheck

Result:

FAIL - existing Phase 0 Looks/feed viewerSaved errors remain.

Observed errors:

- app/(main)/looks/_components/LooksFeed.test.tsx: viewerSaved may be undefined.
- lib/looks/mappers.test.ts: viewerSaved missing in mapper test inputs.

No new media route or closeout type errors were observed.

Expected baseline:

Phase 0 documented existing Looks/feed viewerSaved type errors. Those are out of scope for Phase 4 unless new media route or closeout errors appear.

## Phase 4 completion criteria

- Booking session media metadata paths are booking-scoped.
- Booking session media metadata paths are phase-scoped.
- Forged phase-mismatched storage paths are rejected before idempotency.
- Forged phase-mismatched thumb paths are rejected before idempotency.
- Existing media lifecycle and closeout tests pass.
- Targeted Phase 4 tests pass.
