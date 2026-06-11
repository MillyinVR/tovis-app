# Browser E2E for Availability and Booking Gate 1

This directory contains the browser-level end-to-end coverage for Gate 1 of the availability and booking flow.

## What this suite is proving

Gate 1 is limited to browser proof for the availability flow. The suite is intended to prove:

- the availability drawer opens from the booking entry point
- salon availability can be loaded and a slot can be selected
- a hold can be created successfully
- Continue can move the user into add-ons
- mobile flow works with a saved client address
- mobile flow blocks correctly when no saved address exists
- availability failure shows an error state and retry can recover
- hold failure or expiry is surfaced in the UI
- switching between salon and mobile resets stale hold state correctly

This suite is not intended to prove payment, final booking confirmation, rescheduling, or unrelated booking admin flows.

## Files

- `availability-drawer.spec.ts`
  - happy-path salon availability
  - hold success
  - continue into add-ons

- `mobile-address.spec.ts`
  - mobile flow with saved address
  - mobile flow without saved address

- `availability-retry-and-failure.spec.ts`
  - availability failure
  - retry recovery
  - hold failure / expiry path

- `location-switching.spec.ts`
  - salon to mobile switching
  - mobile to salon switching
  - stale hold reset checks

- `add-ons-transition.spec.ts`
  - handoff from held slot to add-ons page
  - add-ons step remains actionable

- `fixtures/seedBookingFlow.ts`
  - deterministic test seed data for client, professional, offering, locations, address, and add-ons

- `fixtures/teardownBookingFlow.ts`
  - scoped cleanup for seeded test data

- `utils/selectors.ts`
  - selector contract for browser tests

- `utils/availabilityHelpers.ts`
  - shared user-flow helpers for availability tests

## Local setup

Install dependencies:

```bash
npm install
## Signup flows

- `signup.spec.ts`
  - signup chooser routing to client and pro forms
  - client signup with ZIP confirm (Google proxies intercepted in-browser)
  - salon pro signup via Places autocomplete
  - mobile pro signup with base ZIP + radius
  - licensed pro signup degrading to manual review when DCA is unconfigured

Run logged-out, so the auth setup project is not needed:

```bash
PORT=3100 PLAYWRIGHT_BASE_URL=http://127.0.0.1:3100 \
  npx dotenv -e .env.e2e.local -- \
  npx playwright test tests/e2e/signup.spec.ts --no-deps
```

Use a port with no running dev server so Playwright starts a fresh one with
the `.env.e2e.local` environment (test database, Cloudflare always-pass
Turnstile test keys, Twilio/Postmark/DCA unset). Reusing a dev server that was
started with `.env.local` would write signups to the dev database and call
real providers.
