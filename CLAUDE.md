# TOVIS – Claude Code Project Memory

## Project Identity
- **Name:** TOVIS (pronounced "Toe-vees")
- **Tagline:** "A new age of self care"
- **Purpose:** Beauty-industry platform connecting licensed professionals with clients
- **Owner:** Tori

## Tech Stack
- **Framework:** Next.js App Router (latest), TypeScript
- **Database:** PostgreSQL via Supabase
- **ORM:** Prisma (source of truth for all types and schema — never guess, always check)
- **Auth:** Custom email/password with bcrypt + JWT in httpOnly cookies
- **UI:** Tailwind CSS (no hex colors — Tailwind tokens only)
- **Testing:** Vitest (unit), Playwright (E2E)
- **Deployment:** Vercel
- **Repo:** github.com/MillyinVR/tovis-app (branch: main)

## Supabase Projects
- **Main:** rqhhvuaoksuvbvlypztn
- **Test:** vszlyjkoeasvatlwdcdt
- Never use main DB for test runs. Always confirm which DB before migrations.

## Absolute Engineering Rules
Non-negotiable. Do not violate these.

1. **Prisma is the single source of truth.** Never invent types, fields, or relations. Always check schema before writing code.
2. **Zero `as any`.** No paper-over casts at module boundaries. Rare local casts only with clear justification.
3. **Prefer Prisma enums over string literals** everywhere.
4. **Use `jsonOk` / `jsonFail` consistently.** Never return ad hoc payloads when shared helpers exist.
5. **Auth pattern is always:**
```ts
const auth = await requireX();
if (!auth.ok) return auth.res;
```
6. **No hex colors.** Tailwind tokens only.
7. **No duplicate scheduling logic.** Working hours helpers live in `lib/scheduling/workingHours.ts` and `lib/scheduling/workingHoursValidation.ts`. Conflict helpers live in `lib/booking/conflicts.ts` and `lib/booking/conflictQueries.ts`.
8. **Booking conflict rules must stay consistent across:** availability, holds, finalize, and pro edits.
9. **No temporary patches.** If a quick fix exists but isn't structurally correct, say so and propose the durable solution.
10. **Work file by file.** Do not make sweeping changes across multiple files at once.
11. **Do not use Firebase.** This version uses Supabase only.

## User Roles
- **CLIENT** – browses, books, reviews, views aftercare, searches for pros
- **PRO** – manages offerings, calendar, sessions, aftercare, media, searches for clients, creates bookings for clients
- **ADMIN** – verifies licenses, manages global service catalog, platform health

## Pro Booking Flow (Pro-Created Appointments)
When a pro creates a booking from their calendar:

### Client Search Order
1. Clients they've previously worked with (prioritized at top)
2. All clients in the app (searchable by name, email, phone)
3. "Add new client" option (non-app client)

### Adding a Non-App Client
- Pro fills in: name, phone, email
- If mobile appointment: pro also adds client address
- Booking is created with status = ACCEPTED immediately (pro-created = auto-accepted)
- System sends invite via client's preferred contact method (EMAIL or SMS)
- Invite contains a quick-signup link with all info pre-filled
- Client only needs to create a password to confirm their profile
- Tracked via `ProClientInvite` model (PENDING/ACCEPTED/EXPIRED)

### Schema Gaps To Address (Not Yet In Prisma)
- `ClientProfile.preferredContactMethod` — EMAIL or SMS enum needed
- `ProClientInvite` model — tracks invite token, pre-filled client info, status, expiry
- Do not implement these without a migration

## Booking Flow Rules
- Holds are created before a booking is confirmed
- POST /api/holds must return 201 on success
- Hold creation path lives in `lib/booking/writeBoundary.ts`
- If /api/holds returns non-201, E2E tests should fail — do not weaken tests
- Conflict rules must be consistent across availability, holds, finalize, and pro edits
- Mobile bookings: show arrival window to client (e.g. 9:45–10:15), exact time to pro
- Pro-created bookings go straight to ACCEPTED status

## Active Gate System (E2E / QA)
8-gate sequential pass/fail system for booking flow validation.
- Never skip gates
- Never move to the next gate until current gate passes
- **Currently on: Gate 1**
- Gate 1 goal: browser E2E proof of availability and booking flow

### Gate 1 Files In Scope
- `playwright.config.ts`
- `tests/e2e/auth.setup.ts`
- `tests/e2e/utils/selectors.ts`
- `tests/e2e/utils/availabilityHelpers.ts`
- `tests/e2e/fixtures/seedBookingFlow.ts`
- `tests/e2e/fixtures/teardownBookingFlow.ts`
- `tests/e2e/availability-drawer.spec.ts`
- `tests/e2e/mobile-address.spec.ts`
- `tests/e2e/availability-retry-and-failure.spec.ts`
- `tests/e2e/location-switching.spec.ts`
- `tests/e2e/add-ons-transition.spec.ts`
- `app/api/holds/route.ts`
- `app/api/holds/[id]/route.ts`
- `app/(main)/booking/AvailabilityDrawer/utils/hold.ts`
- `lib/booking/writeBoundary.ts`
- `prisma/schema.prisma`

### Current Gate 1 Blocker
- `POST /api/holds` returning 500 INTERNAL_ERROR
- Failure is in `createHold` / `performLockedCreateHold` in `lib/booking/writeBoundary.ts`
- Previous fix introduced TS errors by using fields that don't exist in actual Prisma input types
- Fix must validate against real Prisma schema before changing anything

### Known TS Errors To Fix
- `app/api/holds/route.ts` catch block references variables out of scope: `offeringId`, `requestedLocationId`, `clientAddressId`, `locationType`, `scheduledForRaw`
- `lib/booking/writeBoundary.ts` used `BookingHoldCreateInput` with fields like `offeringId` that don't exist in actual Prisma input type
- `logHoldCreateInternalError` helper was referenced but not correctly added

## Location Modes (Pro)
- `SALON` – fixed salon location
- `SUITE` – suite-based
- `MOBILE_BASE` – travels to client

## Media Rules
- All media must be linked to ≥1 service
- Review-submitted media is immutable by professionals
- Pros can add review media to Portfolio
- Portfolio = MediaAssets where `visibility = PUBLIC` and `isFeaturedInPortfolio = true`
- Looks feed = MediaAssets where `isEligibleForLooks = true`

## License Verification
- Currently California-only via CA DCA / BreEZe
- Future: nationwide multi-state expansion
- Do not remove or break this flow

## V2 Features (Do Not Build Yet)
- Pro-to-pro booking (pro booking an appointment WITH another pro as a client)
- Group bookings and events
- White-label salon mode
- Nationwide license verification