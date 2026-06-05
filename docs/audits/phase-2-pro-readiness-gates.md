# Phase 2 Baseline — Pro Readiness Gates

## Status

Branch: audit/phase-2-pro-readiness-gates  
Based on Phase 1 commit: d3e33b3  
Scope: Pro readiness and bookability enforcement  
Current status: IMPLEMENTED / TARGETED TEST PROOF REQUIRED  
Launch treatment: Supports Phase 2 product safety, but does not replace Phase 2 launch-ops proof

This baseline documents the Phase 2 work that prevents unready Pros from becoming bookable through client booking, Pro-created booking, and discovery/search paths.

## Scope

Phase 2 stayed intentionally limited to Pro readiness and bookability enforcement.

This work focuses on:

- determining whether a Pro is ready to be booked
- enforcing readiness at booking write boundaries
- making readiness entry-point aware
- preventing Pro-created booking side effects when the Pro is not ready
- keeping public search/discovery constrained to approved public Pro surfaces

This work does not cover:

- Sentry dashboard proof
- Slack alert routing
- load testing
- chaos testing
- private beta go/no-go proof
- public rollout escalation proof
- full deployed staging/browser proof

Those remain part of the broader Phase 2 launch-readiness track.

## Implemented

- Added PRO_NOT_READY booking error.
- Hardened lib/pro/readiness/proReadiness.ts as the authoritative Pro bookability evaluator.
- Added transaction-compatible readiness checking with checkProReadinessWithDb.
- Added entry-point-aware readiness checking with checkProReadinessForEntryPointWithDb.
- Required explicitly bookable, ready locations for Pro readiness.
- Ignored invalid draft/unbookable locations when a valid bookable location exists.
- Added booking write-boundary readiness gates for:
  - createHold
  - finalizeBookingFromHold
  - createProBooking
- Passed bookingEntryPoint through booking write-boundary calls so readiness can be evaluated against the user’s booking path.
- Added Pro-created booking preflight in createProBookingWithClient so unready Pros fail before client/invite side effects.

## Entry-point behavior

Booking write paths now call checkProReadinessForEntryPointWithDb.

Current booking entry points:

| Flow | Booking entry point | Readiness behavior |
|---|---|---|
| Client hold creation | BROAD_DISCOVERY | Pro must be ready/bookable for broad discovery booking. |
| Client booking finalization | BROAD_DISCOVERY | Pro must still be ready/bookable before finalization. |
| Pro-created booking | DIRECT_PROFILE | Pro must be ready for direct/profile booking before side effects. |

Search/discovery indexing still uses checkProReadinessWithDb because it checks general searchable/bookable visibility, not a specific booking creation path.

## Verified behavior

Targeted tests should prove:

- Unready Pros cannot create holds.
- Unready Pros cannot finalize bookings from holds.
- Unready Pros cannot create Pro-side bookings.
- Pro-created booking preflight blocks before:
  - resolving or creating clients
  - creating bookings
  - creating invite links
  - enqueueing invite delivery
- Booking readiness gates receive the expected bookingEntryPoint.
- Search/discovery regression tests still pass.
- Public search/discovery remains constrained to approved public Pro surfaces.
- Invalid draft/unbookable locations do not make a Pro unbookable when a valid bookable location exists.
- A Pro without a valid bookable ready location is not treated as bookable.

## Targeted test command

Run:

bash pnpm vitest run \   lib/pro/readiness/proReadiness.test.ts \   lib/booking/createProBookingWithClient.test.ts \   lib/booking/writeBoundary.overrideAudit.test.ts \   lib/booking/writeBoundary.readiness.test.ts \   lib/booking/writeBoundary.mobileRadius.test.ts \   lib/search/pros.test.ts \   lib/discovery/nearbyPros.test.ts \   app/api/pros/nearby/route.test.ts 

## Required evidence

Record the result before marking this baseline complete.

text Command: Commit: Branch: Environment: Result: Test files: Tests: Failures: Decision: 

## Completion criteria

This baseline can be marked complete when:

- PRO_NOT_READY exists and is returned consistently for unready Pro booking attempts.
- proReadiness.ts is the authoritative readiness evaluator.
- Booking write boundaries enforce readiness.
- Entry-point-aware readiness is passed through booking write paths.
- Pro-created booking preflight blocks before client/invite side effects.
- Discovery/search behavior still uses the correct general readiness evaluator.
- Targeted tests pass.
- The passing command output is recorded against the commit under review.

## Launch-readiness impact

This work strengthens product safety by preventing unready Pros from being booked.

It supports private beta readiness because it protects core booking correctness.

It does not, by itself, make private beta or public rollout GO.

Private beta still requires:

- current typecheck/privacy proof
- staging deploy proof
- health/readiness proof
- booking lifecycle smoke proof
- Sentry release/environment proof
- dashboard proof
- alert destination and at least one synthetic alert proof
- rollback/support path

Public rollout still requires:

- all private beta gates
- named backup owner
- tested P1 escalation
- load proof
- chaos proof
- provider capacity proof
- final go/no-go signoff

## Known follow-ups

| Follow-up | Status | Notes |
|---|---|---|
| Record targeted test output | TODO | Required before closing this baseline. |
| Confirm final commit SHA | TODO | Replace branch/based-on notes with final merged commit once landed. |
| Confirm deployed/staging behavior | TODO | Needed for launch confidence, not required for local baseline proof. |
| Cross-link from launch readiness docs | TODO | Link this baseline from checklist/go-no-go if used as Pro readiness evidence. |

## Related files

- lib/pro/readiness/proReadiness.ts
- lib/pro/readiness/proReadiness.test.ts
- lib/booking/createProBookingWithClient.ts
- lib/booking/createProBookingWithClient.test.ts
- lib/booking/writeBoundary.ts
- lib/booking/writeBoundary.readiness.test.ts
- lib/booking/writeBoundary.overrideAudit.test.ts
- lib/booking/writeBoundary.mobileRadius.test.ts
- lib/search/pros.test.ts
- lib/discovery/nearbyPros.test.ts
- app/api/pros/nearby/route.test.ts

## Maintenance rule

Do not treat a Pro as bookable just because they exist, have a profile, or have draft locations.

Bookability must come from the centralized readiness evaluator and must be enforced at every booking write boundary. Public/search visibility and booking creation are related, but they are not the same check. Keep that line sharp.