# Postmark Degradation Runbook

Use this runbook when Postmark email delivery, email provider configuration, email webhook processing, or email delivery-status tracking is unavailable, delayed, misconfigured, or returning errors.

This usually means:

```text
/api/health/ready shows checks.postmark.status = degraded
email notifications are not being sent
aftercare emails are delayed
verification emails are delayed
Postmark webhook events are failing
bounce/open/delivery events are not updating
Postmark configuration is missing
```

Postmark is not treated as a critical readiness dependency by default because TOVIS can still serve many app flows while email delivery is degraded. However, email degradation can affect aftercare access, verification, client communication, and support visibility.

## Impact

Postmark may support:

```text
transactional email notifications
aftercare access delivery
booking reminders
consultation links
verification or account emails, if email verification uses Postmark
delivery status updates
bounce handling
email provider webhooks
```

Expected user impact:

| Area | Impact |
|---|---|
| Aftercare delivery | Clients may not receive aftercare email links. |
| Booking notifications | Email-based booking updates may be delayed or missing. |
| Consultation links | Remote action links may not arrive by email. |
| Verification | Email verification may fail if routed through Postmark. |
| Delivery tracking | App may not know whether email was delivered/bounced. |
| Support | Support may need to resend links or use SMS/in-app fallback. |

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
    "postmark": {
      "name": "postmark",
      "status": "degraded",
      "message": "Postmark email is not configured."
    }
  }
}
```

Possible messages:

```text
Postmark email is not configured.
Postmark health check timed out after 3000ms.
Postmark health check failed with HTTP 401.
Postmark health check failed with HTTP 403.
Postmark health check failed with HTTP 429.
Postmark configuration is present. Live provider check is disabled.
Postmark is reachable.
```

### App symptoms

Look for:

```text
email delivery rows stuck pending
email delivery rows marked failed
aftercare access emails not received
consultation emails not received
booking reminder emails missing
Postmark webhook route returning 400/401/500
bounce events not processed
delivery status not updating
support reports of missing emails
```

### Critical routes likely affected

```text
/api/webhooks/postmark
/api/pro/bookings/[id]/aftercare
/api/pro/bookings/[id]/consultation-proposal
/api/public/consultation/[token]/decision
/api/auth/*
notification delivery processing job
```

Route names may differ slightly by implementation. Verify the exact path before making repairs. No production archaeology by vibes.

## Severity

| Condition | Severity |
|---|---:|
| Postmark config missing in local/dev only | Low |
| Email delayed but SMS/in-app fallback works | Medium |
| Aftercare access emails failing broadly | High |
| Verification emails failing and blocking signup/login | High |
| Postmark webhook failing but sends still work | Medium |
| Bounce rate spike or sender reputation issue | High |
| Postmark token exposed | Critical security incident |

## First response checklist

```text
1. Confirm /api/health/live.
2. Confirm /api/health/ready.
3. Confirm Postgres is ok.
4. Check Postmark provider status.
5. Check Postmark dashboard activity.
6. Check notification backlog.
7. Check delivery rows for EMAIL channel.
8. Check recent deploys and env var changes.
9. Identify affected notification types.
10. Decide fallback, resend, rollback, or provider-wait strategy.
```

If Postgres is down, switch to:

```text
docs/runbooks/postgres-outage.md
```

Email delivery recovery usually depends on the database being healthy enough to persist notification state.

## Step 1 — Confirm dependency status

Run:

```bash
curl -i https://YOUR_DOMAIN/api/health/live
curl -i https://YOUR_DOMAIN/api/health/ready
```

Look at:

```text
checks.postmark.status
checks.postmark.message
checks.postmark.latencyMs
checks.postgres.status
checks.redis.status
```

If `checks.postmark.status = degraded` but provider live checks are disabled, the issue may be missing config, not a live provider outage.

## Step 2 — Check Postmark status

Check:

```text
Postmark status page
Postmark server dashboard
message activity
bounce activity
spam complaint activity
suppression list
server token status
message stream status
webhook delivery logs
sender signature / domain authentication
```

Record:

```text
Postmark incident URL
affected server/message stream
start time
expected recovery
affected message types
```

## Step 3 — Check environment variables

Verify production has:

```text
POSTMARK_SERVER_TOKEN
POSTMARK_API_TOKEN, if used as fallback
POSTMARK_NOTIFICATION_FROM_EMAIL
POSTMARK_FROM_EMAIL, if used as fallback
EMAIL_FROM, if used as fallback
POSTMARK_NOTIFICATION_MESSAGE_STREAM
POSTMARK_MESSAGE_STREAM, if used
```

The health check treats Postmark as configured only when it has a server token and sender email.

Do not paste Postmark tokens into incident notes, logs, screenshots, or support threads.

## Step 4 — Check recent deploys

Look for changes involving:

```text
lib/notifications/config.ts
notification delivery processing
email template rendering
aftercare access delivery
consultation proposal delivery
Postmark webhook route
message stream names
sender email config
runtime flags for notifications
```

Rollback is appropriate when:

```text
Postmark provider is healthy
failures started immediately after deploy
email config/template/delivery code changed
webhook handling changed
env vars are unchanged and valid
```

Rollback is not enough when:

```text
Postmark provider is degraded
server token was revoked
sender domain/authentication failed
messages are blocked by suppression/bounce policy
Postgres is down
```

## Step 5 — Check notification backlog

Email delivery is usually represented through notification dispatch/delivery rows.

Check for:

```text
EMAIL deliveries stuck pending
EMAIL deliveries retrying repeatedly
EMAIL deliveries marked failed
oldest pending delivery age
delivery attempts count
provider message id presence
last error message
```

Prioritize notification types:

```text
aftercare access
consultation action links
booking reminders
booking status changes
verification/account emails
payment/receipt emails, if any
```

If backlog is growing:

```text
1. Check provider status.
2. Check worker/job processing status.
3. Check Postgres health.
4. Check rate limiting/provider throttle.
5. Do not blindly retry everything if provider is rejecting messages.
```

Use:

```text
docs/runbooks/notification-backlog.md
```

if queue/backlog behavior is the main symptom.

## Step 6 — Check aftercare access delivery

Postmark degradation can block clients from receiving aftercare links.

Check:

```text
AftercareSummary.sentToClientAt
ClientActionToken for AFTERCARE_ACCESS
NotificationDispatch sourceKey
NotificationDelivery channel EMAIL
delivery status
provider message id
failure message
```

Safe mitigation:

```text
1. Confirm aftercare was generated.
2. Confirm secure ClientActionToken exists.
3. Resend through the normal delivery path if idempotent/safe.
4. Use SMS or in-app fallback if available and allowed.
5. Do not expose raw tokens in support chat.
```

Suggested support copy:

```text
Your aftercare information is ready, but email delivery is delayed. We can resend the link once email service recovers or use an alternate approved delivery method.
```

## Step 7 — Check consultation link delivery

If remote consultation approval depends on email:

```text
1. Confirm consultation proposal exists.
2. Confirm ClientActionToken exists and is unexpired.
3. Confirm email delivery status.
4. Use SMS/in-app fallback if allowed.
5. If in-person decision is available, Pro may complete approval on their device.
```

Do not create duplicate consultation proposals just because the email failed. Resend the existing secure action where possible.

## Step 8 — Check webhook processing

Postmark webhooks may report delivery, bounce, spam complaint, or failure events.

Check webhook route:

```text
/api/webhooks/postmark
```

Look for:

```text
HTTP 2xx response
signature/auth validation errors, if used
event parsing errors
unknown provider message id
delivery row not found
duplicate webhook event behavior
failed DB writes
```

If webhooks are failing but sends are working:

```text
1. Delivery may still happen to users.
2. Internal delivery status may be stale.
3. Do not resend just because webhook status is missing.
4. Reconcile provider message ids after recovery.
```

## Step 9 — Bounce or reputation issue

Signs:

```text
bounce rate spike
spam complaint spike
sender signature warning
domain authentication failure
Postmark suppression list growth
messages accepted but not delivered
```

Immediate actions:

```text
1. Pause non-critical bulk/reminder sends.
2. Keep transactional high-priority emails only if allowed.
3. Check sender domain authentication.
4. Check recent template/content changes.
5. Check whether a bad list/import caused bounces.
6. Escalate to provider/support owner.
```

Do not keep retrying hard bounces. That makes sender reputation worse. Email providers are very judgey, and in this case they are correct.

## Step 10 — Provider rate limiting

If Postmark returns 429 or throttling errors:

```text
1. Stop aggressive retries.
2. Back off delivery worker.
3. Prioritize critical transactional emails.
4. Delay non-critical reminders.
5. Check provider plan/limits.
6. Resume gradually.
```

Critical emails:

```text
account/security
consultation action
aftercare access
booking status change
```

Lower-priority emails:

```text
marketing
non-urgent reminders
digest-style notifications
```

## Step 11 — Customer-facing behavior

For clients:

```text
Email delivery is temporarily delayed. Your booking and aftercare information are safe. Please check the app for updates or try again shortly.
```

For Pros:

```text
Client email delivery may be delayed. Use in-app status and approved fallback channels when available.
```

For support:

```text
Do not paste secure action links into unapproved channels.
Do not create duplicate bookings or aftercare summaries.
Do not mark delivery successful unless provider/app state confirms it.
```

## Step 12 — Recovery validation

Before resolving, confirm:

```text
/api/health/live returns ok
/api/health/ready returns ok or postmark no longer degraded
Postmark dashboard shows accepted sends
Postmark webhook route returns 2xx
EMAIL notification backlog is draining
aftercare emails send successfully
consultation action emails send successfully
bounce rate is normal
no duplicate sends occurred
support has affected-user list if needed
```

## Post-recovery checks

Check incident window for:

```text
failed EMAIL deliveries
pending EMAIL deliveries older than threshold
aftercare access not delivered
consultation links not delivered
verification/account emails not delivered
duplicate email sends
bounce/spam complaint spike
webhook events received but not processed
```

Create repair or resend tasks where needed.

## Resend guidance

Only resend when:

```text
the original delivery failed or expired
the action token is still valid or can be safely regenerated
the resend path is idempotent
the recipient destination is verified/allowed
support has confirmed user impact, if manual
```

Do not resend when:

```text
provider accepted the message and status is unknown
hard bounce occurred
recipient opted out or is suppressed
token is expired and cannot be regenerated safely
delivery was already completed
```

## Rollback guidance

Rollback app deploy if:

```text
Postmark provider is healthy
failures started after deploy
email template/delivery/config code changed
webhook handler changed
message stream config changed
env vars are unchanged and valid
```

Do not rollback if:

```text
provider is degraded
sender domain is unauthenticated
token was revoked outside code
suppression/bounce issue is caused by recipients/content
Postgres is down
```

If sender config changed:

```text
1. Confirm sender email/domain in Postmark.
2. Confirm DNS authentication.
3. Confirm env var matches verified sender.
4. Deploy corrected env/config.
5. Send one test message through normal app path.
6. Verify webhook delivery status.
```

## Escalation

Escalate immediately when:

```text
aftercare emails fail broadly
consultation action links fail broadly
verification/account emails fail
bounce/spam complaint rate spikes
Postmark token may be exposed
webhooks fail for more than 10 minutes
email backlog grows and does not drain
```

Escalate to:

```text
on-call engineer
notification owner
support lead
security owner if token exposure is suspected
Postmark support if provider/dashboard issue
```

## Logs to collect

Collect:

```text
timestamp range
deployment id
request ids
notification dispatch ids
notification delivery ids
provider message ids
message stream
email channel status
webhook event ids
affected booking ids
affected client/pro ids
error messages
Postmark dashboard status
```

Do not collect or paste:

```text
POSTMARK_SERVER_TOKEN
POSTMARK_API_TOKEN
full secure action tokens
raw client email addresses unless necessary and redacted
auth cookies
JWTs
signed media URLs
```

## Useful Postmark error signals

Common Postmark/API signals:

```text
Inactive recipient
Hard bounce
Spam complaint
Invalid email address
Sender signature not found
Not allowed to send
Server token is invalid
Message stream not found
Rate limit exceeded
HTTP 401
HTTP 403
HTTP 422
HTTP 429
```

Interpretation:

| Signal | Meaning | Action |
|---|---|---|
| `HTTP 401` | Invalid token | Check Postmark token env vars |
| `HTTP 403` | Unauthorized sender/server | Check server/sender permissions |
| `HTTP 422` | Bad payload/content/recipient | Check template and recipient |
| `HTTP 429` | Rate limited | Back off and prioritize critical sends |
| `Hard bounce` | Recipient invalid/suppressed | Do not retry repeatedly |
| `Sender signature not found` | Sender domain issue | Fix sender authentication |

## Manual smoke tests

After recovery, verify:

```text
1. /api/health/ready shows postmark ok.
2. Trigger one low-risk email through normal app path.
3. Confirm NotificationDelivery row is created.
4. Confirm provider message id is recorded.
5. Confirm Postmark accepts message.
6. Confirm webhook updates delivery status.
7. Confirm no duplicate delivery rows are created.
```

Do not send real user emails for smoke testing unless you have a safe internal test user/address. Nobody asked for mystery email confetti.

## Incident notes template

```md
# Postmark incident

## Summary

## Start time

## End time

## Severity

## Detection

## Health check output

## User impact

## Affected email flows

## Affected notifications/bookings

## Provider message ids

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
missing email backlog dashboard
missing delivery failure alert
missing resend tooling
missing webhook replay test
missing bounce-rate alert
unclear support copy
template validation gap
recipient verification gap
provider config drift
```

## Related runbooks

```text
docs/runbooks/health-readiness.md
docs/runbooks/notification-backlog.md
docs/runbooks/twilio-degradation.md
docs/runbooks/postgres-outage.md
```