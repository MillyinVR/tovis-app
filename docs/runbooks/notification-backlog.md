# Notification Backlog Runbook

Use this runbook when notification dispatches or deliveries are delayed, stuck, failing, retrying repeatedly, or building a backlog.

This usually means:

```text
notification delivery jobs are not processing
oldest pending notification is too old
Postmark email deliveries are stuck
Twilio SMS deliveries are stuck
in-app notification delivery/versioning is delayed
aftercare or consultation links are not reaching clients
provider webhooks are not updating delivery status
```

Notification backlog incidents can be caused by Postgres, Redis, provider outages, worker/cron failures, bad retry logic, rate limiting, or invalid notification payloads. Naturally, it is never just one thing because apparently computers enjoy group projects.

## Impact

Notifications may support:

```text
booking status updates
consultation approval links
aftercare access links
appointment reminders
client/pro alerts
email delivery
SMS delivery
in-app notification inbox
delivery status tracking
provider webhook reconciliation
```

Expected user impact:

| Area | Impact |
|---|---|
| Consultation | Clients may not receive approval/rejection links. |
| Aftercare | Clients may not receive aftercare access links. |
| Booking updates | Clients/Pros may miss booking status changes. |
| Appointment reminders | Reminders may be delayed or skipped. |
| In-app inbox | Notifications may not appear or may appear late. |
| Email/SMS | Provider delivery may lag or fail. |
| Support | Support may need to resend or explain delays. |

## Detection

### Health endpoint

Run:

```bash
curl -i https://YOUR_DOMAIN/api/health/ready
```

Relevant checks:

```text
postgres
redis
postmark
twilio
```

Notification backlog may occur even when `/ready` is `ok`, so also check dashboard/job metrics.

### App symptoms

Look for:

```text
NotificationDelivery rows stuck pending
NotificationDelivery rows repeatedly retrying
NotificationDelivery rows marked failed
NotificationDispatch rows not faning out
provider message ids missing
Postmark/Twilio webhook events not updating rows
aftercare sent but no delivery
consultation proposal sent but client receives no link
oldest pending delivery age increasing
notification job endpoint failing
cron not running
```

### Critical routes/jobs likely affected

```text
/api/internal/jobs/notifications/process
/api/webhooks/postmark
/api/webhooks/twilio
/api/pro/bookings/[id]/consultation-proposal
/api/pro/bookings/[id]/aftercare
/api/public/consultation/[token]/decision
/api/client/rebook/[token]
```

Route names may differ slightly by implementation. Verify the exact current paths before making repairs.

## Severity

| Condition | Severity |
|---|---:|
| Non-critical reminders delayed | Medium |
| Aftercare access links delayed broadly | High |
| Consultation links delayed during active appointments | High |
| Phone/email verification delivery affected | High |
| Provider backlog plus webhook failures | High |
| Notification processing causing DB overload | Critical |
| Duplicate notification sends suspected | Critical |
| Secure action tokens exposed or sent to wrong recipient | Critical security incident |

## First response checklist

```text
1. Confirm /api/health/live.
2. Confirm /api/health/ready.
3. Check Postgres, Redis, Postmark, and Twilio status.
4. Check notification processing job status.
5. Check oldest pending delivery age.
6. Check failed delivery count by channel.
7. Check retry attempts and nextAttemptAt.
8. Check provider dashboards.
9. Identify affected notification types.
10. Decide whether to pause retries, replay safely, or fail over to alternate channels.
```

If Postgres is down, switch first to:

```text
docs/runbooks/postgres-outage.md
```

If Postmark is degraded, use:

```text
docs/runbooks/postmark-degradation.md
```

If Twilio is degraded, use:

```text
docs/runbooks/twilio-degradation.md
```

If Redis is degraded and notification freshness/versioning is affected, use:

```text
docs/runbooks/redis-outage.md
```

## Step 1 — Confirm health status

Run:

```bash
curl -i https://YOUR_DOMAIN/api/health/live
curl -i https://YOUR_DOMAIN/api/health/ready
```

Look at:

```text
checks.postgres.status
checks.redis.status
checks.postmark.status
checks.twilio.status
```

Notification processing requires Postgres. Provider delivery depends on Postmark/Twilio. Realtime/freshness may depend on Redis.

## Step 2 — Check notification job execution

Check whether the notification processor is running.

Look for:

```text
Vercel cron execution
internal job route status
job auth errors
recent job failures
job duration
job timeout
last successful run
```

Likely job route:

```text
/api/internal/jobs/notifications/process
```

Possible symptoms:

```text
401/403 from missing INTERNAL_JOB_SECRET or CRON_SECRET
500 from provider error
timeout before batch finishes
job not triggered by cron
job runs but claims no rows
job crashes on one bad notification
```

Immediate mitigation:

```text
1. Verify cron is enabled.
2. Verify job secret env vars.
3. Manually trigger the job only if safe and documented.
4. Reduce batch size if timeouts occur.
5. Pause provider-specific sends if provider is rejecting requests.
```

## Step 3 — Check backlog size and age

Inspect notification tables or dashboard panels for:

```text
pending dispatch count
pending delivery count
oldest pending delivery age
failed delivery count
retrying delivery count
delivery attempts distribution
nextAttemptAt distribution
channel breakdown: IN_APP / EMAIL / SMS
provider breakdown: POSTMARK / TWILIO
source type breakdown: aftercare / consultation / booking / reminder
```

Important thresholds:

| Signal | Alert threshold |
|---|---:|
| Oldest pending delivery | > 10 minutes |
| Email pending count | increasing for > 10 minutes |
| SMS pending count | increasing for > 10 minutes |
| Failed delivery rate | > 5% over 10 minutes |
| Retry attempts near max | any critical notification type |
| Consultation/aftercare delivery delayed | immediate investigation |

## Step 4 — Classify affected notification types

Prioritize:

```text
account/security notifications
phone/email verification
consultation action links
aftercare access links
booking status changes
payment/checkout notifications
appointment reminders
generic marketing/non-critical reminders
```

Critical notification types:

```text
consultation approval links
aftercare access links
booking cancellation/reschedule updates
payment-required updates
verification/security messages
```

Non-critical notification types:

```text
digest notifications
non-urgent reminders
marketing, if any
low-priority engagement nudges
```

If provider capacity is limited, pause or delay non-critical notifications first.

## Step 5 — Check provider delivery

For email:

```text
docs/runbooks/postmark-degradation.md
```

Check:

```text
Postmark accepted/rejected messages
provider message id recorded
bounce/complaint activity
message stream
webhook delivery
```

For SMS:

```text
docs/runbooks/twilio-degradation.md
```

Check:

```text
Twilio accepted/rejected messages
provider message SID recorded
carrier error codes
rate limits
phone/country policy
webhook delivery
```

## Step 6 — Check failed delivery rows

For failed deliveries, inspect:

```text
channel
provider
status
attempts
maxAttempts
lastError
nextAttemptAt
providerMessageId
recipient snapshot
sourceKey
createdAt
updatedAt
```

Common causes:

```text
invalid recipient
missing provider config
provider outage
rate limit
bad payload/template
expired action token
recipient opted out
delivery destination not verified
webhook update failed
```

Do not retry hard failures blindly. Retrying invalid phone numbers and hard-bounced emails is not perseverance; it is spam cosplay.

## Step 7 — Check retry policy

Verify:

```text
failed delivery retries have backoff
nextAttemptAt is in the future
maxAttempts is reasonable
critical notifications do not retry forever
provider 429s back off
hard bounces do not retry repeatedly
```

If retry storm is happening:

```text
1. Pause notification processor.
2. Identify failing provider/channel/source type.
3. Increase backoff or disable affected channel temporarily.
4. Resume with small batch size.
5. Watch provider and DB load.
```

## Step 8 — Check duplicate sends

Duplicate sends may happen if idempotency/source keys are wrong.

Signs:

```text
same sourceKey has multiple dispatches
same booking event sent multiple times
same aftercare link sent repeatedly
same consultation link sent repeatedly
same provider message id appears more than once
users report duplicate SMS/email
```

Immediate actions:

```text
1. Pause affected notification source.
2. Identify duplicate sourceKey or idempotency gap.
3. Stop retries if they are creating duplicates.
4. Preserve logs and affected rows.
5. Do not delete duplicates until you understand why they happened.
```

Expected invariant:

```text
A business event should create one canonical dispatch sourceKey.
Retries should retry delivery, not create a new business notification every time.
```

## Step 9 — Check secure action links

Some notifications may carry secure action links for:

```text
consultation approval/rejection
aftercare access
rebooking
claim/invite flows
```

Verify:

```text
ClientActionToken exists
token is unexpired
token recipient matches intended client
token was not revoked
single-use behavior is correct
notification was sent to verified/allowed destination
```

If wrong recipient or token leak is suspected:

```text
1. Treat as security/privacy incident.
2. Revoke affected tokens.
3. Preserve audit logs.
4. Identify affected users/bookings.
5. Escalate to security/privacy owner.
6. Do not resend until scope is known.
```

## Step 10 — Check in-app notification freshness

If in-app notifications are delayed:

```text
1. Confirm Notification rows are created.
2. Confirm dispatch/delivery rows are created if used.
3. Confirm Redis/versioning is working if used for freshness.
4. Confirm client polling/realtime path is working.
5. Confirm unread counts are updated.
```

If Redis is degraded:

```text
docs/runbooks/redis-outage.md
```

Mitigation:

```text
fall back to DB refresh
show refresh guidance
increase polling interval if Redis errors increase load
```

## Step 11 — Manual job replay guidance

Only manually replay notification processing when:

```text
Postgres is healthy
provider is healthy or affected channel is disabled
processor is idempotent
sourceKey uniqueness is intact
you know which delivery rows are safe to retry
```

Do not manually replay when:

```text
duplicate sends are suspected
provider is rejecting due to hard bounce/invalid phone
tokens may be wrong or leaked
Postgres is unstable
retry storm is ongoing
```

Safe replay process:

```text
1. Pick one affected delivery.
2. Confirm it is eligible for retry.
3. Run normal processor path.
4. Confirm status changes as expected.
5. Confirm provider accepted or rejected.
6. Confirm no duplicate dispatch created.
7. Scale to small batch.
8. Watch backlog and provider metrics.
```

## Step 12 — Customer-facing behavior

For clients:

```text
Some notifications may be delayed. Your booking information is still available in the app.
```

For aftercare:

```text
Your aftercare is ready, but delivery may be delayed. Please check the app or wait for the resend.
```

For consultation:

```text
Your consultation approval link may be delayed. Please check the app or contact your Pro if your appointment is active.
```

For Pros:

```text
Client notifications may be delayed. Use the booking/session page as the source of truth.
```

For support:

```text
Do not create duplicate bookings.
Do not create duplicate aftercare summaries.
Do not paste secure links into unapproved channels.
Do not manually mark delivery successful.
Do not promise delivery until provider/app state confirms it.
```

## Step 13 — Recovery validation

Before resolving, confirm:

```text
/api/health/live returns ok
/api/health/ready returns ok or provider-specific degradation is understood
notification processor is running successfully
oldest pending delivery age is decreasing
pending delivery count is decreasing
failed delivery rate is back to baseline
provider dashboards show accepted sends
webhooks update delivery status
critical notification types are delivered
no duplicate sends were created
support has affected-user list if needed
```

## Post-recovery checks

Check incident window for:

```text
missed consultation links
missed aftercare links
missed booking cancellation/reschedule updates
failed verification messages
duplicate sends
expired action tokens
delivery rows stuck at max attempts
provider events not reconciled
users who need resend
```

Create repair tasks where needed.

## Resend guidance

Only resend when:

```text
the original delivery failed or expired
destination is verified and allowed
token is valid or safely regenerated
resend path is idempotent
provider is healthy
user impact is confirmed
```

Do not resend when:

```text
provider accepted delivery and status is unknown
hard bounce occurred
recipient opted out
SMS carrier filtering is active
token may have been sent to wrong recipient
delivery already succeeded
```

## Rollback guidance

Rollback app deploy if:

```text
backlog started immediately after deploy
notification processor changed
dispatch/enqueue logic changed
provider config parsing changed
template rendering changed
webhook route changed
idempotency/sourceKey logic changed
provider dashboards are healthy
```

Do not rollback if:

```text
provider is degraded
Postgres is down
Redis is down and only freshness is affected
token leak or wrong-recipient issue needs immediate revocation
old code cannot process current notification rows safely
```

## Escalation

Escalate immediately when:

```text
consultation links fail during active appointments
aftercare access links fail broadly
verification/security messages fail
duplicate sends are suspected
secure action token leak is suspected
wrong-recipient delivery is suspected
provider backlog does not drain
notification processor fails repeatedly
```

Escalate to:

```text
on-call engineer
notification owner
support lead
security/privacy owner if tokens or recipients are affected
Postmark/Twilio support if provider issue
```

## Logs to collect

Collect:

```text
timestamp range
deployment id
request ids
notification dispatch ids
notification delivery ids
sourceKeys
booking ids
client/pro ids
channel/provider
provider message ids/SIDs
attempt counts
last error messages
webhook event ids
processor job run ids
queue/backlog metrics
```

Do not collect or paste:

```text
raw secure action tokens
auth cookies
JWTs
provider credentials
full phone numbers unless necessary and redacted
raw email addresses unless necessary and redacted
signed media URLs
```

## Useful error signals

Common notification signals:

```text
provider not configured
invalid recipient
hard bounce
carrier violation
rate limit exceeded
token expired
recipient opted out
delivery row not found
sourceKey conflict
webhook signature invalid
max attempts reached
processor timeout
```

Interpretation:

| Signal | Meaning | Action |
|---|---|---|
| `provider not configured` | Missing env/config | Check provider config |
| `invalid recipient` | Bad email/phone | Do not retry repeatedly |
| `hard bounce` | Email permanently failed | Suppress / do not retry |
| `carrier violation` | SMS filtered | Pause retries and review content |
| `rate limit exceeded` | Provider throttling | Back off and prioritize |
| `token expired` | Link no longer valid | Regenerate only if safe |
| `sourceKey conflict` | Duplicate dispatch protection triggered | Check idempotency logic |
| `max attempts reached` | Delivery abandoned | Manual review/resend if safe |

## Manual smoke tests

After recovery, verify:

```text
1. Trigger a low-risk in-app notification.
2. Confirm Notification/Dispatch row is created.
3. Confirm Delivery rows are created for intended channels.
4. Confirm email delivery succeeds through Postmark.
5. Confirm SMS delivery succeeds through Twilio.
6. Confirm provider webhook updates status.
7. Confirm duplicate processor run does not duplicate sends.
8. Confirm aftercare access delivery works for test booking.
9. Confirm consultation action delivery works for test booking.
```

Use internal test users only. Do not send mystery links to real clients. That is not QA; that is how support tickets hatch.

## Incident notes template

```md
# Notification backlog incident

## Summary

## Start time

## End time

## Severity

## Detection

## Health check output

## User impact

## Affected notification types

## Affected channels

## Backlog metrics

## Affected bookings/users

## Timeline

## Root cause

## Mitigation

## Recovery validation

## Resend/reconciliation tasks

## Follow-up tasks

## Owner
```

## Follow-up tasks

After the incident, create issues for:

```text
missing backlog dashboard
missing oldest-pending alert
missing retry storm protection
missing sourceKey uniqueness test
missing resend tooling
missing webhook replay test
missing provider-specific fallback
missing token-recipient validation
unclear support copy
```

## Related runbooks

```text
docs/runbooks/health-readiness.md
docs/runbooks/postgres-outage.md
docs/runbooks/redis-outage.md
docs/runbooks/postmark-degradation.md
docs/runbooks/twilio-degradation.md
docs/runbooks/stripe-degradation.md
```