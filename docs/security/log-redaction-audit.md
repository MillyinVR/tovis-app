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

- `lib/security/redaction.ts`
- `lib/observability/authEvents.ts` for auth-specific events

Prefer structured, minimized metadata:

- IDs instead of raw payloads
- Hash prefixes instead of raw contact info
- Counts/statuses instead of full payloads
- Provider message IDs only when safe
- Error names/codes instead of full raw objects

## Audit Scope

### Booking routes

Status: Pending

Files to check:

- `app/api/bookings`
- `app/api/client/bookings`
- `app/api/pro/bookings`
- `lib/booking`

Findings:

- Pending

Required fixes:

- Pending

### Media routes and storage/signing helpers

Status: Pending

Files to check:

- `app/api/pro/media`
- `app/api/client/reviews`
- `app/api/looks`
- `lib/media`
- storage/signing helpers

Findings:

- Pending

Required fixes:

- Pending

### Aftercare routes

Status: Pending

Files to check:

- `lib/aftercare`
- `lib/booking`
- aftercare-related API routes

Findings:

- Pending

Required fixes:

- Pending

### Stripe webhooks and payment routes

Status: Pending

Files to check:

- `app/api/webhooks/stripe`
- Stripe checkout/payment routes
- payment helpers

Findings:

- Pending

Required fixes:

- Pending

### Notification workers

Status: Pending

Files to check:

- `app/api/internal/jobs/notifications`
- `lib/notifications`
- Twilio/Postmark webhook routes

Findings:

- Pending

Required fixes:

- Pending

## Completion Criteria

This audit is complete when:

- Raw tokens are not logged
- Signed URLs are not logged
- Full addresses are not logged
- Notes/message bodies are not logged
- Raw provider payloads are not logged unless explicitly restricted and documented
- Any exceptions are listed with justification
- Tests cover new redaction behavior where practical