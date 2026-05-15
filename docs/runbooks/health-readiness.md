# Health Readiness Runbook

Use this runbook when:

```text
GET /api/health/ready
```

returns:

```text
degraded
down
HTTP 503
unexpected missing checks
slow responses
```

This runbook covers the readiness endpoint itself and helps route the incident to the correct dependency-specific runbook.

## Purpose

`/api/health/ready` answers:

```text
Can TOVIS safely serve production traffic right now?
```

It checks:

```text
Postgres
Redis
Supabase Storage
Stripe
Postmark
Twilio
```

It does **not** mean every product feature is perfect. It means the core dependencies are reachable enough for the app to operate.

## Related endpoints

```text
GET /api/health/live
GET /api/health/ready
GET /api/health
```

`/api/health/live` checks only whether the app process is alive.

`/api/health/ready` checks app dependencies.

`/api/health` is a compatibility alias for readiness behavior.

## Expected healthy response

```json
{
  "ok": true,
  "service": "tovis-app",
  "endpoint": "ready",
  "status": "ok",
  "timestamp": "2026-05-15T12:00:00.000Z",
  "durationMs": 25,
  "checks": {
    "postgres": {
      "name": "postgres",
      "status": "ok",
      "latencyMs": 4,
      "checkedAt": "2026-05-15T12:00:00.000Z",
      "message": "Postgres is reachable."
    },
    "redis": {
      "name": "redis",
      "status": "ok",
      "latencyMs": 3,
      "checkedAt": "2026-05-15T12:00:00.000Z",
      "message": "Redis is reachable."
    },
    "storage": {
      "name": "storage",
      "status": "ok",
      "latencyMs": 5,
      "checkedAt": "2026-05-15T12:00:00.000Z",
      "message": "Supabase Storage buckets are reachable."
    },
    "stripe": {
      "name": "stripe",
      "status": "ok",
      "latencyMs": 1,
      "checkedAt": "2026-05-15T12:00:00.000Z",
      "message": "Stripe configuration is present. Live provider check is disabled."
    },
    "postmark": {
      "name": "postmark",
      "status": "ok",
      "latencyMs": 2,
      "checkedAt": "2026-05-15T12:00:00.000Z",
      "message": "Postmark configuration is present. Live provider check is disabled."
    },
    "twilio": {
      "name": "twilio",
      "status": "ok",
      "latencyMs": 3,
      "checkedAt": "2026-05-15T12:00:00.000Z",
      "message": "Twilio configuration is present. Live provider check is disabled."
    }
  }
}
```

## Severity guide

| Readiness status | HTTP status | Severity | Meaning |
|---|---:|---:|---|
| `ok` | `200` | None | App dependencies are reachable. |
| `degraded` | `200` by default | Medium | One or more non-critical dependencies are failing or misconfigured. |
| `degraded` | `503` if configured | Medium/High | Same as degraded, but deploy/runtime policy treats degraded as not ready. |
| `down` | `503` | High/Critical | A critical dependency is down. Usually Postgres. |

## Dependency impact

| Check | Failure status | User-facing impact | Runbook |
|---|---:|---|---|
| `postgres` | `down` | Most app flows fail. Booking, auth, profiles, and dashboards may be unavailable. | `postgres-outage.md` |
| `redis` | `degraded` | Runtime flags, rate limiting, cache, and notification versioning may degrade. | `redis-outage.md` |
| `storage` | `degraded` | Photo upload, media lookup, signed URLs, and before/after images may fail. | `supabase-storage-outage.md` |
| `stripe` | `degraded` | Checkout, payment status, Connect onboarding, and webhooks may degrade. | `stripe-degradation.md` |
| `postmark` | `degraded` | Email delivery and email delivery-status tracking may degrade. | `postmark-degradation.md` |
| `twilio` | `degraded` | SMS delivery, phone verification, and SMS delivery-status tracking may degrade. | `twilio-degradation.md` |

## First response checklist

When readiness is not `ok`, do this first:

```text
1. Check /api/health/live.
2. Check /api/health/ready.
3. Identify which dependency check is degraded or down.
4. Open the dependency-specific runbook.
5. Check recent deploys.
6. Check provider status pages.
7. Check dashboards and logs.
8. Decide whether to rollback, disable a feature, or degrade gracefully.
9. Record the incident timeline.
```

## Step 1 — Confirm app liveness

Run:

```bash
curl -sS https://YOUR_DOMAIN/api/health/live
```

Expected:

```json
{
  "ok": true,
  "service": "tovis-app",
  "endpoint": "live",
  "status": "ok"
}
```

### If live is down

This is not a dependency-specific problem. The app process itself is unhealthy.

Check:

```text
Vercel deployment status
recent build/deploy failures
environment variable load errors
runtime exceptions
global middleware failures
Next.js route startup errors
```

Immediate action:

```text
1. Roll back the latest deploy if the outage started after a deploy.
2. Check Vercel function logs.
3. Check Sentry for startup/runtime exceptions.
4. Do not debug provider integrations first. The app is not alive enough to ask providers anything.
```

## Step 2 — Check readiness

Run:

```bash
curl -sS https://YOUR_DOMAIN/api/health/ready
```

Look at:

```text
status
checks.postgres.status
checks.redis.status
checks.storage.status
checks.stripe.status
checks.postmark.status
checks.twilio.status
durationMs
per-check latencyMs
message fields
```

## Step 3 — Route by failed check

### Postgres is `down`

Impact is high.

Open:

```text
docs/runbooks/postgres-outage.md
```

Common symptoms:

```text
login failures
booking creation failures
profile pages failing
admin dashboards failing
Prisma errors
timeouts
HTTP 500s across many routes
```

Immediate mitigation:

```text
1. Check Supabase/Postgres status.
2. Check DATABASE_URL / DATABASE_URL_READ.
3. Check connection pool exhaustion.
4. Check recent schema migrations.
5. Roll back recent DB-affecting deploy if needed.
```

Do not continue with provider-specific runbooks until Postgres is stable. Stripe can’t save you if the database is face-down in a puddle.

### Redis is `degraded`

Open:

```text
docs/runbooks/redis-outage.md
```

Common symptoms:

```text
runtime flags fail
rate limits fail
cache misses increase
notification versioning fails
realtime/polling state may lag
```

Immediate mitigation:

```text
1. Check Upstash/Vercel KV status.
2. Check UPSTASH_REDIS_REST_URL and token env vars.
3. Confirm rate-limit behavior for auth/SMS routes.
4. Decide whether affected features fail open or fail closed.
```

Auth/SMS abuse routes should fail closed if Redis is unavailable. Otherwise Twilio billing can become a tiny financial jump scare.

### Storage is `degraded`

Open:

```text
docs/runbooks/supabase-storage-outage.md
```

Common symptoms:

```text
before photo upload fails
after photo upload fails
media metadata creation fails
signed image URLs fail
client/pro image galleries fail
```

Immediate mitigation:

```text
1. Check Supabase Storage status.
2. Verify media-private and media-public buckets exist.
3. Confirm service-role key is valid.
4. Check recent storage policy migrations.
5. Temporarily pause photo-required workflows only if necessary.
```

### Stripe is `degraded`

Open:

```text
docs/runbooks/stripe-degradation.md
```

Common symptoms:

```text
checkout session creation fails
payment status does not update
webhook backlog increases
professional onboarding/payment settings fail
bookings stuck waiting for payment
```

Immediate mitigation:

```text
1. Check Stripe status.
2. Check STRIPE_SECRET_KEY and webhook secret env vars.
3. Check Stripe webhook delivery dashboard.
4. Verify webhook idempotency and replay safety before replaying events.
```

### Postmark is `degraded`

Open:

```text
docs/runbooks/postmark-degradation.md
```

Common symptoms:

```text
emails not sent
aftercare emails delayed
verification emails delayed
delivery status not updating
bounce events not processed
```

Immediate mitigation:

```text
1. Check Postmark status.
2. Check POSTMARK_SERVER_TOKEN and from-email env vars.
3. Check bounce/spam spikes.
4. Use in-app notifications/SMS fallback where safe.
```

### Twilio is `degraded`

Open:

```text
docs/runbooks/twilio-degradation.md
```

Common symptoms:

```text
SMS verification fails
client/pro SMS notifications delayed
carrier delivery failures
Twilio webhook failures
phone-based onboarding blocked
```

Immediate mitigation:

```text
1. Check Twilio status.
2. Check TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and sender number env vars.
3. Check country/SMS policy.
4. Use email/in-app fallback where safe.
```

## Step 4 — Check recent deploys

Check whether the readiness failure started after:

```text
new deploy
environment variable change
database migration
Supabase policy migration
Stripe webhook change
notification provider config change
runtime flag change
```

If yes, compare:

```text
last known good commit
current commit
changed env vars
changed provider settings
changed migrations
```

Rollback is appropriate when:

```text
the failure started immediately after deploy
the failure affects critical flows
the cause is not obvious within a few minutes
there is a known good previous deploy
```

Rollback is not enough when:

```text
external provider is down
database is degraded outside app code
secrets were revoked
storage policies were changed outside repo
```

## Step 5 — Check dashboards

Use the launch dashboard checklist:

```text
docs/launch-readiness/dashboard-checklist.md
```

Minimum dashboard panels to inspect:

```text
readiness status
readiness durationMs
Postgres health check latency
Redis health check latency
storage health check latency
Stripe health check status
Postmark health check status
Twilio health check status
route error rate
booking finalize success rate
media upload success rate
notification backlog
Stripe webhook lag
```

## Step 6 — Check logs

Search logs by:

```text
requestId
route
health check name
dependency name
error message
timestamp
deployment id
```

Useful route filters:

```text
/api/health/live
/api/health/ready
/api/health
/api/bookings/finalize
/api/pro/bookings
/api/pro/bookings/[id]/media
/api/pro/bookings/[id]/aftercare
/api/webhooks/stripe
/api/webhooks/postmark
/api/webhooks/twilio
```

## Step 7 — Decide customer impact

Use this table:

| Failed check | Customer impact |
|---|---|
| `postgres` | Broad outage. Most user actions may fail. |
| `redis` | Some cache, rate limit, runtime flag, and notification freshness features degrade. |
| `storage` | Photo/media workflows fail or degrade. Booking may continue until media is required. |
| `stripe` | Payment and checkout flows degrade. Booking closeout may get stuck. |
| `postmark` | Email notifications degrade. In-app/SMS may still work. |
| `twilio` | SMS notifications and phone verification degrade. Email/in-app may still work. |

## Step 8 — Mitigate safely

Possible mitigations:

```text
rollback latest deploy
disable affected feature with runtime flag
pause provider-dependent workflow
fall back to in-app notification
retry queued jobs
replay provider webhooks
show maintenance copy
temporarily hide affected call-to-action
```

Do not:

```text
manually mark payments paid without Stripe confirmation
manually complete bookings without closeout criteria
delete notification rows to "clear" backlog
make private media public
disable auth/rate limits globally
expose provider secrets in logs or incident notes
```

Yes, those are obvious. Also yes, people do obvious bad things at 2:00 AM. We document it so 2:00 AM brain has guardrails.

## Step 9 — Recovery checks

Before resolving the incident, confirm:

```text
/api/health/live returns ok
/api/health/ready returns ok
failed dependency-specific runbook recovery checks pass
route error rate returns to baseline
backlogs are draining
webhook retries are processed
no duplicate side effects were created
support/customer-facing symptoms are gone
```

For degraded provider incidents, readiness may return `ok` before delayed jobs fully recover. Always check backlog metrics too.

## Step 10 — Post-incident cleanup

Create follow-up tasks for:

```text
missing alerts
missing dashboards
missing logs
unclear runbook steps
manual actions taken
data repairs needed
customer support follow-up
tests that would have caught the issue
provider configuration improvements
```

## Alert thresholds

Recommended initial alerts:

| Signal | Threshold | Action |
|---|---:|---|
| `/api/health/live` non-200 | 1 minute | Page |
| `/api/health/ready` `down` | 1 minute | Page |
| `/api/health/ready` `degraded` | 5 minutes | Alert |
| Postgres check `down` | immediate | Page |
| Redis check `degraded` | 5 minutes | Alert |
| Storage check `degraded` | 5 minutes | Alert |
| Stripe check `degraded` | 5 minutes | Alert |
| Postmark check `degraded` | 10 minutes | Alert |
| Twilio check `degraded` | 10 minutes | Alert |
| readiness `durationMs` high | p95 above 2s for 5 minutes | Alert |

## Environment flags

| Env var | Default | Effect |
|---|---:|---|
| `HEALTH_CHECK_PROVIDERS_LIVE` | `false` | Enables live Stripe/Postmark/Twilio API calls. |
| `HEALTH_READY_DEGRADED_RETURNS_503` | `false` | Makes readiness return HTTP 503 for `degraded`. |

## Provider live checks

By default, provider checks should verify configuration only.

Live provider checks should be enabled when:

```text
you are validating production launch readiness
you are debugging provider-specific failures
your monitor interval is conservative
you are comfortable with provider API traffic
```

Live provider checks should stay disabled when:

```text
monitoring interval is very frequent
provider quotas/rate limits are a concern
provider status is already monitored elsewhere
```

## Manual test commands

Replace `YOUR_DOMAIN` before running:

```bash
curl -i https://YOUR_DOMAIN/api/health/live
curl -i https://YOUR_DOMAIN/api/health/ready
curl -i https://YOUR_DOMAIN/api/health
```

With provider live checks enabled:

```bash
HEALTH_CHECK_PROVIDERS_LIVE=true pnpm dev
curl -i http://localhost:3000/api/health/ready
```

With degraded returning 503:

```bash
HEALTH_READY_DEGRADED_RETURNS_503=true pnpm dev
curl -i http://localhost:3000/api/health/ready
```

## Incident notes template

```md
# Health readiness incident

## Summary

## Start time

## End time

## Status

- [ ] Investigating
- [ ] Identified
- [ ] Mitigated
- [ ] Resolved

## Failed health checks

## User impact

## Timeline

## Root cause

## Mitigation

## Recovery validation

## Follow-up tasks

## Owner
```

## Escalation

Escalate immediately when:

```text
postgres is down
live endpoint is down
ready endpoint is down for more than 1 minute
booking creation is affected
payments are affected
media upload is affected during active appointments
notification backlog is growing and not draining
```

## Related runbooks

```text
docs/runbooks/postgres-outage.md
docs/runbooks/redis-outage.md
docs/runbooks/supabase-storage-outage.md
docs/runbooks/stripe-degradation.md
docs/runbooks/postmark-degradation.md
docs/runbooks/twilio-degradation.md
docs/runbooks/notification-backlog.md
```