# Redis Outage Runbook

Use this runbook when Redis, Upstash Redis, or Vercel KV is unavailable, slow, misconfigured, or returning errors.

This usually means:

```text
/api/health/ready shows checks.redis.status = degraded
runtime flags fail to load
rate limiting fails or behaves unexpectedly
cache-backed reads become slower
notification versioning or polling freshness breaks
Redis commands timeout
```

Redis is not treated as a critical readiness dependency by default, but it is still operationally important. When Redis is degraded, TOVIS may keep serving traffic, but some safety and freshness features can weaken. Tiny detail. Tiny chainsaw.

## Impact

Redis may support:

```text
runtime flags
rate limiting
versioned cache
availability cache
notification versioning
polling freshness markers
temporary coordination keys
health check read/write verification
```

Expected user impact:

| Area | Impact |
|---|---|
| Runtime flags | Feature flags may fail to read or update. |
| Rate limiting | Abuse protection may fail open or fail closed depending route policy. |
| Availability/search cache | Slower responses, more DB load, stale or missing cache entries. |
| Notifications | In-app freshness/versioning may lag. |
| Booking/session pages | May require refresh instead of fast state updates. |
| Auth/SMS routes | Must fail closed if Redis is required for abuse protection. |

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
    "redis": {
      "name": "redis",
      "status": "degraded",
      "message": "Redis health check read-after-write verification failed."
    }
  }
}
```

Other possible messages:

```text
Redis is not configured.
Redis health check timed out after 2000ms.
Redis health check read-after-write verification failed.
UPSTASH_REDIS_REST_URL missing
UPSTASH_REDIS_REST_TOKEN missing
KV_REST_API_URL missing
KV_REST_API_TOKEN missing
```

### App symptoms

Look for:

```text
runtime flag reads failing
rate limit errors
auth/SMS routes unexpectedly blocking
auth/SMS routes not rate-limiting
cache misses spiking
Redis request timeouts
Upstash REST API errors
notification freshness lag
session state not refreshing
```

### Critical routes likely affected

```text
/api/auth/login
/api/auth/register
/api/auth/phone/send
/api/auth/phone/verify
/api/bookings/finalize
/api/bookings/[id]/cancel
/api/bookings/[id]/reschedule
/api/pro/bookings
/api/pro/bookings/[id]/media
/api/public/consultation/[token]/decision
/api/client/rebook/[token]
/api/health/ready
```

## Severity

| Condition | Severity |
|---|---:|
| Redis degraded but app flows work | Medium |
| Auth/SMS rate limiting cannot run | High |
| Redis failure causes broad 500s | High |
| Redis failure causes Postgres overload from cache stampede | High/Critical |
| Runtime flags unavailable during active incident | Medium/High |
| Notification freshness only is affected | Medium |
| Local dev Redis missing | Low |

## First response checklist

```text
1. Confirm /api/health/live.
2. Confirm /api/health/ready.
3. Confirm only Redis is degraded.
4. Check Upstash/Vercel KV provider status.
5. Check Redis env vars.
6. Check whether auth/SMS routes fail open or fail closed.
7. Check cache miss rate and database load.
8. Check recent deploys and runtime flag changes.
9. Decide whether to rollback, degrade gracefully, or disable affected features.
10. Record incident notes.
```

## Step 1 — Confirm app and database health

Run:

```bash
curl -i https://YOUR_DOMAIN/api/health/live
curl -i https://YOUR_DOMAIN/api/health/ready
```

If `postgres` is also `down`, switch to:

```text
docs/runbooks/postgres-outage.md
```

If only Redis is degraded, continue here.

## Step 2 — Check Redis provider status

Check:

```text
Upstash status
Vercel KV status, if using KV env vars
project/database status
request error rate
latency
usage limits
quota exhaustion
regional outage
recent token/key rotation
```

If provider incident exists, record:

```text
provider incident URL
start time
affected region
expected recovery
recommended workaround
```

## Step 3 — Check environment variables

The repo’s Redis helper supports either Upstash names or Vercel KV-compatible names.

Verify production has one complete pair:

```text
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
```

or:

```text
KV_REST_API_URL
KV_REST_API_TOKEN
```

Do not mix one variable from each pair unless the helper explicitly supports that. Half-configured Redis is not “almost configured.” It is just configured enough to be annoying.

Do not paste Redis tokens into incident notes.

## Step 4 — Check recent deploys

Look for changes involving:

```text
lib/redis.ts
lib/runtimeFlags.ts
lib/rateLimitRedis.ts
lib/rateLimit/*
lib/cache/*
lib/health/redis.ts
middleware.ts
auth routes
SMS routes
notification processing
availability cache
```

Rollback is appropriate when:

```text
Redis provider is healthy
errors started immediately after deploy
deploy changed Redis env names or Redis client code
rate limiting/cache code changed
health check code changed
```

Rollback is not enough when:

```text
provider is down
quota is exhausted
token was revoked
traffic spike exceeded provider limits
```

## Step 5 — Determine fail-open vs fail-closed behavior

Different routes should behave differently when Redis is unavailable.

### Must fail closed

These routes protect expensive or abuse-prone actions:

```text
/api/auth/register
/api/auth/login
/api/auth/phone/send
/api/auth/phone/verify
/api/auth/password/*
public token decision routes
```

If Redis is required for abuse protection and is unavailable, these should either:

```text
return 429/503 with safe retry copy
use a stricter fallback limiter
temporarily disable the high-risk action
```

Do not let SMS sends fail open. Twilio billing has no sympathy and does not accept “but Redis was down” as payment.

### Can fail open or degrade

These features can usually continue without Redis:

```text
general app page loads
non-sensitive cached reads
availability cache read-through, if DB load is safe
notification version polling
runtime flag reads with safe defaults
```

## Step 6 — Check rate limiting

Look for:

```text
rate limit checks timing out
routes bypassing limits
routes blocking all users
auth/SMS abuse spike
many requests from same IP/phone/user
429 rate unexpectedly low or high
```

Priority routes:

```text
/api/auth/register
/api/auth/login
/api/auth/phone/send
/api/auth/phone/verify
/api/public/consultation/[token]/decision
/api/client/rebook/[token]
/api/pro/bookings/[id]/media
```

Immediate mitigation:

```text
1. If auth/SMS limits fail open, disable or hard-limit those routes temporarily.
2. If limits fail closed too broadly, show clear retry copy.
3. Add temporary WAF/IP blocking if attack traffic is obvious.
4. Disable SMS sends if Twilio abuse is ongoing.
```

## Step 7 — Check runtime flags

Redis degradation may affect runtime flags if they depend on Redis.

Check:

```text
runtime flag reads
admin runtime flag writes
feature enable/disable behavior
last-known-safe defaults
```

If runtime flags are unavailable:

```text
1. Confirm whether the app uses safe fallback defaults.
2. Avoid toggling features until Redis recovers.
3. If a feature must be disabled, use deploy/env rollback if runtime flags are not reliable.
```

## Step 8 — Check cache behavior

Redis cache failure can increase direct database load.

Watch:

```text
Postgres CPU
Postgres connection count
slow query count
availability endpoint latency
booking dashboard latency
search latency
notification inbox latency
```

If DB load increases:

```text
1. Reduce polling frequency.
2. Disable non-critical cache-heavy features.
3. Add temporary route-level throttles.
4. Pause non-critical background jobs.
5. Keep an eye on /api/health/ready checks.postgres.
```

If Postgres starts failing too, switch to:

```text
docs/runbooks/postgres-outage.md
```

## Step 9 — Check notification freshness

Redis may be used for notification versioning or freshness markers.

Symptoms:

```text
pro inbox does not update
session page requires refresh
client approval does not appear quickly
notification version endpoint stale or unavailable
```

Mitigation:

```text
1. Fall back to manual refresh/polling from DB.
2. Increase client polling interval if Redis errors cause load.
3. Show copy like "Refresh to check latest updates" if needed.
4. Do not claim realtime behavior is working if Redis publish/subscriber path is degraded.
```

## Step 10 — Manual Redis smoke test

From a safe server/admin context, verify:

```text
set health key with expiry
read health key
delete health key if needed
```

Expected behavior:

```text
write succeeds
read returns same value
latency is reasonable
key expires
```

Do not run destructive commands like:

```text
FLUSHALL
FLUSHDB
KEYS *
```

No. Absolutely not. Tiny villain button.

## Step 11 — Customer-facing behavior

If Redis is degraded but core app works:

Suggested support copy:

```text
Some real-time updates, notifications, or verification features may be delayed. Core booking information remains safe, but you may need to refresh the page while we resolve the issue.
```

If SMS/auth is affected:

```text
Phone verification is temporarily unavailable. Please try again shortly. Existing bookings and account data remain safe.
```

If rate limiting is fail-closed:

```text
We’re temporarily limiting sign-in or verification attempts while we resolve a service issue. Please try again in a few minutes.
```

## Step 12 — Recovery validation

Before resolving, confirm:

```text
/api/health/live returns ok
/api/health/ready returns ok or redis no longer degraded
checks.redis.status is ok
Redis latency returns to baseline
auth/SMS rate limits behave correctly
runtime flags read/write correctly
cache hit rate recovers
Postgres load returns to baseline
notification freshness/versioning recovers
no SMS abuse occurred during the incident
```

## Post-recovery checks

Check for:

```text
SMS sends during incident window
phone verification failures
auth brute-force attempts
rate-limit bypasses
runtime flag changes during incident
cache stampede effects
Postgres load spikes
notification freshness delays
```

If Redis was unavailable long enough to affect rate limits, review logs for abuse attempts.

## Rollback guidance

Rollback app deploy if:

```text
Redis provider is healthy
errors started after deploy
Redis helper/client/rate-limit/cache code changed
env var names changed
health check code changed
```

Do not rollback if:

```text
provider is down
token was revoked outside code
quota/usage limit was hit
traffic spike caused provider throttling
```

## Escalation

Escalate when:

```text
Redis degraded for more than 5 minutes
auth/SMS routes are affected
rate limiting is failing open
Postgres load rises because cache is unavailable
runtime flags cannot disable a risky feature
notification/session freshness is affecting active bookings
```

Escalate to:

```text
on-call engineer
security/abuse owner if rate limiting is affected
support lead if verification/sign-in is affected
provider support if dashboard shows provider issue
```

## Logs to collect

Collect:

```text
timestamp range
deployment id
request ids
affected routes
Redis error messages
Upstash/Vercel KV dashboard screenshots
rate-limit decisions
auth/SMS request volume
cache hit/miss rates
Postgres load during Redis incident
runtime flag read/write failures
```

Do not collect or paste:

```text
Redis REST token
Redis URL with token
phone numbers
emails
verification codes
auth cookies
JWTs
```

## Useful error signals

Common Redis/Upstash signals:

```text
fetch failed
unauthorized
invalid token
rate limit exceeded
request timeout
connection refused
backend unavailable
read-after-write verification failed
```

Interpretation:

| Signal | Meaning | Action |
|---|---|---|
| `unauthorized` | Bad/revoked token | Check env vars and provider keys |
| `rate limit exceeded` | Provider quota/throttle | Reduce traffic, upgrade plan, add fallback |
| `timeout` | Provider/network latency | Check provider status and region |
| `read-after-write failed` | Data plane inconsistency | Check provider status, retry later |
| `not configured` | Missing env vars | Fix deployment config |

## Incident notes template

```md
# Redis incident

## Summary

## Start time

## End time

## Severity

## Detection

## Health check output

## User impact

## Affected routes/features

## Rate limiting impact

## Runtime flag impact

## Cache impact

## Timeline

## Root cause

## Mitigation

## Recovery validation

## Follow-up tasks

## Owner
```

## Follow-up tasks

After the incident, create issues for:

```text
missing rate-limit fail-closed behavior
missing route fallback
missing dashboard panel
missing alert
cache stampede risk
unclear user-facing copy
runtime flag fallback improvement
provider plan/quota issue
Redis token rotation process
```

## Related runbooks

```text
docs/runbooks/health-readiness.md
docs/runbooks/postgres-outage.md
docs/runbooks/notification-backlog.md
docs/runbooks/twilio-degradation.md
```