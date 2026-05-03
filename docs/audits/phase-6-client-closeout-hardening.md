# Phase 6 Baseline - Client Closeout Hardening

Branch: audit/phase-6-client-closeout-hardening
Based on Phase 5 commit: 2e45951

## Scope

Phase 6 stayed limited to client-facing closeout, checkout, review eligibility, review media exposure, and rebook lifecycle hardening.

## Findings

The client closeout system already had strong write-boundary protections:

- Client checkout uses locked client-owned booking updates.
- Checkout rejects edits after payment is collected.
- Checkout requires finalized aftercare before completion.
- Checkout completion requires AFTER photos.
- Checkout product edits reject missing/draft aftercare.
- Checkout product edits reject paid, partially paid, waived, and completed booking states.
- Client review eligibility rejects wrong-client bookings.
- Client review eligibility rejects cancelled, non-completed, unfinished, missing-aftercare, draft-aftercare, unpaid, and incomplete-checkout bookings.
- Client rebook guards reject wrong-client, incomplete source booking, missing/draft aftercare, incomplete checkout, and missing payment states.
- Pro final-review and Pro rebook route tests already covered their route-level idempotency and error behavior.
- Client checkout, checkout-products, and review route tests already covered their route-level idempotency and error behavior.

## Implemented

- Hardened GET `/api/client/bookings/[id]/review-media-options`.
- Added booking error mapping for review media eligibility failures.
- Expected booking/lifecycle errors now flow through `bookingJsonFail`.
- Unexpected errors still return generic 500 responses.
- Added route-level test coverage for review media options:
  - auth failure
  - missing booking id
  - booking eligibility error mapping
  - eligible media query filters
  - phase/newest sorting behavior
  - unexpected error handling

## Why

The route already called `assertClientBookingReviewEligibility` before exposing review media. However, eligibility failures were falling into the generic catch block and returning 500. These are expected lifecycle/access errors, not server crashes.

Phase 6 keeps the existing media exposure contract but makes the route return the correct booking error response when eligibility fails.

## Targeted test command

pnpm vitest run "app/api/client/bookings/[id]/review-media-options/route.test.ts" "app/api/client/bookings/route.test.ts" "app/api/client/bookings/[id]/checkout/route.test.ts" "app/api/client/bookings/[id]/checkout/products/route.test.ts" "app/api/client/bookings/[id]/review/route.test.ts" "app/api/pro/bookings/[id]/rebook/route.test.ts" "app/api/pro/bookings/[id]/final-review/route.test.ts" lib/booking/writeBoundary.clientCheckout.test.ts lib/booking/writeBoundary.clientCheckoutProducts.test.ts lib/booking/writeBoundary.clientReviewEligibility.test.ts lib/booking/writeBoundary.clientRebook.test.ts lib/booking/writeBoundary.closeoutAudit.test.ts

Result:

PASS - 12 test files passed, 126 tests passed.

Note:

Several route suites intentionally log errors in 500-path tests. The suites pass.

## Typecheck

Command:

pnpm typecheck

Result:

FAIL - existing Phase 0 Looks/feed viewerSaved errors remain.

Observed errors:

- app/(main)/looks/_components/LooksFeed.test.tsx: viewerSaved may be undefined.
- lib/looks/mappers.test.ts: viewerSaved missing in mapper test inputs.

No new client closeout, review, review-media-options, or rebook type errors were observed.

## Phase 6 completion criteria

- Client checkout route baseline remains covered.
- Client checkout products route baseline remains covered.
- Client review route baseline remains covered.
- Pro final-review and rebook route baseline remains covered.
- Review media options route maps expected booking eligibility errors correctly.
- Review media options route only queries eligible, unlocked, unattached Pro/client-visible media.
- Targeted Phase 6 tests pass.
