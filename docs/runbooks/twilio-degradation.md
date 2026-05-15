# Twilio Degradation Runbook

Use this runbook when Twilio SMS delivery, phone verification, SMS notification delivery, Twilio provider configuration, or Twilio webhook processing is unavailable, delayed, misconfigured, or returning errors.

This usually means:

```text
/api/health/ready shows checks.twilio.status = degraded
SMS verification codes are not sending
SMS notifications are delayed or missing
Twilio webhook events are failing
delivery status is not updating
Twilio configuration is missing
carrier delivery failures spike
```

Twilio is not treated as a critical readiness dependency by default because TOVIS can still serve many app flows while SMS is degraded. However, Twilio is critical for phone verification, appointment notifications, and some fallback delivery paths.

## Impact

Twilio may support:

```text
phone verification
transactional SMS notifications
booking reminders
consultation action notifications
aftercare access notifications
delivery status updates
carrier failure tracking
SMS provider webhooks
```

Expected user impact:

| Area | Impact |
|---|---|
| Phone verification | Users may be unable to verify phone numbers. |
| Signup/onboarding | Users may be blocked if phone verification is required. |
| Booking notifications | SMS updates may be delayed or missing. |
| Appointment reminders | Reminders may not arrive. |
| Consultation/aftercare links | SMS fallback links may not arrive. |
| Delivery tracking | App may not know whether SMS delivered or failed. |
| Abuse/billing | Failed-open SMS routes can create Twilio billing risk. |

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
    "twilio": {
      "name": "twilio",
      "status": "degraded",
      "message": "Twilio SMS is not configured."
    }
  }
}
```

Possible messages:

```text
Twilio SMS is not configured.
Twilio health check timed out after 3000ms.
Twilio health check failed with HTTP 401.
Twilio health check failed with HTTP 403.
Twilio health check failed with HTTP 429.
Twilio configuration is present. Live provider check is disabled.
Twilio is reachable.
```

### App symptoms

Look for:

```text
verification code send failures
verification code check failures
SMS delivery rows stuck pending
SMS delivery rows marked failed
booking reminder SMS not received
consultation action SMS not received
aftercare SMS not received
Twilio webhook route returning 400/401/500
carrier delivery errors
high SMS send volume from same IP/phone
support reports of missing SMS
```

### Critical routes likely affected

```text
/api/auth/phone/send
/api/auth/phone/verify
/api/webhooks/twilio
/api/pro/bookings/[id]/aftercare
/api/pro/bookings/[id]/consultation-proposal
/api/public/consultation/[token]/decision
notification delivery processing job
```

Route names may differ slightly by implementation. Verify the exact path before changing or replaying anything. The universe loves punishing assumptions. Very rude. Very consistent.

## Severity

| Condition | Severity |
|---|---:|
| Twilio config missing in local/dev only | Low |
| SMS delayed but email/in-app fallback works | Medium |
| Phone verification broken in production | High |
| SMS route failing open without rate limits | Critical |
| Twilio webhook failing but sends still work | Medium |
| Carrier failure spike | Medium/High |
| Twilio auth token exposed | Critical security incident |
| SMS abuse/billing spike | Critical |

## First response checklist

```text
1. Confirm /api/health/live.
2. Confirm /api/health/ready.
3. Confirm Postgres is ok.
4. Check Twilio provider status.
5. Check Twilio dashboard logs.
6. Check notification backlog for SMS channel.
7. Check auth/phone send and verify error rates.
8. Check rate-limit behavior on SMS routes.
9. Check recent deploys and env var changes.
10. Decide fallback, disable, rollback, or provider-wait strategy.
```

If Postgres is down, switch to:

```text
docs/runbooks/postgres-outage.md
```

SMS delivery recovery usually depends on the database being healthy enough to persist verification and notification state.

## Step 1 — Confirm dependency status

Run:

```bash
curl -i https://YOUR_DOMAIN/api/health/live
curl -i https://YOUR_DOMAIN/api/health/ready
```

Look at:

```text
checks.twilio.status
checks.twilio.message
checks.twilio.latencyMs
checks.postgres.status
checks.redis.status
```

If `checks.twilio.status = degraded` but provider live checks are disabled, the issue may be missing config, not a live provider outage.

## Step 2 — Check Twilio status

Check:

```text
Twilio status page
Twilio console logs
Messaging logs
Verify logs, if Twilio Verify is used
carrier error codes
webhook delivery attempts
account balance/billing
toll-free verification status
sender number status
country/region restrictions
```

Record:

```text
Twilio incident URL
affected product area
affected sender number
affected country/carrier
start time
expected recovery
affected message types
```

## Step 3 — Check environment variables

Verify production has:

```text
TWILIO_ACCOUNT_SID
TWILIO_AUTH_TOKEN
TWILIO_NOTIFICATION_FROM_NUMBER
TWILIO_TOLL_FREE_NUMBER, if used as fallback
TWILIO_FROM_NUMBER, if used as fallback
```

The health check treats Twilio as configured only when it has:

```text
account SID
auth token
sender number
```

Do not paste Twilio tokens, auth headers, or account secrets into incident notes, logs, screenshots, or support threads.

## Step 4 — Check recent deploys

Look for changes involving:

```text
lib/notifications/config.ts
SMS delivery processing
phone verification routes
Twilio webhook route
transactional SMS policy
country SMS policy
rate-limit policy
auth/phone routes
aftercare access delivery
consultation proposal delivery
runtime flags for notifications
```

Rollback is appropriate when:

```text
Twilio provider is healthy
failures started immediately after deploy
SMS config/delivery/webhook code changed
phone verification code changed
rate-limit behavior changed
env vars are unchanged and valid
```

Rollback is not enough when:

```text
Twilio provider is degraded
auth token was revoked
sender number is blocked or unverified
carrier filtering is rejecting messages
account balance/billing is blocking sends
Postgres is down
```

## Step 5 — Check phone verification

Phone verification is higher-risk than normal SMS notification delivery because it can block signup/login/onboarding.

Check:

```text
/api/auth/phone/send
/api/auth/phone/verify
verification token creation
verification code expiry
rate-limit decisions
phone country policy
Twilio send result
user-facing errors
```

Look for:

```text
many sends to same phone
many sends from same IP
many failed verification attempts
codes sent but not received
codes expired
codes accepted but phone not marked verified
```

Immediate mitigation:

```text
1. If SMS sends are failing broadly, show clear retry copy.
2. If abuse is suspected, fail closed.
3. Temporarily disable phone-code send if billing abuse is active.
4. Do not bypass phone verification manually unless there is an approved support/admin flow.
```

Suggested user copy:

```text
Phone verification is temporarily unavailable. Please try again shortly.
```

## Step 6 — Check SMS rate limiting

SMS endpoints must be protected. If Redis/rate limiting is degraded, treat SMS sends as high risk.

Check:

```text
per-IP send limits
per-phone send limits
per-user send limits
verification attempt limits
rate-limit logs
429 response volume
Twilio send volume
billing dashboard
```

If rate limiting is unavailable:

```text
1. Fail closed for SMS send routes.
2. Temporarily disable SMS send if needed.
3. Add WAF/IP blocking for obvious abuse.
4. Monitor Twilio billing and send volume.
```

Do not let phone send routes fail open. That is how a bug becomes an invoice with teeth.

## Step 7 — Check SMS notification backlog

SMS notification delivery may be represented through notification dispatch/delivery rows.

Check for:

```text
SMS deliveries stuck pending
SMS deliveries retrying repeatedly
SMS deliveries marked failed
oldest pending SMS delivery
delivery attempts count
provider message SID presence
last provider error code/message
```

Prioritize notification types:

```text
account/security
phone verification
booking status changes
consultation action links
aftercare access
appointment reminders
```

If backlog is growing:

```text
1. Check Twilio status.
2. Check worker/job processing status.
3. Check Postgres health.
4. Check rate limiting/provider throttle.
5. Do not blindly retry everything if Twilio is rejecting messages.
```

Use:

```text
docs/runbooks/notification-backlog.md
```

if queue/backlog behavior is the main symptom.

## Step 8 — Check Twilio webhook processing

Twilio webhooks may report delivery status updates.

Check webhook route:

```text
/api/webhooks/twilio
```

Look for:

```text
HTTP 2xx response
signature validation errors, if used
event parsing errors
unknown provider message SID
delivery row not found
duplicate webhook event behavior
failed DB writes
```

If webhooks fail but sends work:

```text
1. Users may still receive SMS.
2. Internal delivery status may be stale.
3. Do not resend just because webhook status is missing.
4. Reconcile provider message SIDs after recovery.
```

## Step 9 — Carrier filtering / sender number issues

Signs:

```text
messages accepted by Twilio but not delivered
specific carrier failures
specific region/country failures
toll-free verification issue
A2P/10DLC compliance issue
high error rate with provider codes
```

Immediate actions:

```text
1. Check Twilio error codes.
2. Check whether failures are carrier-specific.
3. Check sender number compliance/verification.
4. Pause non-critical SMS if reputation/compliance is affected.
5. Use email/in-app fallback where safe.
6. Escalate to Twilio support if widespread.
```

Do not keep retrying carrier-filtered messages aggressively. It will not charm the carrier into liking you.

## Step 10 — Provider rate limiting or quota issue

If Twilio returns 429, throttling, or billing-limit errors:

```text
1. Stop aggressive retries.
2. Back off SMS delivery worker.
3. Prioritize verification/security-critical messages.
4. Delay non-critical reminders.
5. Check account balance/usage limits.
6. Resume gradually.
```

Critical SMS:

```text
phone verification
account/security
active booking changes
consultation action
```

Lower-priority SMS:

```text
non-urgent reminders
marketing, if any
digest-style notifications
```

## Step 11 — Aftercare and consultation SMS links

If SMS fallback sends secure links:

Check:

```text
ClientActionToken kind
token expiry
single-use behavior
recipient verification
NotificationDelivery channel SMS
delivery status
provider message SID
```

Safe mitigation:

```text
1. Confirm secure ClientActionToken exists.
2. Confirm recipient phone is verified/allowed.
3. Resend through normal delivery path if idempotent/safe.
4. Use email or in-app fallback where allowed.
5. Do not paste raw secure links into unapproved channels.
```

## Step 12 — Customer-facing behavior

For clients:

```text
SMS delivery is temporarily delayed. Please check the app or email for updates if available.
```

For phone verification:

```text
Phone verification is temporarily unavailable. Please try again shortly.
```

For Pros:

```text
SMS notifications may be delayed. Please use the app dashboard for the latest booking/session updates.
```

For support:

```text
Do not manually verify phone numbers without approved process.
Do not create duplicate bookings.
Do not paste secure action links into unapproved channels.
Do not resend SMS repeatedly if Twilio/carriers are rejecting messages.
```

## Step 13 — Recovery validation

Before resolving, confirm:

```text
/api/health/live returns ok
/api/health/ready returns ok or twilio no longer degraded
Twilio dashboard shows accepted sends
SMS delivery route works
phone verification send works
phone verification verify works
Twilio webhook route returns 2xx
SMS notification backlog is draining
carrier error rate is normal
billing/send volume is normal
no duplicate sends occurred
```

## Post-recovery checks

Check incident window for:

```text
failed SMS deliveries
pending SMS deliveries older than threshold
phone verification failures
verification sends without successful verification
duplicate SMS sends
SMS abuse attempts
billing spike
webhook events received but not processed
aftercare/consultation links not delivered by SMS
```

Create repair or resend tasks where needed.

## Resend guidance

Only resend SMS when:

```text
the original delivery failed or expired
the action token is still valid or can be safely regenerated
the resend path is idempotent
the recipient phone is verified/allowed
support has confirmed user impact, if manual
```

Do not resend SMS when:

```text
Twilio accepted the message and status is unknown
carrier filtering is active
recipient opted out
token is expired and cannot be regenerated safely
delivery was already completed
rate limit is exceeded
```

## Rollback guidance

Rollback app deploy if:

```text
Twilio provider is healthy
failures started after deploy
SMS delivery/config/webhook code changed
phone verification route changed
rate-limit behavior changed
env vars are unchanged and valid
```

Do not rollback if:

```text
provider is degraded
auth token was revoked outside code
sender number was blocked
carrier filtering is external
account billing/usage limit is the cause
Postgres is down
```

If sender config changed:

```text
1. Confirm sender number in Twilio.
2. Confirm toll-free/A2P compliance status.
3. Confirm env var matches approved sender.
4. Deploy corrected env/config.
5. Send one test SMS through normal app path.
6. Verify delivery status webhook.
```

## Escalation

Escalate immediately when:

```text
phone verification fails broadly
SMS send routes fail open without rate limiting
SMS abuse/billing spike is detected
Twilio auth token may be exposed
carrier filtering affects many users
active booking notifications fail broadly
SMS backlog grows and does not drain
```

Escalate to:

```text
on-call engineer
security/abuse owner
notification owner
support lead
Twilio support if provider/dashboard issue
```

## Logs to collect

Collect:

```text
timestamp range
deployment id
request ids
notification dispatch ids
notification delivery ids
provider message SIDs
Twilio error codes
SMS channel status
webhook event ids
affected booking ids
affected client/pro ids
rate-limit decisions
send volume
error messages
Twilio dashboard status
```

Do not collect or paste:

```text
TWILIO_AUTH_TOKEN
Authorization headers
full phone numbers unless necessary and redacted
verification codes
secure action tokens
auth cookies
JWTs
signed media URLs
```

## Useful Twilio error signals

Common Twilio/API signals:

```text
HTTP 401
HTTP 403
HTTP 429
Authenticate
Permission denied
The From phone number is not a valid SMS-capable inbound phone number
Message cannot be sent with the current combination of To and/or From parameters
Carrier violation
Unreachable destination handset
Unknown destination handset
Landline or unreachable carrier
Queue overflow
Rate limit exceeded
```

Interpretation:

| Signal | Meaning | Action |
|---|---|---|
| `HTTP 401` | Bad Account SID/Auth Token | Check Twilio env vars/key rotation |
| `HTTP 403` | Permission/account issue | Check account status/permissions |
| `HTTP 429` | Rate limited | Back off and prioritize critical SMS |
| Invalid `From` | Sender number problem | Check sender env/config |
| Carrier violation | Filtering/compliance issue | Pause retries and review content/compliance |
| Unreachable handset | Recipient/device issue | Do not retry aggressively |
| Queue overflow | Throughput issue | Back off or increase throughput |

## Manual smoke tests

After recovery, verify:

```text
1. /api/health/ready shows twilio ok.
2. Send one internal test SMS through normal app path.
3. Confirm NotificationDelivery row is created.
4. Confirm provider message SID is recorded.
5. Confirm Twilio accepts the message.
6. Confirm webhook updates delivery status.
7. Confirm phone verification send works.
8. Confirm phone verification verify works.
9. Confirm no duplicate SMS deliveries are created.
```

Use internal test numbers only. Do not test with real users unless support has coordinated it. Nobody needs a random “your appointment changed” text because we felt adventurous.

## Incident notes template

```md
# Twilio incident

## Summary

## Start time

## End time

## Severity

## Detection

## Health check output

## User impact

## Affected SMS/verification flows

## Affected notifications/bookings

## Provider message SIDs

## Twilio error codes

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
missing SMS backlog dashboard
missing delivery failure alert
missing resend tooling
missing webhook replay test
missing carrier-error alert
missing rate-limit fail-closed test
unclear phone verification copy
provider config drift
sender compliance issue
```

## Related runbooks

```text
docs/runbooks/health-readiness.md
docs/runbooks/notification-backlog.md
docs/runbooks/postmark-degradation.md
docs/runbooks/redis-outage.md
docs/runbooks/postgres-outage.md
```