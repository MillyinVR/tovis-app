# Idempotency Map

Status: Complete (documentation of existing mechanisms)
Recorded: 2026-06-12
HEAD at recording: `e6a52a8`

One page answering: for every state-changing surface, what makes a retry safe?
Four mechanisms cover the app. Anything not listed under a mechanism is called
out under Known gaps — do not assume an unlisted mutation route is retry-safe.

## Mechanism 1 — Route idempotency keys (client-supplied)

Shared helper: `app/api/_utils/idempotency.ts`
(`beginRouteIdempotency` / `completeRouteIdempotency` / `failStartedRouteIdempotency`)
over `lib/idempotency` and the `IdempotencyKey` model (`prisma/schema.prisma:999`).

Behavior: missing key → 400; in-progress duplicate → 409; same key with a
different request body → 409 (request-hash conflict); completed duplicate →
replays the recorded response. Covered by `app/api/_utils/idempotency.test.ts`.

Routes wired (21, verified by grep at HEAD):

| Surface | Route |
|---|---|
| Booking finalize | `app/api/bookings/finalize/route.ts` |
| Client cancel | `app/api/bookings/[id]/cancel/route.ts` |
| Client reschedule | `app/api/bookings/[id]/reschedule/route.ts` |
| Client checkout | `app/api/client/bookings/[id]/checkout/route.ts` |
| Client checkout products | `app/api/client/bookings/[id]/checkout/products/route.ts` |
| Client checkout Stripe session | `app/api/client/bookings/[id]/checkout/stripe-session/route.ts` |
| Client review | `app/api/client/bookings/[id]/review/route.ts` |
| Client rebook by token | `app/api/client/rebook/[token]/route.ts` |
| Pro cancel | `app/api/pro/bookings/[id]/cancel/route.ts` |
| Pro booking PATCH | `app/api/pro/bookings/[id]/route.ts` |
| Pro rebook | `app/api/pro/bookings/[id]/rebook/route.ts` |
| Pro aftercare | `app/api/pro/bookings/[id]/aftercare/route.ts` |
| Pro booking media | `app/api/pro/bookings/[id]/media/route.ts` |
| Pro checkout mark-paid | `app/api/pro/bookings/[id]/checkout/mark-paid/route.ts` |
| Pro checkout waive | `app/api/pro/bookings/[id]/checkout/waive/route.ts` |
| Pro consultation proposal | `app/api/pro/bookings/[id]/consultation-proposal/route.ts` |
| Pro in-person consultation decision | `app/api/pro/bookings/[id]/consultation/in-person-decision/route.ts` |
| Pro session start | `app/api/pro/bookings/[id]/session/start/route.ts` |
| Pro session step | `app/api/pro/bookings/[id]/session/step/route.ts` |
| Pro session finish | `app/api/pro/bookings/[id]/session/finish/route.ts` |
| Public consultation decision | `app/api/public/consultation/[token]/decision/route.ts` |

## Mechanism 2 — Stripe webhook event dedup

`StripeWebhookEvent.stripeEventId @unique` (`prisma/schema.prisma:2483`).
`app/api/webhooks/stripe/route.ts` short-circuits with `{ duplicate: true }`
when `processedAt` is already set, and wraps `handleStripeEvent(tx, event)` +
the `processedAt` write in a single `prisma.$transaction` — a crash mid-handler
rolls back the marker so the retry reprocesses atomically. Replay-storm
behavior is asserted by `tests/chaos/stripe-webhook-storm.test.ts` and
`tests/load/stripe-webhook-replay`.

## Mechanism 3 — Domain unique dedup constraints

Writes that can be attempted more than once converge on unique keys instead of
route keys:

| Model | Constraint | Purpose |
|---|---|---|
| `Notification` | `@@unique([professionalId, dedupeKey])` (`schema.prisma:555`) | one notification per logical event per pro |
| `Reminder` | `dedupeKey @unique` (`schema.prisma:2635`) | reminder sweeps re-run safely |
| `LooksSocialJob` | `dedupeKey @unique` (`schema.prisma:2894`) | social-job enqueue re-run safely |
| `Review` | `@@unique([bookingId, idempotencyKey])` (`schema.prisma:2602`) | review double-submit |
| `BookingCloseoutAuditLog` | `@@unique([bookingId, action, idempotencyKey])` (`schema.prisma:2196`) | audit rows not duplicated on retried closeout |

## Mechanism 4 — Database backstops (not idempotency, but retry safety)

- Booking overlap exclusion constraint
  (`prisma/migrations/20260522000000_add_booking_overlap_exclusion`): even if a
  retry slips past application checks, a second active booking for the same pro
  and overlapping range is rejected at the DB. Exercised by
  `tests/integration/booking-overlap-concurrency.test.ts`.
- All booking lifecycle mutations run inside the write boundary's transaction
  (`lib/booking/writeBoundary.ts`), so partial retries cannot leave split state.

## Internal jobs

Cron routes under `app/api/internal/jobs/` are re-entrant by construction
rather than key-protected: sweeps select work by state (e.g. due deliveries,
expired holds, stale sessions) and the writes they perform either converge on
the Mechanism-3 unique keys above or are no-ops on a second pass. Job-level
retry/dead-letter semantics are the WS-4 Inngest migration's scope.

## Known gaps

- `POST /api/holds` is not idempotency-key protected. A retried request can
  create a second hold; exposure is bounded by hold expiry + the hold-cleanup
  job, and finalize (which converts holds to bookings) is key-protected plus
  backstopped by the overlap constraint. Accepted for launch; revisit if hold
  spam shows up in metrics.
- Signup/auth mutations rely on natural unique keys (`User.email`,
  `emailHashV2`) rather than route idempotency keys.
