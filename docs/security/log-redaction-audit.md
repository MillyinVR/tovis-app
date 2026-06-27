# Log and Analytics Redaction Audit

## Goal

Ensure logs, analytics events, job events, provider events, and debug output do not expose sensitive user data.

Sensitive data includes:

- Raw access tokens, reset tokens, invite tokens, auth tokens, and signed URL tokens
- Signed media/storage URLs
- Full addresses and precise location snapshots
- Notes, message bodies, consultation notes, aftercare notes, allergy notes, internal notes
- Raw provider payloads from Stripe, Twilio, Postmark, storage, or webhooks
- Raw email and phone values unless explicitly approved for a restricted operational event

## Required Pattern

Use centralized helpers from:

- `lib/security/redaction.ts` — field-level redactors (`redactEmail`, `redactPhone`,
  `redactToken`, `redactSignedUrl`, `redactAddress`, `redactNotes`).
- `lib/security/logging.ts` — `safeError(err)` (extracts only `name` + sanitized
  `message`, dropping enumerable error props such as a `StripeError.raw` payload),
  and `safeLogMeta(meta)` (recursive key-based redaction of tokens, emails, phones,
  addresses, notes, signed URLs).
- `lib/observability/authEvents.ts` for auth-specific events.

Prefer structured, minimized metadata:

- IDs instead of raw payloads
- Hash prefixes instead of raw contact info
- Counts/statuses instead of full payloads
- Provider message IDs only when safe
- Error names/codes instead of full raw objects

> **Convention:** never pass a raw `error`/`e` as a positional `console.*` argument.
> Wrap it: `console.error('… error', { error: safeError(e) })`. A raw error object is
> serialized with its full message + stack + enumerable provider fields, which is where
> tokens / provider payloads leak.

## Audit method (2026-06-27)

Five parallel scoped sweeps over every `console.*`, `Sentry.capture*`, and custom
observability call in the in-scope directories, classifying each call site as CLEAN
(routes data through `safeError`/`safeLogMeta`/redactors, or logs only IDs / counts /
statuses / enum codes) or LEAK (could serialize a sensitive value).

Two classes of finding emerged:

1. **Raw-PII-on-the-happy-path** — webhook receipt logs that passed raw phone/email
   through `safeLogMeta` under key names the redactor does not recognize. **Fixed.**
2. **Raw-error-object logging** — `console.*(msg, error)` sites that bypass `safeError`.
   The genuinely risky subset (errors that can carry a **signed URL** or a **provider
   payload** — storage uploads, Stripe, provider webhooks) is **fixed**. The remaining
   generic route-handler error logs (non-provider, error-path-only) are tracked as a
   systemic follow-up — see "Systemic finding" below.

## Audit Scope

### Booking routes

Status: Done

Files checked: `app/api/v1/bookings`, `app/api/v1/client/bookings`,
`app/api/v1/pro/bookings`, `lib/booking`.

Findings:

- CLEAN: write-boundary (`lib/booking/writeBoundary.ts`), refund/cancel helpers, and
  `lib/booking/conflictLogging.ts` route through `safeError`/`safeLogMeta` and log only
  IDs, timestamps, and structured metadata. Most route handlers already use `safeError`.
- LEAK (fixed): the client checkout / deposit Stripe-session handlers logged the raw
  `error` (a `StripeError` can carry a `.raw` provider payload). Wrapped in `safeError`:
  `client/bookings/[id]/checkout/route.ts`,
  `client/bookings/[id]/checkout/products/route.ts`,
  `client/bookings/[id]/checkout/stripe-session/route.ts`,
  `client/bookings/[id]/deposit/stripe-session/route.ts`,
  `client/rebook/[token]/checkout/route.ts`.
- DEFERRED (generic, low-risk): a handful of consultation-decision / consultation-proposal
  raw-error logs (`consultation/_decision.ts`, `pro/bookings/[id]/consultation-proposal`)
  — non-provider errors; folded into the systemic sweep below.

Required fixes:

- Stripe-payload-bearing sites wrapped in `safeError`. **Done.**

### Media routes and storage/signing helpers

Status: Done

Files checked: `app/api/v1/pro/media`, `app/api/v1/pro/uploads`,
`app/api/v1/client/uploads`, `app/api/v1/admin/uploads`, `app/api/v1/client/reviews`,
`app/api/v1/looks`, `app/api/v1/media`, `lib/media`.

Findings:

- CLEAN: `app/api/v1/pro/media`, `client/reviews` media routes, and `lib/media`
  render/signing helpers use `safeError`; signed URLs are never logged raw (the render
  helpers return them, they are not passed to a logger). `redactSignedUrl` exists for
  any future need.
- LEAK (fixed): the upload routes logged the raw `e` from the Supabase storage client.
  A storage error can surface request context; wrapped in `safeError`:
  `pro/uploads/route.ts`, `client/uploads/route.ts`, `admin/uploads/route.ts`.
- DEFERRED (generic, low-risk): the `looks/*` social routes (comments, likes, saves,
  reports, boards) log raw `e` on the error path. These carry no signed URLs or provider
  payloads — folded into the systemic sweep below.

Required fixes:

- Storage-error sites wrapped in `safeError`. **Done.**

### Aftercare routes

Status: Done

Files checked: `lib/aftercare`, aftercare API routes, aftercare paths in `lib/booking`.

Findings:

- CLEAN: aftercare API handlers use `safeError`; `writeBoundary.ts` delivery logging is
  ID-only + `safeError`. `aftercareAccessTokens.ts` / `unclaimedAftercareAccess.ts` /
  `proAftercareList.ts` do not log. Aftercare notes / allergy text are never logged.
- LEAK (low / deferred): `app/pro/aftercare/actions.ts` (server action) logs raw `error`
  alongside a `bookingId`; `app/pro/bookings/[id]/aftercare/AftercareForm.tsx` does a
  client-side `console.error(err)` (browser console only). Neither logs notes; folded
  into the systemic sweep.

Required fixes:

- No notes/token/contact leak found. Generic raw-error logs deferred to the sweep.

### Stripe webhooks and payment routes

Status: Done

Files checked: `app/api/webhooks/stripe`, Stripe checkout/payment routes
(`pro/payments/stripe/*`, `pro/membership/*`), `lib/stripe`, `lib/membership`,
`lib/observability/bookingEvents.ts`.

Findings:

- CLEAN: the Stripe webhook handler (`app/api/webhooks/stripe/route.ts`) uses `safeError`;
  `bookingEvents.ts` logs only IDs + status enums (Stripe IDs are in the `safeLogMeta`
  SAFE-ID set — `stripeEventId` / `stripeCheckoutSessionId` / `stripePaymentIntentId`).
- LEAK (fixed): the payment/membership routes logged the raw `error`/`e` (StripeError
  `.raw` provider-payload risk). Wrapped in `safeError`:
  `pro/payments/stripe/status/route.ts`,
  `pro/payments/stripe/onboarding-link/route.ts`,
  `pro/payments/stripe/connect-account/route.ts`,
  `pro/membership/checkout/route.ts`, `pro/membership/status/route.ts`,
  `pro/membership/portal/route.ts`. (The `client/bookings/*` Stripe-session sites are
  listed under "Booking routes".)

Required fixes:

- Payment-route raw-error sites wrapped in `safeError`. **Done.**

### Notification workers

Status: Done

Files checked: `app/api/internal/jobs/notifications`, `lib/notifications`,
`app/api/webhooks/{twilio,postmark}`,
`app/api/internal/webhooks/{twilio,postmark}/notifications`.

Findings:

- CLEAN: the delivery drain / `processDueDeliveries` / `completeDeliveryAttempt` paths
  log dispatch/delivery/notification IDs, channel, status, and provider message IDs —
  no destinations or bodies. Health/process-job endpoints log only aggregates.
- LEAK (fixed) — **raw PII on the happy path:**
  - `app/api/webhooks/twilio/route.ts` logged raw `to` / `from` phone numbers via
    `safeLogMeta` (the keys `to`/`from` are not in `PHONE_KEYS`, so they passed through
    unredacted). Now redacted with `redactPhone` at the call site.
  - `app/api/webhooks/postmark/route.ts` logged the raw `recipient` email (key not in
    `EMAIL_KEYS`). Now redacted with `redactEmail` at the call site (and `email` too,
    for defense in depth).
  - Call-site redaction was chosen over adding `to`/`from`/`recipient` to the global key
    sets, because those are common non-PII field names elsewhere and would over-redact.
- LEAK (fixed) — internal provider webhooks: the internal Twilio/Postmark status webhooks
  logged the raw `error` (the upstream error can wrap the provider form payload). Wrapped
  in `safeError`:
  `app/api/internal/webhooks/twilio/notifications/status/route.ts`,
  `app/api/internal/webhooks/postmark/notifications/route.ts`.

Required fixes:

- Webhook `to`/`from`/`recipient` redacted; internal-webhook raw errors wrapped. **Done.**

## Systemic finding — generic raw-error logging

Beyond the in-scope sensitive sites fixed above, ~200 route handlers app-wide follow the
pattern `console.error('<ROUTE> error', error)`, passing the raw error as a positional
argument instead of `{ error: safeError(error) }`. These are error-path-only and the
errors are overwhelmingly non-PII (Prisma/validation/connection errors), so they are
**lower risk** than the sites fixed here and are **not** a completion-criteria violation
on their own. They are tracked as a follow-up:

- **Recommended:** a baseline-tracked static guard (e.g. `check:no-raw-error-log`) wired
  into `npm run check:static-guards`, seeded with the current offenders as a baseline so
  CI does not break, and burned down over time (same pattern as `check:no-type-escape`
  and `check:no-raw-datetime-format`). New code would be required to use `safeError`;
  the existing ~200 sites migrate incrementally.
- This both documents the residue and prevents regression, which a one-time sweep does
  not.

## Completion Criteria

This audit is complete when:

- Raw tokens are not logged — **met** (token keys redacted by `safeLogMeta`; no raw-token
  logging found).
- Signed URLs are not logged — **met** (upload-error sites wrapped; render helpers do not
  log URLs).
- Full addresses are not logged — **met** (address keys redacted; no raw-address logging
  found).
- Notes/message bodies are not logged — **met** (no notes/body logging found).
- Raw provider payloads are not logged unless explicitly restricted and documented —
  **met** (Stripe/Twilio/Postmark provider-bearing error sites wrapped in `safeError`;
  raw webhook phone/email redacted).
- Any exceptions are listed with justification — see "Systemic finding": generic
  non-provider raw-error logs are accepted as low-risk and tracked for a guarded burn-down.
- Tests cover new redaction behavior where practical — the auth-event sanitizer
  (`lib/observability/authEvents.test.ts`) and `lib/security/{logging,redaction}.test.ts`
  cover the redaction helpers themselves. The call-site fixes in this pass are one-line
  applications of those tested helpers; the recommended static guard (above) is the
  durable regression cover for the pattern.
