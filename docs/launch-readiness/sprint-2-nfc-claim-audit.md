# Sprint 2 NFC / Claim Trust-Boundary Audit

## Status

Deferred / needs repo trace

## Claim-link flow

Covered in Sprint 2:

- `lib/clients/clientClaimLinks.test.ts`
- `lib/clients/clientClaim.test.ts`
- `app/claim/[token]/page.test.tsx`

Verified:

- revoked links cannot be claimed
- already-claimed client identities cannot be claimed again
- wrong signed-in client gets mismatch state
- missing invite/client/booking fails safely
- successful claim writes accepted audit state
- update races return deterministic states
- page renders safe state-specific UI

## Raw token risk

`ProClientInvite.token` is currently looked up directly.

This is documented as accepted temporary behavior for Sprint 2, but should be hardened later.

Recommended future migration:

- store only a token hash
- compare hashed incoming claim token
- add token expiry if not already present
- add revoked/used audit metadata
- consider using a `ClientActionToken`-style model

## NFC / tap-code flow

Not fully audited in this sprint.

Required follow-up:

- locate `app/t/[cardId]`, `app/c/[code]`, `NfcCard`, or equivalent tap-code surfaces
- verify tokens/codes are non-enumerable
- verify revoked cards/codes cannot initiate booking
- verify unready Pros cannot be booked through tap-code flow
- verify booking intent handoff is logged
- verify idempotency / duplicate-tap behavior

## Sprint 2 decision

Claim-link behavior is covered.

NFC/tap-code flow is explicitly carried forward to a later trust-boundary audit unless it is part of launch scope.