# Launch Dashboard Checklist

Use this checklist to build the production launch dashboard for TOVIS.

The dashboard should answer one question fast:

```text
Can TOVIS safely serve users right now?
```

A good dashboard should make failures obvious without requiring someone to dig through logs like a raccoon in a dumpster. Logs are useful. Dashboards should get you pointed in the right direction first.

## Dashboard goals

The launch dashboard should show:

```text
app health
dependency readiness
booking funnel health
media/photo upload health
notification health
payment/webhook health
background job health
rate limiting/abuse signals
error rates
latency
backlogs
```

## Required dashboard sections

```text
1. Health and readiness
2. Core booking funnel
3. Pro session lifecycle
4. Media/photo uploads
5. Payments and Stripe webhooks
6. Notifications
7. Background jobs and cron
8. Auth, verification, and rate limiting
9. Infrastructure dependencies
10. Error budget / SLO summary
```

---

# 1. Health and readiness

## Panels

| Panel | Query/source | Healthy target | Alert threshold |
|---|---|---:|---:|
| `/api/health/live` status | uptime monitor / HTTP check | `200` | non-200 for 1 minute |
| `/api/health/ready` overall status | uptime monitor / HTTP check | `ok` | `down` for 1 minute, `degraded` for 5 minutes |
| `/api/health/ready` duration | health endpoint response | p95 `< 2s` | p95 `> 2s` for 5 minutes |
| Postgres readiness | `checks.postgres.status` | `ok` | `down` once |
| Redis readiness | `checks.redis.status` | `ok` | `degraded` for 5 minutes |
| Storage readiness | `checks.storage.status` | `ok` | `degraded` for 5 minutes |
| Stripe readiness | `checks.stripe.status` | `ok` | `degraded` for 5 minutes |
| Postmark readiness | `checks.postmark.status` | `ok` | `degraded` for 10 minutes |
| Twilio readiness | `checks.twilio.status` | `ok` | `degraded` for 10 minutes |

## Notes

`/api/health/live` only proves the app process is alive.

`/api/health/ready` proves dependencies are reachable enough to serve traffic.

Do not use `/live` alone as the launch gate. That would be like checking if the car horn works and calling the engine fine. Charming. Useless.

---

# 2. Core booking funnel

## Panels

| Panel | Query/source | Healthy target | Alert threshold |
|---|---|---:|---:|
| Hold creation success rate | `/api/holds` | `> 99.5%` | `< 99%` for 5 minutes |
| Booking finalize success rate | `/api/bookings/finalize` | `> 99.5%` | `< 99%` for 5 minutes |
| Booking finalize p95 latency | `/api/bookings/finalize` | `< 700ms` | `> 1.5s` for 5 minutes |
| Booking finalize 5xx rate | route metrics | `< 0.1%` | `> 1%` for 5 minutes |
| Hold expiration count | BookingHold cleanup metrics | stable baseline | sudden spike |
| Hold-to-finalize conversion | funnel metric | stable baseline | sudden drop |
| Double-booking detection | DB/job/query metric | `0` | any confirmed overlap |
| Booking cancel success rate | `/api/bookings/[id]/cancel` | `> 99%` | `< 98%` for 5 minutes |
| Booking reschedule success rate | `/api/bookings/[id]/reschedule` | `> 99%` | `< 98%` for 5 minutes |

## Suggested dimensions

```text
professionalId
locationType
serviceId
route
statusCode
errorCode
bookingSource
client/pro created
```

## Notes

The booking funnel is the money path. If booking finalize breaks, launch is functionally broken even if every pretty page still loads.

---

# 3. Pro session lifecycle

## Panels

| Panel | Query/source | Healthy target | Alert threshold |
|---|---|---:|---:|
| Session start success rate | `/api/pro/bookings/[id]/session/start` | `> 99.5%` | `< 99%` for 5 minutes |
| Consultation proposal send success | consultation proposal route | `> 99%` | `< 98%` for 5 minutes |
| Consultation approval latency | proposal sent → approved | p95 `< 5 min` | sudden spike |
| Bookings stuck in `CONSULTATION_PENDING_CLIENT` | DB query | stable/low | sustained spike |
| Bookings stuck in `BEFORE_PHOTOS` | DB query | stable/low | sustained spike |
| Bookings stuck in `AFTER_PHOTOS` | DB query | stable/low | sustained spike |
| Closeout blocker count | backend completion blockers | stable baseline | sudden spike |
| Lifecycle transition rejection count | lifecycle/writeBoundary logs | low and explainable | spike |
| Direct `DONE` rejection count | lifecycle logs/tests | `0` from UI | any UI-caused spike |

## Suggested DB slices

```text
Booking.status
Booking.sessionStep
Booking.updatedAt
Booking.startedAt
Booking.finishedAt
completionBlockers
professionalId
```

## Notes

This section tells you whether appointments can actually move through the live session flow.

If bookings pile up in `AFTER_PHOTOS`, check:

```text
aftercare
payment
checkout
AFTER photo media
closeout blocker UI
```

---

# 4. Media/photo uploads

## Panels

| Panel | Query/source | Healthy target | Alert threshold |
|---|---|---:|---:|
| Upload token creation success | `/api/pro/uploads` | `> 99.5%` | `< 99%` for 5 minutes |
| Media metadata create success | `/api/pro/bookings/[id]/media` | `> 99.5%` | `< 99%` for 5 minutes |
| Before-photo upload success | media route by phase `BEFORE` | `> 99%` | `< 98%` for 5 minutes |
| After-photo upload success | media route by phase `AFTER` | `> 99%` | `< 98%` for 5 minutes |
| Media metadata p95 latency | media route | `< 600ms` | `> 1.5s` for 5 minutes |
| Storage object missing errors | media route error code | near `0` | spike |
| Signed URL generation success | `/api/media/url` or render path | `> 99.5%` | `< 99%` for 5 minutes |
| Orphaned media count | reconciliation job/report | near `0` | increasing trend |
| Storage readiness | health check | `ok` | `degraded` for 5 minutes |

## Suggested dimensions

```text
phase
bucket
route
professionalId
bookingId
mediaType
errorCode
```

## Notes

Photo upload is not just a nice feature. It affects booking closeout. If AFTER photos fail, bookings may get stuck.

---

# 5. Payments and Stripe webhooks

## Panels

| Panel | Query/source | Healthy target | Alert threshold |
|---|---|---:|---:|
| Stripe readiness | health check | `ok` | `degraded` for 5 minutes |
| Checkout session creation success | checkout route | `> 99%` | `< 98%` for 5 minutes |
| Checkout session p95 latency | checkout route | `< 1s` | `> 2s` for 5 minutes |
| Stripe webhook 2xx rate | `/api/webhooks/stripe` | `> 99.9%` | `< 99%` for 5 minutes |
| Stripe webhook processing lag | webhook received → processed | p95 `< 10s` | `> 60s` for 5 minutes |
| Failed Stripe webhook count | `StripeWebhookEvent` | `0` or low | sustained increase |
| Duplicate webhook side effects | audit/idempotency metric | `0` | any occurrence |
| Bookings stuck payment required | DB query | stable/low | sudden spike |
| Checkout status mismatch | Booking vs Stripe state | `0` | any confirmed mismatch |

## Suggested dimensions

```text
stripeEventType
stripeEventId
bookingId
checkoutStatus
stripePaymentStatus
professionalId
route
statusCode
```

## Notes

Never use dashboard numbers alone to manually mark payments. Stripe dashboard + app state + idempotent webhook behavior must agree. Money deserves receipts. Annoying, but less annoying than charge disputes.

---

# 6. Notifications

## Panels

| Panel | Query/source | Healthy target | Alert threshold |
|---|---|---:|---:|
| Pending notification delivery count | `NotificationDelivery` | stable baseline | increasing for 10 minutes |
| Oldest pending delivery age | `NotificationDelivery` | `< 10 min` | `> 10 min` |
| Notification processor success rate | job route/cron | `> 99%` | `< 98%` for 10 minutes |
| Email delivery success rate | Postmark channel | `> 99%` | `< 98%` for 10 minutes |
| SMS delivery success rate | Twilio channel | `> 98%` | `< 95%` for 10 minutes |
| Postmark readiness | health check | `ok` | `degraded` for 10 minutes |
| Twilio readiness | health check | `ok` | `degraded` for 10 minutes |
| Provider webhook success | Postmark/Twilio webhook routes | `> 99%` | `< 98%` for 10 minutes |
| Max-attempt delivery count | delivery rows | near `0` | spike |
| Duplicate notification sourceKey conflicts | dispatch metric | `0` | any unexplained spike |

## Suggested dimensions

```text
channel
provider
sourceType
sourceKey
status
attempts
lastError
professionalId
clientId
bookingId
```

## Notes

Critical notification types need separate panels:

```text
consultation action links
aftercare access links
booking cancellation/reschedule
payment-required messages
verification/security messages
```

Do not hide those inside one generic “notifications” graph. That’s how you get a green dashboard and angry humans.

---

# 7. Background jobs and cron

## Panels

| Panel | Query/source | Healthy target | Alert threshold |
|---|---|---:|---:|
| Hold cleanup last success | cron/job logs | within expected schedule | missed 2 runs |
| Notification processor last success | cron/job logs | within expected schedule | missed 2 runs |
| Stripe orphan recovery last success | cron/job logs | within expected schedule | missed 2 runs |
| Reminder job last success | cron/job logs | within expected schedule | missed 2 runs |
| Looks/social job last success | cron/job logs | within expected schedule | missed expected schedule |
| Job duration p95 | job logs | below route timeout | near timeout |
| Job 5xx count | job route metrics | `0` | any sustained failure |
| Job auth failures | internal job routes | `0` | any occurrence |
| Backlog after job run | queue/table metrics | decreasing | increasing |

## Suggested dimensions

```text
jobName
route
statusCode
durationMs
recordsClaimed
recordsProcessed
recordsFailed
deploymentId
```

## Notes

A job can “run” and still do nothing useful. Track records processed, not just HTTP 200s.

---

# 8. Auth, verification, and rate limiting

## Panels

| Panel | Query/source | Healthy target | Alert threshold |
|---|---|---:|---:|
| Register success rate | `/api/auth/register` | stable baseline | sudden drop |
| Login success rate | `/api/auth/login` | stable baseline | sudden drop |
| Phone send success rate | `/api/auth/phone/send` | `> 98%` | `< 95%` for 5 minutes |
| Phone verify success rate | `/api/auth/phone/verify` | stable baseline | sudden drop |
| SMS send count by IP/phone | rate-limit logs | normal baseline | spike |
| 429 rate by route | rate-limit logs | normal baseline | spike/drop to zero during attack |
| Auth 5xx rate | auth routes | `< 0.1%` | `> 1%` |
| Twilio readiness | health check | `ok` | `degraded` for 10 minutes |
| Redis readiness | health check | `ok` | `degraded` for 5 minutes |

## Suggested dimensions

```text
route
ipHash
userId
phoneHash
statusCode
rateLimitBucket
rateLimitDecision
```

## Notes

For abuse-sensitive routes, “no 429s” is not always good. It can mean limits are broken. The dashboard should show request volume and limit decisions together.

---

# 9. Infrastructure dependencies

## Panels

| Panel | Source | Healthy target | Alert threshold |
|---|---|---:|---:|
| Postgres CPU/memory/connections | provider dashboard | normal baseline | sustained high |
| Postgres query latency | DB/APM | normal baseline | p95 spike |
| Postgres pool exhaustion | logs/provider | `0` | any sustained |
| Redis latency/errors | Upstash/Vercel KV | normal baseline | spike |
| Supabase Storage errors | Supabase dashboard | low | spike |
| Vercel function errors | Vercel/Sentry | low | spike |
| Vercel cold starts/duration | Vercel | normal baseline | spike |
| Sentry error rate | Sentry | low | spike |
| Sentry top errors | Sentry | known/explainable | new top error |
| Deployment marker | Vercel/GitHub | visible | every deploy |

## Notes

Every dashboard should show deployment markers. If errors start three minutes after deploy, you want that to be obvious instead of doing a little séance with git history.

---

# 10. Error budget / SLO summary

## Proposed launch SLO panels

| SLI | Target |
|---|---:|
| Booking finalize success rate | `99.5%` |
| Booking finalize p95 latency | `< 700ms` |
| Availability lookup p95 latency | `< 300ms cached`, `< 900ms cold` |
| Media metadata create success rate | `99.5%` |
| Media metadata p95 latency | `< 600ms` |
| Checkout session creation success rate | `99%` |
| Stripe webhook processing p95 | `< 10s` |
| Notification delivery processor freshness | oldest pending `< 10 min` |
| Health ready status | `ok` |
| Double-booking confirmed overlaps | `0` |
| Duplicate payment side effects | `0` |
| Private media exposure incidents | `0` |

## Dashboard summary row

At the top of the dashboard, include:

```text
Live: ok/degraded/down
Ready: ok/degraded/down
Booking finalize: ok/degraded/down
Media upload: ok/degraded/down
Payments: ok/degraded/down
Notifications: ok/degraded/down
Active incidents: count
Latest deploy: commit/time
```

---

# Alert routing

## Page immediately

```text
/api/health/live non-200 for 1 minute
/api/health/ready down for 1 minute
Postgres down
booking finalize success < 99% for 5 minutes
confirmed double booking
duplicate payment side effect
private media exposure suspected
Stripe webhook failures sustained
active appointment media upload failure spike
```

## Alert but do not page immediately

```text
ready degraded for 5 minutes
Redis degraded for 5 minutes
Storage degraded for 5 minutes
Stripe degraded for 5 minutes
Postmark degraded for 10 minutes
Twilio degraded for 10 minutes
notification backlog oldest pending > 10 minutes
media upload success < 99% for 5 minutes
rate-limit anomaly
```

## Ticket / follow-up

```text
slow trend in p95 latency
non-critical reminder backlog
feature flag cleanup
dashboard panel missing data
runbook needs clarification
low-volume provider warning
```

---

# Required dashboard filters

Every dashboard should support filtering by:

```text
environment
deployment id
route
status code
professional id
booking id
client id
provider
channel
location type
booking source
```

For privacy, use hashed or internal IDs where appropriate. Do not display phone numbers, emails, client addresses, signed URLs, or raw tokens.

---

# Privacy and security rules

Dashboards must not expose:

```text
JWTs
auth cookies
provider secrets
Stripe secret keys
webhook secrets
Twilio auth tokens
Postmark tokens
Supabase service-role keys
signed media URLs
raw ClientActionToken values
verification codes
full phone numbers
full email addresses
client addresses
private media paths unless intentionally safe
```

Use:

```text
userId
clientId
professionalId
bookingId
notificationDeliveryId
providerMessageId
hashed phone/email where needed
```

---

# Manual launch watch checklist

During launch, watch these panels continuously:

```text
/api/health/ready
booking finalize success
booking finalize latency
hold creation success
media upload success
Stripe webhook success
notification backlog
Postmark/Twilio health
auth/SMS rate-limit decisions
Sentry error rate
latest deploy marker
```

First 30 minutes after launch:

```text
check every 5 minutes
```

First 24 hours:

```text
check hourly during active windows
```

First week:

```text
daily review of incidents, error budget, and support tickets
```

---

# Dashboard ownership

| Dashboard section | Owner |
|---|---|
| Health/readiness | Engineering |
| Booking funnel | Engineering/Product |
| Session lifecycle | Engineering/Product |
| Media uploads | Engineering |
| Payments/Stripe | Engineering/Ops |
| Notifications | Engineering/Ops |
| Auth/rate limits | Engineering/Security |
| Infrastructure | Engineering |
| Support/user impact | Support/Product |

---

# Minimum launch dashboard definition of done

Do not mark the launch dashboard ready until:

```text
[ ] /api/health/live is monitored.
[ ] /api/health/ready is monitored.
[ ] Dependency checks are visible separately.
[ ] Booking finalize success/latency is visible.
[ ] Hold creation success/latency is visible.
[ ] Media upload success/latency is visible.
[ ] Stripe webhook success/lag is visible.
[ ] Notification backlog is visible.
[ ] Postmark/Twilio delivery health is visible.
[ ] Auth/SMS rate-limit decisions are visible.
[ ] Sentry error rate is visible.
[ ] Deployment markers are visible.
[ ] Alerts are configured.
[ ] Runbooks are linked from alert descriptions.
[ ] No sensitive user/provider data is displayed.
```

---

# Related runbooks

```text
docs/runbooks/health-readiness.md
docs/runbooks/postgres-outage.md
docs/runbooks/redis-outage.md
docs/runbooks/supabase-storage-outage.md
docs/runbooks/stripe-degradation.md
docs/runbooks/postmark-degradation.md
docs/runbooks/twilio-degradation.md
docs/runbooks/notification-backlog.md
```