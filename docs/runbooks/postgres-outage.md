# Postgres Outage Runbook

Use this runbook when the Postgres health check is failing or degraded.

This usually means:

```text
/api/health/ready shows checks.postgres.status = down
Prisma queries are timing out
auth/login/profile/booking routes are failing
booking creation or session actions fail broadly
admin/pro/client dashboards return 500s
```

Postgres is a critical dependency. If Postgres is down, TOVIS should be treated as not ready for production traffic.

## Impact

Postgres powers the core product:

```text
users
sessions/authVersion checks
client profiles
professional profiles
services/offerings
locations/availability
booking holds
bookings
consultation approvals
media metadata
aftercare
notifications
payments/webhook state
audit logs
runtime flags if backed by DB
```

Expected user impact:

| Area | Impact |
|---|---|
| Login/session validation | May fail or timeout |
| Signup/onboarding | May fail |
| Booking creation | Likely unavailable |
| Booking holds/finalize | Likely unavailable |
| Pro session flow | Likely unavailable |
| Before/after photo metadata | Likely unavailable |
| Aftercare send/save | Likely unavailable |
| Payment state reconciliation | May fail or become delayed |
| Notifications | Dispatch/delivery state may not update |

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
  "status": "down",
  "checks": {
    "postgres": {
      "name": "postgres",
      "status": "down",
      "message": "Postgres health check timed out after 2000ms."
    }
  }
}
```

### App symptoms

Look for:

```text
HTTP 500s across many routes
PrismaClientKnownRequestError
PrismaClientInitializationError
connection pool timeout
database timeout
SELECT 1 failing
migrations failing
booking finalize failures
login failures
dashboard load failures
Stripe webhook processing failures
```

### Critical routes likely affected

```text
/api/auth/login
/api/auth/register
/api/bookings/finalize
/api/holds
/api/pro/bookings
/api/pro/bookings/[id]/session/start
/api/pro/bookings/[id]/media
/api/pro/bookings/[id]/aftercare
/api/webhooks/stripe
/api/webhooks/postmark
/api/webhooks/twilio
```

## Severity

| Condition | Severity |
|---|---:|
| `/api/health/live` is ok but Postgres is down | High |
| `/api/health/live` is down too | Critical |
| Booking creation is failing | Critical |
| Login/session validation is failing | Critical |
| Stripe webhooks cannot persist event state | Critical |
| Only read replica is degraded and primary works | Medium/High |
| Elevated query latency but no failures | Medium |

## First response checklist

```text
1. Confirm /api/health/live.
2. Confirm /api/health/ready.
3. Check whether Postgres is down or slow.
4. Check Supabase/Postgres provider status.
5. Check recent deploys and migrations.
6. Check connection pool exhaustion.
7. Check Prisma errors in logs.
8. Decide rollback vs provider incident vs DB mitigation.
9. Pause unsafe retries if needed.
10. Start incident notes.
```

## Step 1 — Confirm app liveness

Run:

```bash
curl -i https://YOUR_DOMAIN/api/health/live
```

If `/live` is also failing, this is broader than Postgres. Check:

```text
Vercel deployment status
Next.js runtime errors
global middleware errors
bad environment variables
build/deploy failure
```

If `/live` is ok but `/ready` is down because Postgres is down, continue with this runbook.

## Step 2 — Confirm Postgres readiness

Run:

```bash
curl -sS https://YOUR_DOMAIN/api/health/ready
```

Look for:

```text
checks.postgres.status
checks.postgres.message
checks.postgres.latencyMs
durationMs
```

Expected failure examples:

```text
Postgres health check timed out after 2000ms.
Can't reach database server
Connection pool timeout
Too many connections
Prepared statement error
Database unavailable
```

## Step 3 — Check provider status

Check your database provider dashboard.

For Supabase/Postgres, check:

```text
project status
database status
connection count
CPU
memory
disk
I/O
connection pooler/Supavisor status
recent restarts
maintenance windows
replication/read-replica health
```

If provider has an incident, record:

```text
provider incident URL
start time
affected region
expected resolution
workaround if available
```

## Step 4 — Check recent deploys

Look for recent changes involving:

```text
Prisma schema
migrations
DATABASE_URL
DATABASE_URL_READ
Supabase project settings
connection pooling
Prisma client generation
booking writeBoundary
auth/session code
health check code
webhook code
```

Rollback is usually appropriate if:

```text
the outage started immediately after deploy
the deploy changed Prisma/schema/database access
provider dashboard looks healthy
errors are app-specific
```

Rollback is usually not enough if:

```text
provider status shows outage
database is overloaded from traffic
secrets were rotated incorrectly
migrations partially applied
connection pool is exhausted because of traffic
```

## Step 5 — Check environment variables

Verify production has:

```text
DATABASE_URL
DATABASE_URL_READ, if used
DIRECT_URL, if migrations require it
```

For serverless Prisma on Supabase, check that the app uses the pooled connection endpoint where appropriate.

Expected pattern:

```text
Supabase pooler/Supavisor host
port 6543 for pooled connection
pgbouncer=true when required by Prisma setup
```

Do not paste database URLs or credentials into incident notes. Redact them.

## Step 6 — Check connection pool exhaustion

Symptoms:

```text
too many clients already
connection pool timeout
Timed out fetching a new connection from the connection pool
Prisma P2024
slow queries across many routes
health check timing out intermittently
```

Immediate actions:

```text
1. Check active connection count in provider dashboard.
2. Check whether traffic spiked.
3. Check whether a deploy caused too many cold starts.
4. Check whether background jobs are hammering the DB.
5. Temporarily reduce/disable non-critical cron jobs if needed.
6. Roll back if a deploy increased DB concurrency unexpectedly.
```

Possible temporary mitigations:

```text
disable expensive background jobs
increase pool size if safe
scale database tier if needed
reduce polling frequency
disable provider-live health checks if they indirectly increase traffic elsewhere
turn off non-critical features with runtime flags
```

Do not blindly increase connection limits if the database CPU/memory is already saturated. More connections can make a struggling database collapse harder. Very dramatic. Very database.

## Step 7 — Check migrations

Look for:

```text
failed migration
long-running migration
locked table
missing column
Prisma client/schema mismatch
migration applied in one environment but not another
```

Commands to run locally or in the deployment pipeline context:

```bash
npx prisma migrate status
npx prisma generate
npx prisma validate
```

In production, prefer provider dashboard and deployment logs. Do not manually run destructive SQL during an incident unless there is a reviewed rollback plan.

## Step 8 — Check slow or blocked queries

Look for:

```text
long-running transactions
locks
seq scans on hot tables
unbounded dashboard queries
notification backlog queries
availability queries
booking finalize conflicts
```

Hot tables:

```text
User
ClientProfile
ProfessionalProfile
ProfessionalLocation
ProfessionalServiceOffering
Booking
BookingHold
MediaAsset
AftercareSummary
Notification
NotificationDispatch
NotificationDelivery
IdempotencyKey
ClientActionToken
StripeWebhookEvent
BookingCloseoutAuditLog
```

Hot routes:

```text
/api/bookings/finalize
/api/holds
/api/pro/bookings
/api/pro/bookings/[id]
/api/pro/bookings/[id]/session/start
/api/client/bookings
/api/availability/bootstrap
/api/webhooks/stripe
```

## Step 9 — Protect data consistency

If Postgres is unstable, avoid unsafe manual actions.

Do not:

```text
manually mark bookings completed
manually mark payments paid
delete idempotency keys
delete webhook events
delete booking holds to "unstick" availability
run destructive migrations
replay Stripe webhooks repeatedly without checking idempotency
```

Safe actions:

```text
pause non-critical jobs
pause manual webhook replay
temporarily hide affected CTAs
show maintenance copy
rollback app deploy
disable degraded features with runtime flags
```

## Step 10 — Check background jobs

Postgres issues can break:

```text
hold cleanup
notification delivery processing
Stripe orphan recovery
reminders
looks/social jobs
backfills
search index refresh
```

Check job symptoms:

```text
job timeouts
job retries increasing
oldest pending notification increasing
webhook events stuck unprocessed
booking holds not expiring
```

Temporary mitigation:

```text
pause non-critical cron jobs if they add DB pressure
keep critical idempotent recovery jobs paused until DB stabilizes
resume jobs gradually after recovery
```

## Step 11 — Stripe webhook safety

If Postgres is down, Stripe webhooks may fail to persist `StripeWebhookEvent`.

Action:

```text
1. Do not manually mark payments paid.
2. Let Stripe retry webhooks automatically where possible.
3. Once DB recovers, inspect Stripe webhook delivery dashboard.
4. Replay failed webhook events only after confirming idempotency.
5. Verify booking payment state and checkout state after replay.
```

Data to check after recovery:

```text
StripeWebhookEvent rows
Booking.stripePaymentIntentId
Booking.stripeCheckoutSessionId
Booking.stripePaymentStatus
Booking.checkoutStatus
Booking.status
Booking.sessionStep
```

## Step 12 — Customer-facing behavior

If Postgres is down, recommended user-facing behavior:

```text
show maintenance/error copy
prevent booking finalize retries from creating confusion
avoid promising booking confirmation until DB write succeeds
avoid allowing payment without booking persistence
```

Suggested support copy:

```text
We’re seeing a temporary service issue affecting booking and account actions. We’re working on it now. If you were booking or checking out, please wait for confirmation before retrying.
```

For active appointments:

```text
If you are in an active appointment, your Pro may continue service offline temporarily, but booking updates, photos, aftercare, or payment status may not save until service is restored.
```

## Recovery validation

Before resolving, confirm:

```text
/api/health/live returns ok
/api/health/ready returns ok
checks.postgres.status is ok
Postgres latency is back to normal
route 500 rate is back to baseline
booking finalize works
login/session validation works
Stripe webhook backlog is processed
notification backlog is draining
hold cleanup has resumed
no duplicate booking/payment side effects were created
```

## Post-recovery data checks

Run targeted checks for:

```text
bookings created during incident window
payments attempted during incident window
Stripe webhooks received during incident window
booking holds created during incident window
aftercare sends during incident window
media uploads during incident window
notification dispatches during incident window
```

Look for:

```text
booking without expected payment state
payment without booking completion
webhook event failed but not retried
hold expired but still blocking
aftercare sent flag mismatch
notification dispatch without delivery rows
duplicate idempotency conflicts
```

## Rollback guidance

Rollback app deploy if:

```text
provider is healthy
errors started after deploy
new deploy changed DB access/schema/query behavior
Prisma client mismatch is likely
migration is not involved or rollback is safe
```

Do not rollback blindly if:

```text
a migration already changed schema incompatibly
old code cannot run against new schema
the issue is provider-side
database capacity is the bottleneck
```

If migration rollback is needed:

```text
1. Stop further deploys.
2. Identify migration.
3. Confirm forward/backward compatibility.
4. Create reviewed rollback SQL.
5. Backup affected data if possible.
6. Apply rollback during controlled window.
7. Redeploy matching app version.
```

## Escalation

Page immediately when:

```text
Postgres is down for more than 1 minute
booking creation is failing
login is failing
Stripe webhook persistence is failing
database CPU/memory/connection count is saturated
migration is stuck or partially applied
data consistency is at risk
```

Escalate to:

```text
database owner
on-call engineer
payment owner if Stripe state is affected
support lead if users are impacted
provider support if dashboard shows provider-side issue
```

## Logs to collect

Collect:

```text
timestamp range
deployment id
request ids
route names
Prisma error codes
database provider dashboard screenshots
connection count
slow query logs if available
failed migration logs
Stripe webhook event ids if payment affected
affected booking ids
affected user/pro ids
```

Do not collect or paste:

```text
raw DATABASE_URL
database password
service role key
JWT secret
client addresses
phone numbers
emails
signed media URLs
```

## Useful error codes

Common Prisma/database signals:

```text
P1001: cannot reach database server
P1002: database server timeout
P1008: operation timed out
P1017: server closed the connection
P2024: timed out fetching a new connection from pool
P2034: transaction failed due to write conflict or deadlock
```

Interpretation:

| Error | Meaning | Action |
|---|---|---|
| `P1001` | DB unreachable | Check provider/network/env |
| `P1002` / `P1008` | Timeout | Check DB load/locks/network |
| `P1017` | Connection closed | Check provider restart/pool |
| `P2024` | Pool exhaustion | Check connection count/cold starts |
| `P2034` | Transaction conflict | Check concurrency/retry behavior |

## Incident notes template

```md
# Postgres incident

## Summary

## Start time

## End time

## Severity

## Detection

## Health check output

## User impact

## Affected routes

## Affected bookings/users

## Timeline

## Root cause

## Mitigation

## Recovery validation

## Data consistency checks

## Follow-up tasks

## Owner
```

## Follow-up tasks

After the incident, create issues for:

```text
missing DB indexes
missing query timeout
missing retry handling
missing dashboard panel
missing alert
unclear error message
unsafe manual process
missing runbook step
migration safety improvement
load test gap
```

## Related runbooks

```text
docs/runbooks/health-readiness.md
docs/runbooks/redis-outage.md
docs/runbooks/stripe-degradation.md
docs/runbooks/notification-backlog.md
```