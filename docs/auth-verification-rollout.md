# Auth Verification Rollout

## Purpose

Operational incident runbook: see `docs/auth-verification-incident-runbook.md`

TOVIS now requires **both phone verification and email verification** before a user is treated as fully active for normal app access.

This document describes the production contract for:
- verification data truth
- session behavior
- route/layout enforcement
- resend/expiry/single-use rules
- notification eligibility alignment
- rollout and handoff expectations

This is the implementation reference for future engineering work. It is meant to be boring, explicit, and hard to misread.

---

## Goals

The verification system must guarantee all of the following:

1. Phone verification is real and DB-backed.
2. Email verification is real and DB-backed.
3. Verification state survives refresh, retries, resend, and partial completion.
4. Signup and login do **not** grant full normal app access until both verifications are complete.
5. Unverified users may continue only through a restricted verification flow.
6. Protected app areas must reject unverified users server-side.
7. Notification delivery must not use a looser definition of “verified” than auth does.
8. Verification rules must be centralized and reusable.

---

## Definitions

### Fully verified user
A user is fully verified only when:

- `user.phoneVerifiedAt != null`
- `user.emailVerifiedAt != null`

### Verification-only session
A restricted authenticated session used when the user exists and may continue verification, but is **not yet fully active**.

### Active session
A full authenticated session for normal app access.

---

## Authoritative verification truth

### User table is authoritative for current verification state

Current verification truth is represented on `User` by:

- `phoneVerifiedAt`
- `emailVerifiedAt`

These fields are the authoritative answer to:
- whether phone ownership has been proven
- whether email ownership has been proven
- whether the account is fully verified

### Verification artifact records are authoritative for issuance and consumption history

Verification artifacts are stored as DB-backed records with expiry and single-use semantics.

#### Phone verification artifacts
Phone verification records store:
- `userId`
- `phone`
- `codeHash`
- `expiresAt`
- `usedAt`
- timestamps

#### Email verification artifacts
Email verification records store:
- `userId`
- `email`
- `purpose`
- `tokenHash`
- `expiresAt`
- `usedAt`
- timestamps

### Mirrored profile verification fields

Some profile models still mirror phone verification state for convenience/compatibility:
- `ClientProfile.phoneVerifiedAt`
- `ProfessionalProfile.phoneVerifiedAt`

These are **not** the primary source of truth for auth decisions.

Rules:
- auth/session gating must use `User.phoneVerifiedAt` and `User.emailVerifiedAt`
- mirrored profile phone verification fields are updated when phone verification succeeds
- if future cleanup removes mirrored fields, auth behavior must not change

There is intentionally **no parallel profile-level email verification truth**.

---

## Session model

## Session kinds

There are two session kinds:

- `VERIFICATION`
- `ACTIVE`

### `VERIFICATION`
Used when:
- the user has authenticated successfully or just completed signup
- but `isFullyVerified === false`

A verification session is allowed to:
- view verification status
- verify phone
- resend phone code
- verify email
- resend verification email
- sign out

A verification session is **not** allowed normal protected app access.

### `ACTIVE`
Used only when:
- `phoneVerifiedAt != null`
- `emailVerifiedAt != null`

Only `ACTIVE` sessions should be treated as full login for app usage.

---

## Session issuance contract

### Signup
Signup creates:
- a real user record
- unverified verification state
- verification artifacts
- a `VERIFICATION` session, not an `ACTIVE` session

### Login
Login behavior depends on verification state:

- fully verified user -> issue `ACTIVE`
- partially verified or unverified user -> issue `VERIFICATION`

This allows a user to return and complete verification without reopening signup.

### Verification completion
When a user crosses from partial to full verification:
- session should be refreshed/upgraded to `ACTIVE`
- app should redirect to the intended destination or role default

---

## Derived auth state

Application auth helpers should expose these booleans:

- `isPhoneVerified`
- `isEmailVerified`
- `isFullyVerified`

Rules:

- `isPhoneVerified = Boolean(user.phoneVerifiedAt)`
- `isEmailVerified = Boolean(user.emailVerifiedAt)`
- `isFullyVerified = isPhoneVerified && isEmailVerified`

These must be derived from DB truth, not client state.

---

## Signup contract

Signup must create correct incomplete state without granting normal access.

### Required resulting state after successful signup

After signup succeeds:

- user exists in DB
- `phoneVerifiedAt = null`
- `emailVerifiedAt = null`
- phone verification artifact exists
- email verification artifact exists
- session kind is `VERIFICATION`
- response explicitly communicates verification requirements
- client is sent to verification completion flow, not the normal app

### Signup response expectations

Signup response should explicitly tell the client:

- `requiresPhoneVerification`
- `requiresEmailVerification`
- `isPhoneVerified`
- `isEmailVerified`
- `isFullyVerified`
- `nextUrl`
- whether initial email verification delivery succeeded

### Initial delivery behavior

Signup should attempt both:
- phone code send
- email verification send

If email delivery fails but account creation succeeds:
- do **not** fake success
- do **not** silently mark email verified
- do **not** drop the user into the normal app
- route user into verification flow with a visible retry path

---

## Login contract

Login is not allowed to bypass verification.

### Expected behavior

On successful credential validation:

- if fully verified -> issue `ACTIVE`
- otherwise -> issue `VERIFICATION`

Login response must include:
- verification booleans
- next destination
- enough state for client redirect logic

This prevents old assumptions like “valid password means fully active account.”

---

## Verification flow UX contract

## Entry point
The verification completion flow lives at:

- `/verify-phone`

Despite the route name, it is the combined verification completion screen for both phone and email.

## Responsibilities of the page

The page must:

- load verification truth from the server on refresh
- show phone status
- show email status
- show overall account status
- allow phone code submission if phone is pending
- allow phone resend if phone is pending
- allow email resend if email is pending
- show retry guidance when signup email send previously failed
- redirect to final destination once fully verified

## Required UX states

### Initial partial state
Examples:
- phone pending, email pending
- phone verified, email pending
- phone pending, email verified

### Success state
When phone completes but email is still pending:
- keep user in verification flow
- show that phone is complete
- explain that email is still required

When both are complete:
- redirect to `nextUrl` if valid
- otherwise redirect to role default

### Error state
Show actionable errors for:
- invalid phone code
- expired phone code
- resend rate limits
- email resend failure
- status load failure

### Refresh behavior
Page refresh must recover from server truth and not depend on in-memory client state.

---

## Verification endpoints

## Verification status endpoint
Used by verification UI to reload canonical state from the server.

Must return:
- session kind
- role
- email
- `isPhoneVerified`
- `isEmailVerified`
- `isFullyVerified`
- `requiresPhoneVerification`
- `requiresEmailVerification`
- `nextUrl`

This endpoint is allowed for verification sessions.

## Phone send endpoint
Responsibilities:
- require authenticated user, including verification-only session
- reject if already phone verified
- enforce resend cooldown/rate limits
- invalidate older unused phone codes as needed
- create a new single-use expiring code artifact
- send SMS
- return structured success/failure

## Phone verify endpoint
Responsibilities:
- require authenticated user, including verification-only session
- validate code format
- match only unconsumed, unexpired code hash for current user and phone
- mark code used
- set `user.phoneVerifiedAt`
- synchronize mirrored profile phone verification fields if they still exist
- return updated verification state

## Email send endpoint
Responsibilities:
- require authenticated user, including verification-only session
- reject if already email verified
- enforce resend limits
- issue a new verification artifact
- send verification email
- return structured success/failure

## Email verify endpoint
Responsibilities:
- validate token
- reject invalid / expired / already-used token
- mark token used
- set `user.emailVerifiedAt`
- invalidate remaining unused email verification artifacts for that purpose/user
- refresh cookie/session kind when appropriate
- return updated verification state

---

## Single-use, expiry, replay, resend rules

## Phone verification
- code is stored hashed, not raw
- code must be single-use
- code expires explicitly
- only unconsumed and unexpired codes are valid
- resend must be rate-limited
- new send should invalidate older unused codes where current implementation does so

## Email verification
- token is stored hashed, not raw
- token must be single-use
- token expires explicitly
- token replay is rejected
- resend must be rate-limited
- once email verification succeeds, remaining unused verification tokens for that user/purpose should be invalidated

## Security rule
No verification secret should be accepted based on:
- client memory
- old success state
- previously issued but already consumed artifact
- session alone without DB confirmation

DB state is authoritative.

---

## Protected route enforcement

## Central enforcement model

Enforcement is intentionally split across:
- auth/session helpers
- role-specific route helpers
- protected layouts

### Auth helper layer
`requireUser`
- rejects unauthenticated users
- rejects verification-only sessions by default
- can explicitly allow verification-only sessions for verification routes

`requireClient`
- depends on `requireUser`
- enforces `CLIENT`
- enforces presence of client profile

`requirePro`
- depends on `requireUser`
- enforces `PRO`
- enforces presence of professional profile

### Layout/server rendering layer
Protected app sections must server-redirect unverified users away from normal app access.

Examples:
- client area redirects unverified users to `/verify-phone?next=...`
- pro area redirects unverified users to `/verify-phone?next=...`

### Middleware
Middleware is **not** the primary auth enforcement layer in the current architecture.

Current middleware is reserved for request header plumbing and vanity-domain rewrite behavior.
Do not assume verification gating happens in middleware.

If middleware-based auth enforcement is introduced later, it must preserve the same verification contract and not weaken helper/layout enforcement.

---

## Allowed actions before full verification

Users with `VERIFICATION` sessions may:
- view verification status
- submit phone verification code
- resend phone verification code
- verify email from email link
- resend verification email
- sign out

They may also be redirected within the verification flow.

They may **not** be granted normal protected access to:
- client app area
- pro app area
- any route guarded by default `requireUser` / `requireClient` / `requirePro`
- any business action that assumes full activation

---

## Notification alignment

Notification eligibility must use the same verification ownership rules as auth.

## SMS delivery
SMS delivery eligibility requires:
- destination phone present
- phone ownership verified

In practice:
- no verified phone -> no SMS channel delivery

## Email delivery
Email delivery eligibility requires:
- destination email present
- email ownership verified

In practice:
- no verified email -> no email channel delivery

## Important rule
Notifications must not define “deliverable” more loosely than auth defines “verified.”

That means:
- raw phone string is not enough for SMS
- raw email string is not enough for email

This prevents sending sensitive account/booking notifications to unverified destinations.

---

## Existing users and rollout behavior

## Existing fully verified users
If a user already has:
- `phoneVerifiedAt != null`
- `emailVerifiedAt != null`

they should continue to receive `ACTIVE` sessions normally.

## Existing partially verified users
If a user has only one verification complete:
- login should issue `VERIFICATION`
- protected app access should redirect to `/verify-phone`
- user must complete the missing verification

## Existing users with old sessions
If any historical sessions existed that assumed “logged in = active,” those sessions should no longer bypass current enforcement because:
- current protected areas also check server-derived verification state
- `sessionKind !== ACTIVE` and/or `!isFullyVerified` should redirect

If there is concern that old cookie payloads might not match the new token contract, force logout or session rotation is the safest cleanup.

### Recommended rollout stance
If there is any uncertainty about old auth cookies:
- expire old auth cookies on deploy or
- require re-login after deploy

Because the app is not yet live in production usage, choosing the stricter cleanup path is acceptable and preferred over preserving risky legacy behavior.

---

## Environment and provider dependencies

## Required auth/session env
- `JWT_SECRET`

## Required SMS env
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_FROM_NUMBER`

## Required email env
Use the existing email provider stack configured by the auth email verification implementation.
Provider-specific env must be present for verification email delivery to succeed.

Examples depend on provider implementation, but missing provider env must surface as:
- explicit send failure
- not fake success
- not implicit verification

## App URL
Verification email flow requires a valid application base URL so generated verification links are correct.

If app URL resolution fails:
- email verification send must fail explicitly
- account must remain unverified
- UI must offer retry once config is fixed

---

## Operational behavior and failure handling

## If SMS send fails
- account remains created but unverified
- phone is not marked verified
- route returns explicit failure
- user remains in verification flow and can retry

## If email send fails
- account remains created but unverified
- email is not marked verified
- route returns explicit failure or `emailVerificationSent = false` in signup flow
- user remains in verification flow and can resend later

## If verification status load fails
- verification UI should show an actionable error
- do not assume local state is authoritative
- retry should fetch server truth again

---

## Handoff notes for future engineering teams

## Where to change rules
If verification requirements change, inspect these layers together:

1. Prisma schema and verification artifact models
2. session/token creation helpers
3. `getCurrentUser`
4. `requireUser`, `requireClient`, `requirePro`
5. signup route
6. login route
7. verification status/send/verify routes
8. protected layouts
9. notification channel capability logic
10. verification UI

Do not update only one layer.

## Invariants that must stay true
- no full app access before both verifications complete
- verification artifacts are DB-backed, expiring, and single-use
- no client-only verification enforcement
- no notification delivery to unverified destinations
- auth truth comes from DB, not stale cookie assumptions
- verification-only sessions are explicit and limited

## Known intentional architecture choices
- middleware is not the auth gate
- `User` is the source of truth for verification
- profile-level phone verification mirrors may still exist, but should not drive auth
- verification UI path is `/verify-phone` even though it covers both phone and email completion

---

## Recommended follow-up cleanup

These are cleanup items, not blockers for the current contract:

1. Consider renaming `/verify-phone` to something more general later, such as `/verify-account`, once product timing allows.
2. Consider removing mirrored profile phone verification fields if no longer needed.
3. Consider adding a middleware layer only if it preserves the current helper/layout guarantees and does not create duplicate or conflicting auth logic.
4. Consider adding a dedicated docs index if more auth/notification docs are added.

---

## Validation checklist

A rollout should not be considered healthy unless all of the following are true:

- signup creates unverified user state
- signup issues `VERIFICATION`, not `ACTIVE`
- login issues `VERIFICATION` for partially verified users
- login issues `ACTIVE` for fully verified users
- phone verification updates DB truth and consumes artifact
- email verification updates DB truth and consumes artifact
- resend endpoints honor rate limits
- verification page survives refresh and reload
- client protected area blocks unverified users
- pro protected area blocks unverified users
- notifications suppress SMS when phone is unverified
- notifications suppress email when email is unverified

---

## Summary

The production contract is simple:

- **DB state is authoritative**
- **both phone and email verification are required**
- **verification-only sessions are real but restricted**
- **fully active access requires both verifications**
- **protected app areas enforce this on the server**
- **notifications use the same verified-destination rules as auth**

Anything that weakens one of those rules is a regression.

## Sweep result

AuthVersion enforcement sweep completed against bf6dc98. Repo-confirmed authenticated app surfaces do not perform raw JWT verification or raw tovis_token reads outside auth lifecycle endpoints. DB-backed current-user validation remains centralized in lib/currentUser.ts and flows through requireUser()/requireClient()/requirePro(). Structural regression test now passes and is scoped to catch real session-bypass risks without flagging unauthenticated token-based flows like password reset confirm.