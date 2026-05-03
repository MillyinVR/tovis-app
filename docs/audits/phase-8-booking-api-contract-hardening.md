# Phase 8 Baseline - Booking API Contract Hardening

Branch: audit/phase-8-booking-api-contract-hardening
Based on Phase 7 commit: ccd4ee0

## Scope

Phase 8 stayed limited to booking API route contract coverage.

Focus areas:

- Auth boundaries
- Route ownership checks
- Booking API route error handling
- Booking API route response contracts
- Missing route-level coverage for real booking API logic

## Findings

The booking API route baseline was stronger than expected.

Existing tested route areas already cover:

- client booking finalize
- client checkout
- client checkout products
- client review
- client review media options
- pro booking create/list/detail
- pro aftercare
- pro media
- pro final review
- pro rebook
- pro session start/step/finish
- pro cancel
- pro consultation proposal
- pro consultation in-person decision
- booking cancel/reschedule

A corrected route/test coverage scan found several untested routes, but most were intentionally deprecated or stub endpoints:

- `app/api/bookings/route.ts` returns not implemented.
- `app/api/bookings/[id]/status/route.ts` returns gone/moved.
- `app/api/client/bookings/[id]/media/route.ts` returns gone and points to review media.
- `app/api/client/bookings/[id]/consultation/route.ts` has related `_decision.test.ts` coverage.

The meaningful untested route with real booking API logic was:

- `app/api/pro/bookings/[id]/consultation-services/route.ts`

## Implemented

- Added `app/api/pro/bookings/[id]/consultation-services/route.test.ts`.

The new route test covers:

- auth failure returns the `requirePro` response
- missing booking id returns 400
- missing booking returns 404
- booking owned by another professional returns 403
- authenticated professional receives sorted base services, add-ons, and existing booking service items
- unexpected load errors return 500 and log the route error

## Why

`consultation-services` is used by Pros during consultation/service proposal work. It returns active offerings, eligible add-ons, and existing booking service items. Before Phase 8, this route had real ownership and DTO-mapping logic but no route-level test coverage.

Phase 8 closes that API contract gap without changing route behavior.

## Targeted test command

pnpm vitest run "app/api/pro/bookings/[id]/consultation-services/route.test.ts" "app/api/pro/bookings/[id]/consultation-proposal/route.test.ts" "app/api/pro/bookings/[id]/final-review/route.test.ts" "app/api/pro/bookings/[id]/session/start/route.test.ts" "app/api/pro/bookings/[id]/session/step/route.test.ts" "app/api/pro/bookings/[id]/session/finish/route.test.ts"

Result:

PASS - 6 test files passed, 72 tests passed.

Note:

Several existing route tests intentionally log expected `boom` errors while verifying 500-path behavior. Those suites passed.

## Broader booking API baseline

Earlier Phase 8 baseline route groups passed:

- 14 test files passed, 209 tests passed.
- 8 test files passed, 99 tests passed.

Combined with the targeted Phase 8 group, booking API route coverage remained green.

## Typecheck

Command:

pnpm typecheck

Result:

FAIL - existing Phase 0 Looks/feed viewerSaved errors remain.

Observed errors:

- app/(main)/looks/_components/LooksFeed.test.tsx: viewerSaved may be undefined.
- lib/looks/mappers.test.ts: viewerSaved missing in mapper test inputs.

No new booking API, consultation-services route, or Phase 8 test type errors were observed.

## Phase 8 completion criteria

- Corrected booking API route/test coverage scan completed.
- Untested real booking API route identified.
- Consultation services route test added.
- Targeted Phase 8 route tests pass.
- Broader booking API baseline remains green.
- Existing typecheck baseline remains unchanged.
