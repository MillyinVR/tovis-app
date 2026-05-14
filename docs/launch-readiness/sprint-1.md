## Status

Complete

## Files changed

### Backend lifecycle

- `lib/booking/writeBoundary.ts`
- `lib/booking/lifecycleContract.strictMode.test.ts`
- `lib/booking/writeBoundary.clientCheckout.test.ts`
- `lib/booking/writeBoundary.lifecycleIntegration.test.ts`
- `lib/booking/writeBoundary.media.test.ts`
- `lib/booking/lifecycleActionViewModel.test.ts`

### Pro session UI

- `app/pro/bookings/[id]/session/page.tsx`
- `app/pro/bookings/[id]/session/page.test.tsx`
- `app/pro/bookings/[id]/session/after-photos/page.tsx`
- `app/pro/bookings/[id]/session/after-photos/page.test.tsx`

### Pro bookings list

- `app/pro/bookings/page.tsx`
- `app/pro/bookings/page.test.tsx`

### Aftercare closeout

- `lib/booking/closeoutBlockers.ts`
- `lib/booking/closeoutBlockers.test.ts`
- `app/pro/bookings/[id]/aftercare/page.tsx`
- `app/pro/bookings/[id]/aftercare/page.test.tsx`
- `app/pro/bookings/[id]/aftercare/AftercareForm.tsx`
- `app/pro/bookings/[id]/aftercare/AftercareForm.test.tsx`
- `app/api/pro/bookings/[id]/aftercare/route.test.ts`

### E2E smoke

- `tests/e2e/booking-lifecycle-smoke.spec.ts`

## Acceptance criteria

- [x] Client checkout completion records an allowed lifecycle actor.
- [x] Strict mode rejects invalid lifecycle actors.
- [x] Pro session UI does not directly call `SessionStep.DONE`.
- [x] “Complete session” is replaced with “Finish closeout.”
- [x] Wrap-up checklist includes after photos, aftercare, payment, checkout, and consultation.
- [x] After-photo upload UI renders only for `SessionStep.AFTER_PHOTOS`.
- [x] `FINISH_REVIEW` redirects away from the after-photo upload page.
- [x] `IN_PROGRESS` bookings are visible and filterable for Pros.
- [x] Active bookings expose a “Resume session” link.
- [x] Closeout blockers render friendly copy, not raw backend codes.
- [x] Aftercare API returns closeout response contract fields.
- [x] Aftercare page copy matches closeout ownership rules.
- [x] Backend media lifecycle rejects AFTER media outside `SessionStep.AFTER_PHOTOS`.
- [x] Lifecycle action view model exposes continue-session behavior for active bookings.
- [x] Happy-path E2E smoke skeleton exists.
- [x] Playwright smoke runs and skips cleanly without seeded lifecycle env.
- [x] Final Sprint 1 test gate passes.

## Test commands

```bash
pnpm typecheck
pnpm test
pnpm exec playwright test tests/e2e/booking-lifecycle-smoke.spec.ts

# Sprint 1 Closeout Summary

Sprint 1 is complete.

This sprint hardened booking closeout correctness across backend lifecycle rules, Pro session UI, aftercare completion, media lifecycle gates, Pro booking visibility, and smoke E2E coverage.

The main product correction was replacing direct completion behavior with the canonical “Finish closeout” flow. The Pro session UI no longer directly submits `SessionStep.DONE`; completion now depends on backend-owned closeout requirements: approved consultation, after photos, finalized aftercare, collected payment, and paid/waived checkout.

The test gate passes, including lifecycle strict mode, write boundary integration, Pro session UI, aftercare closeout, media lifecycle, Pro booking list behavior, and the booking lifecycle smoke E2E skeleton.