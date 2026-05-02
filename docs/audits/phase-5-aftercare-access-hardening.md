# Phase 5 Baseline - Aftercare Access Hardening

Branch: audit/phase-5-aftercare-access-hardening
Based on Phase 4 commit: 879846f

## Scope

Phase 5 stayed limited to aftercare creation, aftercare sending, secure client access, and closeout-related aftercare delivery.

## Findings

The aftercare system already had several important protections:

- `AftercareSummary` is one-to-one with `Booking` through unique `bookingId`.
- Pro aftercare GET verifies booking ownership before returning aftercare data.
- Pro aftercare POST uses the booking write boundary through `upsertBookingAftercare`.
- Aftercare access delivery uses token-backed secure links.
- Unclaimed aftercare access rejects missing, invalid, wrong-kind, revoked, expired, already-used single-use, unsent, and context-mismatched tokens.
- Aftercare closeout behavior remains centralized in the booking write boundary.
- Existing aftercare, client-claim, delivery, checkout, and closeout tests passed before the Phase 5 patch.

## Implemented

- Threaded authenticated Pro actor user id into aftercare access delivery.
- `maybeQueueAftercareAccessDelivery` now accepts `actorUserId`.
- `createAftercareAccessDelivery` now receives `issuedByUserId`.
- Updated route test coverage to prove sent aftercare access links preserve issuer attribution.

## Why

`createAftercareAccessDelivery` already supported `issuedByUserId`, and the aftercare route already required and used `actorUserId` for idempotency. However, the route did not pass the actor into aftercare access delivery. That meant secure aftercare access tokens could be issued without preserving who issued them.

Phase 5 closes that auditability gap without changing lifecycle behavior, delivery behavior, schema, or client access semantics.

## Targeted test command

pnpm vitest run "app/api/pro/bookings/[id]/aftercare/route.test.ts" lib/aftercare/unclaimedAftercareAccess.test.ts lib/clientActions/orchestrateClientActionDelivery.test.ts lib/clients/clientClaim.test.ts lib/clients/clientClaimLinks.test.ts lib/notifications/delivery/claimDeliveries.test.ts lib/booking/writeBoundary.clientCheckout.test.ts lib/booking/writeBoundary.closeoutAudit.test.ts

Result:

PASS - 8 test files passed, 110 tests passed.

Note:

The `app/api/pro/bookings/[id]/aftercare/route.test.ts` suite intentionally logs an error in its 500-path test. The suite passes.

## Typecheck

Command:

pnpm typecheck

Result:

FAIL - existing Phase 0 Looks/feed viewerSaved errors remain.

Observed errors:

- app/(main)/looks/_components/LooksFeed.test.tsx: viewerSaved may be undefined.
- lib/looks/mappers.test.ts: viewerSaved missing in mapper test inputs.

No new aftercare route or access-delivery type errors were observed.

Expected baseline:

Phase 0 documented existing Looks/feed viewerSaved type errors. Those are out of scope for Phase 5 unless new aftercare route or access-delivery errors appear.

## Phase 5 completion criteria

- Aftercare route actor identity remains required.
- Aftercare idempotency still includes actor identity.
- Sent aftercare access links preserve issuer attribution.
- Unclaimed aftercare access token protections remain covered.
- Existing closeout/payment aftercare tests pass.
- Targeted Phase 5 tests pass.
