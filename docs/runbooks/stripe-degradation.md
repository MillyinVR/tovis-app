# Stripe Degradation Runbook

Use this runbook when Stripe checkout, Stripe Connect, Stripe webhooks, or payment-state reconciliation is unavailable, delayed, misconfigured, or returning errors.

This usually means:

```text
/api/health/ready shows checks.stripe.status = degraded
checkout session creation fails
Stripe webhooks are delayed or failing
booking payment state does not update
booking checkout status is stuck
Stripe Connect onboarding fails
Pro payment settings fail to load or update
```

Stripe is not treated as a critical readiness dependency by default because TOVIS can still serve many non-payment flows while Stripe is degraded. However, Stripe is critical for booking closeout whenever payment or checkout status is required.

## Impact

Stripe supports:

```text
client checkout
booking payment status
booking checkout status
Stripe Connect onboarding
professional payment settings
payment-intent state
checkout-session state
webhook reconciliation
refund/dispute state
booking closeout eligibility
```

Expected user impact:

| Area | Impact |
|---|---|
| Client checkout | Clients may be unable to pay. |
| Booking closeout | Bookings may remain stuck if payment/checkout is required. |
| Pro payout readiness | Pros may not complete Connect onboarding. |
| Payment status | Booking payment state may lag behind Stripe. |
| Webhooks | Payment state updates may be delayed. |
| Support/admin | Manual reconciliation may be required. |

## Detection

### Health endpoint

Run:

```bash
curl -i https://YOUR_DOMAIN/api/health/ready
```

Problem signal:

```json
{
  "ok": true,
  "service": "tovis-app",
  "endpoint": "ready",
  "status": "degraded",
  "checks": {
    "stripe": {
      "name": "stripe",
      "status": "degraded",
      "message": "Stripe health check failed with HTTP 401."
    }
  }
}
```

Possible messages:

```text
Stripe is not configured. Missing STRIPE_SECRET_KEY.
Stripe health check timed out after 3000ms.
Stripe health check failed with HTTP 401.
Stripe health check failed with HTTP 403.
Stripe is reachable.
Stripe configuration is present. Live provider check is disabled.
```

### App symptoms

Look for:

```text
checkout session creation failing
payment page error
Stripe Connect onboarding link failure
Stripe webhook HTTP 400/401/500
Stripe webhook signature verification failure
Stripe webhook replay storm
booking stuck in payment required state
booking checkoutStatus stuck at READY or PARTIALLY_PAID
stripePaymentStatus stuck at PROCESSING or REQUIRES_ACTION
duplicate payment side-effect warnings
```

### Critical routes likely affected

```text
/api/client/bookings/[id]/checkout
/api/client/bookings/[id]/checkout/stripe-session
/api/webhooks/stripe
/api/pro/payment-settings
/api/pro/stripe/*
/api/bookings/finalize
/api/pro/bookings/[id]/aftercare
```

Route names may differ slightly by implementation. Search for Stripe checkout and webhook routes before making repairs. No guessing. Guessing with money is how villains are born.

## Severity

| Condition | Severity |
|---|---:|
| Stripe health degraded but checkout not currently used | Medium |
| Checkout session creation fails | High |
| Stripe webhooks fail to persist | High |
| Payment succeeded in Stripe but booking state did not update | High/Critical |
| Duplicate payment side effects suspected | Critical |
| Connect onboarding broken for Pros | Medium/High |
| Stripe secret or webhook secret exposed | Critical security incident |

## First response checklist

```text
1. Confirm /api/health/live.
2. Confirm /api/health/ready.
3. Confirm Postgres is ok.
4. Check Stripe provider status.
5. Check Stripe dashboard webhook delivery.
6. Check recent deploys and env var changes.
7. Check whether users can create checkout sessions.
8. Check whether webhooks are being received and processed.
9. Identify affected booking/payment IDs.
10. Decide rollback, feature disable, or provider-wait strategy.
```

If Postgres is down, switch to:

```text
docs/runbooks/postgres-outage.md
```

Stripe recovery usually depends on the database being healthy enough to persist webhook and booking state.

## Step 1 — Confirm dependency status

Run:

```bash
curl -i https://YOUR_DOMAIN/api/health/live
curl -i https://YOUR_DOMAIN/api/health/ready
```

Look at:

```text
checks.stripe.status
checks.stripe.message
checks.stripe.latencyMs
checks.postgres.status
checks.redis.status
```

If `checks.stripe.status = degraded` but provider live checks are disabled, the issue may be missing config rather than provider downtime.

## Step 2 — Check Stripe status

Check:

```text
Stripe status page
Stripe dashboard
API request logs
webhook delivery attempts
Connect account status
payment intent logs
checkout session logs
```

Record:

```text
Stripe incident URL
affected Stripe API area
start time
expected recovery
affected payment methods
webhook delay details
```

## Step 3 — Check environment variables

Verify production has:

```text
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY, if used by frontend
```

If using Stripe Connect, also verify any env vars used for:

```text
Connect refresh URL
Connect return URL
platform account config
application fee configuration
```

Do not paste Stripe secrets into incident notes, logs, screenshots, or support threads.

## Step 4 — Check recent deploys

Look for changes involving:

```text
Stripe API version
checkout route
webhook route
payment status mapping
Booking.checkoutStatus
Booking.stripePaymentStatus
ProfessionalPaymentSettings
aftercare closeout completion
idempotency ledger
runtime flags around payment behavior
```

Rollback is appropriate when:

```text
Stripe provider is healthy
failures started immediately after deploy
checkout/webhook/payment mapping code changed
env vars are unchanged and valid
```

Rollback is not enough when:

```text
Stripe provider is degraded
webhook secret was changed in dashboard
database is down
payments already succeeded and need reconciliation
```

## Step 5 — Check checkout session creation

Symptoms:

```text
client clicks checkout and receives error
checkout page fails to load
Stripe session URL is not returned
booking cannot move to payable/paid closeout
```

Check logs for:

```text
bookingId
clientId
professionalId
stripe account id
checkout session id
payment intent id
idempotency key
requestId
```

Common causes:

```text
missing STRIPE_SECRET_KEY
invalid price/amount
missing connected account
Pro payment settings incomplete
booking not eligible for checkout
checkout status not READY
Stripe API error
idempotency conflict
```

Immediate mitigation:

```text
1. If only checkout creation is broken, temporarily disable payment-required closeout CTA.
2. Show clear retry copy to clients.
3. Do not create duplicate bookings.
4. Do not manually mark booking paid unless Stripe payment is confirmed.
```

Suggested client copy:

```text
Payment is temporarily unavailable. Your booking information is safe. Please try checkout again shortly.
```

## Step 6 — Check Stripe webhook delivery

Check the Stripe dashboard for webhook endpoint:

```text
/api/webhooks/stripe
```

Look for:

```text
delivery status
HTTP status codes
signature verification errors
timeout errors
retries
event ids
event types
response body
```

Important event types may include:

```text
checkout.session.completed
payment_intent.succeeded
payment_intent.payment_failed
payment_intent.canceled
charge.refunded
charge.dispute.created
account.updated
```

Actual event handling depends on your implementation. Verify before replaying.

## Step 7 — Webhook safety rules

Do not replay webhooks blindly.

Before replaying:

```text
1. Confirm StripeWebhookEvent uses stripeEventId uniqueness.
2. Confirm the booking side effect is idempotent.
3. Confirm processed/failed state can recover from partial failure.
4. Confirm Postgres is healthy.
5. Replay one event first.
6. Verify booking state.
7. Then batch replay if safe.
```

Do not:

```text
delete StripeWebhookEvent rows to force replay
manually insert fake webhook events
mark payment succeeded without Stripe evidence
mark booking completed if closeout blockers remain
```

## Step 8 — Payment succeeded in Stripe but app did not update

This is high priority.

Collect:

```text
Stripe event id
checkout session id
payment intent id
booking id
client id
professional id
event created timestamp
webhook delivery attempts
app logs around that timestamp
StripeWebhookEvent row, if present
Booking payment fields
```

Check booking fields:

```text
stripeCheckoutSessionId
stripePaymentIntentId
stripePaymentStatus
checkoutStatus
status
sessionStep
finishedAt
```

Recovery path:

```text
1. Verify payment succeeded in Stripe dashboard.
2. Verify webhook event exists or replay from Stripe.
3. Let normal webhook handler update booking state.
4. If handler fails, fix handler/idempotency first.
5. Only perform manual DB repair with reviewed SQL and incident notes.
```

## Step 9 — Duplicate payment or duplicate side effects suspected

Treat as critical.

Signs:

```text
multiple Stripe payment intents for same booking
multiple checkout sessions used
duplicate payment notifications
booking state changed twice
duplicate audit logs
duplicate aftercare closeout messages
```

Immediate actions:

```text
1. Stop automatic replays.
2. Identify affected booking/payment ids.
3. Check idempotency keys.
4. Check Stripe dashboard for duplicate charges.
5. Do not refund until support/payment owner confirms.
6. Preserve logs.
```

If duplicate charge confirmed:

```text
1. Confirm customer impact.
2. Follow payment/refund policy.
3. Record Stripe charge/payment intent ids.
4. Notify support lead.
5. Create follow-up bug for idempotency gap.
```

## Step 10 — Stripe Connect / Pro payout readiness issues

Symptoms:

```text
Pro cannot start Connect onboarding
Pro payment settings show incomplete
booking checkout blocked because Pro cannot accept payment
account.updated webhook not processed
```

Check:

```text
ProfessionalPaymentSettings
Stripe connected account id
account charges_enabled
account payouts_enabled
requirements.currently_due
requirements.disabled_reason
account.updated webhook delivery
```

Mitigation:

```text
1. Confirm Stripe Connect account state.
2. Regenerate onboarding link if needed.
3. Do not enable payment-required booking for Pros without payment readiness.
4. Show readiness blockers in Pro dashboard.
```

## Step 11 — Closeout impact

Stripe degradation can block booking completion when closeout requires payment.

Check:

```text
Booking.checkoutStatus
Booking.stripePaymentStatus
AftercareSummary.sentToClientAt
MediaAsset phase AFTER
completionBlockers
```

If payment is degraded:

```text
1. Keep booking in closeout state.
2. Show payment blocker clearly.
3. Do not force COMPLETE unless payment is waived through approved flow.
4. If waiver is allowed, ensure audit log captures actor/reason.
```

Suggested Pro copy:

```text
Payment is still pending. The booking cannot be completed until checkout is paid or waived.
```

## Step 12 — Customer-facing behavior

For clients:

```text
Payment is temporarily unavailable or delayed. Please do not retry repeatedly. We’ll update the booking once payment status is confirmed.
```

For Pros:

```text
Payment status is temporarily delayed. Please keep the booking open until checkout updates or support confirms the next step.
```

For support:

```text
Do not ask users to create a duplicate booking.
Do not manually complete bookings unless payment/checkout requirements are satisfied or formally waived.
Do not promise refunds until Stripe charge/payment intent is verified.
```

## Step 13 — Recovery validation

Before resolving, confirm:

```text
/api/health/live returns ok
/api/health/ready returns ok or stripe no longer degraded
Stripe dashboard API/webhooks are healthy
checkout session creation works
Stripe webhook endpoint returns 2xx
failed webhook events are replayed safely
booking payment state updates correctly
booking closeout blockers clear when payment succeeds
no duplicate charges or side effects occurred
support has affected booking/payment list
```

## Post-recovery checks

Check incident window for:

```text
checkout session creation failures
Stripe webhook failures
payment succeeded but booking not updated
booking updated but payment not confirmed
duplicate checkout sessions
duplicate payment intents
duplicate notifications
bookings stuck in payment-required state
Pro Connect onboarding failures
```

Create repair tasks where needed.

## Rollback guidance

Rollback app deploy if:

```text
Stripe provider is healthy
errors started after deploy
checkout/webhook/payment mapping changed
idempotency logic changed
closeout/payment rules changed
env vars are unchanged
```

Do not rollback blindly if:

```text
Stripe is down
webhook secret changed outside code
payments already succeeded and need reconciliation
database is down
old code cannot process new payment state correctly
```

If webhook secret changed:

```text
1. Confirm active webhook endpoint secret in Stripe dashboard.
2. Update production env var.
3. Redeploy/restart if required.
4. Verify webhook signature success.
5. Replay one failed event.
6. Verify app state.
```

## Escalation

Escalate immediately when:

```text
payment succeeded but booking state is wrong
duplicate payment suspected
webhook persistence fails
checkout unavailable for many users
Stripe secret may be exposed
Connect onboarding blocks many Pros
booking closeout blocked broadly
```

Escalate to:

```text
on-call engineer
payment owner
support lead
Stripe support if provider/dashboard issue
security owner if secret exposure is suspected
```

## Logs to collect

Collect:

```text
timestamp range
deployment id
request ids
booking ids
client ids
professional ids
checkout session ids
payment intent ids
Stripe event ids
Stripe webhook delivery statuses
HTTP response codes
idempotency keys, redacted if needed
error messages
```

Do not collect or paste:

```text
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
full card data
client phone/email unless necessary and redacted
auth tokens
raw provider credentials
```

## Useful Stripe error signals

Common Stripe/API signals:

```text
Invalid API Key provided
No such checkout.session
No such payment_intent
Webhook signature verification failed
The provided key does not have access
Rate limit exceeded
API connection error
idempotency key reused with different parameters
account requirements currently due
```

Interpretation:

| Signal | Meaning | Action |
|---|---|---|
| `Invalid API Key` | Bad `STRIPE_SECRET_KEY` | Check env vars/key rotation |
| `signature verification failed` | Bad webhook secret/body parsing issue | Check `STRIPE_WEBHOOK_SECRET` and raw body handling |
| `No such checkout.session` | Wrong environment or bad ID | Check live/test mode and IDs |
| `idempotency key reused` | Request mismatch | Check idempotency payload hash/route |
| `Rate limit exceeded` | Provider throttling | Back off/retry later |
| `account requirements currently due` | Connect account incomplete | Send Pro to onboarding |

## Manual smoke tests

After recovery, verify:

```text
1. Client can open checkout for eligible booking.
2. Stripe checkout session is created.
3. Test payment succeeds.
4. Stripe webhook is received.
5. StripeWebhookEvent row is recorded.
6. Booking payment status updates.
7. Booking checkout status updates.
8. Closeout blocker clears.
9. Booking can complete through normal backend flow.
10. Duplicate webhook replay does not duplicate side effects.
```

Use test mode where possible. Do not create real charges just to make yourself feel alive.

## Incident notes template

```md
# Stripe incident

## Summary

## Start time

## End time

## Severity

## Detection

## Health check output

## User impact

## Affected payment flows

## Affected bookings/payments

## Stripe event ids

## Timeline

## Root cause

## Mitigation

## Recovery validation

## Reconciliation tasks

## Follow-up tasks

## Owner
```

## Follow-up tasks

After the incident, create issues for:

```text
missing webhook replay test
missing checkout load test
missing payment-state dashboard
missing alert
missing manual reconciliation tool
missing closeout blocker copy
idempotency gap
Stripe Connect readiness gap
unclear support process
```

## Related runbooks

```text
docs/runbooks/health-readiness.md
docs/runbooks/postgres-outage.md
docs/runbooks/notification-backlog.md
```