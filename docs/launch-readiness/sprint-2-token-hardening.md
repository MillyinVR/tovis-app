# Sprint 2 Closeout — Token + idempotency hardening

## Status

Complete

## Goal

Harden public/token-based flows so active aftercare, rebook, claim-link, and NFC/tap-code paths cannot regress to unsafe legacy behavior.

Sprint 2 focused on:

- aftercare secure-link access
- client rebook idempotency
- aftercare `publicToken` deprecation guardrails
- client claim-link behavior
- claim-page state handling
- NFC tap intent behavior
- short-code redirect behavior
- documenting remaining raw-token migration risk

## Files changed

### Aftercare token hardening

- `lib/aftercare/aftercarePublicTokenDeprecation.test.ts`
- `lib/aftercare/unclaimedAftercareAccess.ts`
- `lib/aftercare/unclaimedAftercareAccess.test.ts`
- `app/api/client/rebook/[token]/route.test.ts`

### Client claim hardening

- `lib/clients/clientClaimLinks.test.ts`
- `lib/clients/clientClaim.test.ts`
- `app/claim/[token]/page.test.tsx`

### NFC / tap-code hardening

- `app/t/[cardId]/page.test.tsx`
- `app/c/[code]/page.test.tsx`

## Acceptance criteria

- [x] Active aftercare/rebook paths do not use `aftercare.publicToken`.
- [x] Active aftercare/rebook paths are backed by `ClientActionToken`.
- [x] `AftercareSummary.publicToken` is allowed only as a legacy schema field for now.
- [x] Public-token regression guard exists.
- [x] Public aftercare read resolver comment reflects current ClientActionToken-backed behavior.
- [x] Rebook GET resolves token-backed access without consuming token usage.
- [x] Rebook GET does not expose `publicToken`.
- [x] Rebook POST uses token-scoped idempotency actor key.
- [x] Rebook POST does not create duplicate bookings on handled/replayed idempotency responses.
- [x] Rebook POST marks token used only after successful booking creation.
- [x] Rebook POST fails idempotency on mutation/token usage errors.
- [x] Claim-link creation/update behavior is tested.
- [x] Claim-link public state behavior is tested.
- [x] Claim-link accepted audit behavior is tested.
- [x] Claim mutation prevents wrong-client claim.
- [x] Claim mutation handles revoked, already-claimed, missing-client, mismatch, conflict, and race states.
- [x] Claim page renders/redirects correctly for missing, revoked, already-claimed, mismatch, unverified, non-client, ready, and conflict states.
- [x] NFC tap page rejects missing/inactive cards.
- [x] NFC tap page creates tap intents with 30-minute expiry.
- [x] NFC tap page stores `userId` when a user is present.
- [x] NFC tap page derives claim, Pro booking, and salon white-label intents.
- [x] NFC tap page rejects unsafe external/protocol-relative `next` overrides.
- [x] NFC short-code page normalizes codes before lookup.
- [x] NFC short-code page rejects missing/inactive cards.
- [x] NFC short-code page redirects active cards to `/t/[cardId]`.

## Known remaining risk

### `AftercareSummary.publicToken`

`AftercareSummary.publicToken` still exists in Prisma as a legacy schema field.

Current policy:

- active aftercare access must use `ClientActionToken(kind = AFTERCARE_ACCESS)`
- active client/pro API responses must not expose `publicToken`
- active rebook links must not be built from `publicToken`

Future migration:

1. Confirm no active rows depend on `AftercareSummary.publicToken`.
2. Backfill `ClientActionToken` access for any legacy sent aftercare summaries if needed.
3. Add telemetry for any legacy fallback usage if fallback remains.
4. Drop `AftercareSummary.publicToken` in a later migration.

### `ProClientInvite.token`

Client claim links currently use raw `ProClientInvite.token` lookup.

Current status:

- behavior is covered by tests
- revoked/already-claimed/mismatch/race outcomes are covered
- this is accepted temporarily for Sprint 2

Future hardening:

- migrate claim links to hashed token storage or a `ClientActionToken`-style model
- avoid raw token lookup in long-term production design
- consider expiry/rotation if claim links are long-lived

### NFC card IDs and short codes

NFC tap and short-code behavior is now covered by page tests.

Future hardening:

- confirm card IDs are non-enumerable
- confirm short codes are high entropy or rate-limited
- add rate limiting around `/c/[code]` and `/t/[cardId]`
- consider audit events for tap intent creation
- review whether safe local `next` overrides should be restricted to an allowlist

## Test commands

```bash
pnpm test -- \
  lib/aftercare/aftercarePublicTokenDeprecation.test.ts \
  lib/aftercare/unclaimedAftercareAccess.test.ts \
  app/api/client/rebook/[token]/route.test.ts \
  lib/clients/clientClaimLinks.test.ts \
  lib/clients/clientClaim.test.ts \
  app/claim/[token]/page.test.tsx \
  app/t/[cardId]/page.test.tsx \
  app/c/[code]/page.test.tsx

pnpm typecheck
pnpm test