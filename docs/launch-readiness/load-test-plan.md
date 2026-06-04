# Load Test Plan

## Status

Phase: Phase 2 — Launch ops proof  
Scope: Private beta and public rollout load readiness  
Current default status: TODO — launch-critical load proof is not complete  
Primary owner: Tori  
Target environment: Staging first, production only with explicit approval  
Current known baseline: Signup load test exists; launch-critical booking/payment/media/notification load tests still need to be added.

This document defines the load-test scenarios required before public rollout. Private beta may begin with smaller smoke proof and tight cohort limits, but public rollout requires load proof for the launch-critical paths.

## Load test rule

A load test is not complete unless it has:

- Script path
- Owner
- Target route or workflow
- Required environment variables
- Safe seeded test data
- RPS/stage profile
- Timeout settings
- Success criteria
- Failure criteria
- Data cleanup plan
- Summary output
- Staging run evidence
- Dashboard link
- Launch decision

Do not run load tests against production unless the target environment, data isolation, provider costs, and rollback plan are explicitly approved.

## Current status summary

| Scenario | Script | Status | Launch impact |
|---|---|---|---|
| Signup/register | tests/load/signup-load-test.ts | EXISTS | Useful baseline, not enough for public rollout |
| Availability bootstrap | tests/load/availability-bootstrap-load-test.ts | TODO | Required before public rollout |
| Hold create | tests/load/hold-create-load-test.ts | TODO | Required before public rollout |
| Booking finalize | tests/load/booking-finalize-load-test.ts | TODO | Required before public rollout |
| Media metadata | tests/load/media-metadata-load-test.ts | TODO | Required before public rollout |
| Checkout | tests/load/checkout-load-test.ts | TODO | Required before public rollout |
| Stripe webhook replay | tests/load/stripe-webhook-replay-load-test.ts | TODO | Required before public rollout |
| Notification processing | tests/load/notification-processing-load-test.ts | TODO | Required before public rollout |
| Aggregate launch load suite | tests/load/run-launch-load-suite.ts | TODO | Required before public rollout |

## Required package scripts

Add these scripts when the corresponding test files exist:

json {   "test:load:signup": "tsx tests/load/signup-load-test.ts",   "test:load:availability": "tsx tests/load/availability-bootstrap-load-test.ts",   "test:load:holds": "tsx tests/load/hold-create-load-test.ts",   "test:load:booking-finalize": "tsx tests/load/booking-finalize-load-test.ts",   "test:load:media-metadata": "tsx tests/load/media-metadata-load-test.ts",   "test:load:checkout": "tsx tests/load/checkout-load-test.ts",   "test:load:stripe-webhook-replay": "tsx tests/load/stripe-webhook-replay-load-test.ts",   "test:load:notifications": "tsx tests/load/notification-processing-load-test.ts",   "test:load:launch": "tsx tests/load/run-launch-load-suite.ts" } 

test:load:launch should run only the launch-approved staged profile for staging. It should not silently run destructive or cost-heavy tests.

## Traffic profiles

Use explicit profiles. Do not accidentally run a public-launch stress profile when you meant to run a smoke test. That is how we summon invoices with teeth.

| Profile | Purpose | RPS | Duration | Required for |
|---|---|---:|---:|---|
| smoke | Script correctness and safe staging proof | 1-5 | 30-60 seconds | Private beta |
| baseline | Normal expected beta pressure | 10-25 | 60 seconds | Private beta expansion |
| launch | Initial public rollout readiness | 50-100 | 60-120 seconds | Public rollout |
| stress | Find breaking points above launch target | 150-250 | 120 seconds | Pre-public rollout hardening |

Initial scripts may mirror the existing signup stages:

text 10 RPS for 60 seconds 50 RPS for 60 seconds 100 RPS for 60 seconds 200 RPS for 120 seconds 

If a route has provider cost or mutation risk, start with smoke and baseline only.

## Global environment contract

Required for all staging load tests:

| Env var | Required | Description |
|---|---:|---|
| STAGING_BASE_URL | Yes | Base URL for staging environment. |
| LOAD_TEST_REQUEST_TIMEOUT_MS | No | Per-request timeout. Default should be 15000ms. |
| LOAD_TEST_MAX_IN_FLIGHT | No | Max in-flight requests. Default should be conservative unless script needs more. |
| LOAD_TEST_TRUSTED_IP_HEADER_NAME | No | Optional synthetic trusted IP header for rate-limit testing. |
| LOAD_TEST_TRUSTED_IP_PREFIX | No | Optional IP prefix used with trusted IP header. |
| LOAD_TEST_PROFILE | No | smoke, baseline, launch, or stress if the script supports profiles. |
| LOAD_TEST_RUN_ID | No | Optional run identifier for correlation. |
| LOAD_TEST_DRY_RUN | No | Optional script mode for validating config without sending requests. |

Rules:

- LOAD_TEST_TRUSTED_IP_HEADER_NAME and LOAD_TEST_TRUSTED_IP_PREFIX must be set together.
- Staging must use test/sandbox provider credentials.
- Load scripts must not require real user PII.
- Load scripts must not print secrets.
- Load scripts must print a JSON summary.

## Required output format

Every load test should print a final JSON summary with:

json {   "runId": "TODO",   "commit": "TODO",   "environment": "staging",   "baseUrl": "TODO",   "routeOrFlow": "TODO",   "trafficPlan": [],   "totals": {     "requests": 0,     "successes": 0,     "expectedRateLimits": 0,     "realFailures": 0,     "realFailureRateExcludingExpectedRateLimitsPct": null   },   "latencyMs": {     "all": {       "p50": null,       "p95": null,       "p99": null     },     "successOnly": {       "p50": null,       "p95": null,       "p99": null     }   },   "statusCounts": {},   "codeCounts": {},   "perStage": [],   "dataCleanup": {     "required": false,     "completed": null,     "notes": "TODO"   },   "dashboardLink": "TODO",   "decision": "TODO" } 

## Success criteria

A load test passes only when:

- It runs against the intended environment.
- It uses safe test data.
- It produces a JSON summary.
- Real failures are below the threshold defined for that scenario.
- p95 latency is within the scenario threshold.
- Expected rate limits are counted separately from real failures.
- No privacy-sensitive values are printed.
- Data cleanup is completed or not required.
- Related dashboard section shows the traffic/errors.
- Results are recorded in this file or linked from go-no-go.md.

## Failure criteria

A load test fails if:

- The script hits production unintentionally.
- Required env vars are missing.
- It prints secrets or raw sensitive values.
- Real failures exceed threshold.
- p95 latency exceeds threshold.
- It creates orphaned holds, bookings, media rows, or payment state.
- Cleanup fails.
- Provider webhook/payment behavior becomes inconsistent.
- Sentry/dashboard evidence is missing for public rollout proof.

---

# Scenario 1 — Signup/register baseline

## Status

| Field | Value |
|---|---|
| Script | tests/load/signup-load-test.ts |
| Status | EXISTS |
| Required for private beta | Useful but not sufficient |
| Required for public rollout | Useful but not sufficient |
| Owner | Tori |

## Purpose

Proves registration route behavior under staged request volume. This is a baseline only. It does not prove booking/payment/media readiness.

## Required env vars

| Env var | Required | Notes |
|---|---:|---|
| STAGING_BASE_URL | Yes | Staging base URL. |
| TURNSTILE_TEST_TOKEN | Yes | Test CAPTCHA/Turnstile token. |
| LOAD_TEST_PHONE_POOL_FILE | Preferred | Safer than generated phones. |
| ALLOW_GENERATED_PHONE_NUMBERS | Optional | Use only with non-delivering SMS test credentials/sinks. |

## Launch treatment

Do not count this as complete public rollout load proof by itself.

---

# Scenario 2 — Availability bootstrap

## Status

| Field | Value |
|---|---|
| Script | tests/load/availability-bootstrap-load-test.ts |
| Status | TODO |
| Required for private beta | Recommended smoke proof |
| Required for public rollout | Yes |
| Owner | Tori |

## Purpose

Proves GET /api/availability/bootstrap can handle staged traffic for service/pro availability setup.

## Required env vars

| Env var | Required | Notes |
|---|---:|---|
| STAGING_BASE_URL | Yes | Staging base URL. |
| LOAD_TEST_PROFESSIONAL_ID | Yes | Seeded pro with availability. |
| LOAD_TEST_SERVICE_ID | Yes | Seeded service. |
| LOAD_TEST_LOCATION_TYPE | Optional | Example: IN_STUDIO, MOBILE, etc. |
| LOAD_TEST_LOCATION_ID | Optional | Required if route context needs explicit location. |
| LOAD_TEST_CLIENT_ADDRESS_ID | Optional | For mobile scenarios. |
| LOAD_TEST_ADD_ON_IDS | Optional | Comma-separated add-on IDs. |
| LOAD_TEST_START_DATE | Optional | Date for summary window. |
| LOAD_TEST_SUMMARY_DAYS | Optional | Default can be 14. |
| LOAD_TEST_INCLUDE_OTHER_PROS | Optional | Use false to isolate primary pro path. |
| LOAD_TEST_VIEWER_LAT | Optional | Must pair with viewer longitude. |
| LOAD_TEST_VIEWER_LNG | Optional | Must pair with viewer latitude. |
| LOAD_TEST_RADIUS_MILES | Optional | Nearby pro radius if using other-pros. |

## Success criteria

- 200 responses dominate.
- Expected 429s are counted separately.
- No 500 spikes.
- p95 latency threshold is defined and met.
- Sentry dashboard shows traffic/errors.
- No unsafe PII is printed.

## Public rollout evidence

text Command: Commit: Environment: Seeded pro/service: Total requests: Success rate: p95 latency: p99 latency: Real failures: Dashboard link: Decision: 

---

# Scenario 3 — Hold create

## Status

| Field | Value |
|---|---|
| Script | tests/load/hold-create-load-test.ts |
| Status | TODO |
| Required for private beta | Recommended smoke proof |
| Required for public rollout | Yes |
| Owner | Tori |

## Purpose

Proves booking hold creation behaves correctly under concurrent load and does not create unsafe duplicate/overlapping state.

## Required env vars

| Env var | Required | Notes |
|---|---:|---|
| STAGING_BASE_URL | Yes | Staging base URL. |
| LOAD_TEST_PROFESSIONAL_ID | Yes | Seeded pro. |
| LOAD_TEST_SERVICE_ID | Yes | Seeded service. |
| LOAD_TEST_LOCATION_ID | Yes/Maybe | Depends on hold route contract. |
| LOAD_TEST_CLIENT_ID | Optional | Use seeded test client if route requires auth/context. |
| LOAD_TEST_AUTH_TOKEN | Optional | Only if route requires authenticated calls. |
| LOAD_TEST_SLOT_POOL_FILE | Preferred | Prevent all requests fighting over one slot unless conflict testing is intentional. |

## Success criteria

- Valid holds succeed.
- Intentional conflicts/rate limits are classified separately.
- No double-booking or overlapping hold corruption.
- Expired/stale holds do not block future valid holds after expected timeout.
- Cleanup removes test holds or uses expiring hold TTL.

## Public rollout evidence

text Command: Commit: Environment: Slot pool: Total requests: Successes: Expected conflicts: Real failures: Cleanup result: Dashboard link: Decision: 

---

# Scenario 4 — Booking finalize

## Status

| Field | Value |
|---|---|
| Script | tests/load/booking-finalize-load-test.ts |
| Status | TODO |
| Required for private beta | Recommended smoke proof |
| Required for public rollout | Yes |
| Owner | Tori |

## Purpose

Proves hold-to-booking finalization behaves correctly under load and does not produce duplicate bookings, inconsistent lifecycle state, or payment-state corruption.

## Required env vars

| Env var | Required | Notes |
|---|---:|---|
| STAGING_BASE_URL | Yes | Staging base URL. |
| LOAD_TEST_HOLD_POOL_FILE | Preferred | Pre-created safe holds. |
| LOAD_TEST_AUTH_TOKEN | Optional | If route requires auth. |
| LOAD_TEST_IDEMPOTENCY_KEY_PREFIX | Optional | Use run-specific prefix. |
| LOAD_TEST_PAYMENT_MODE | Optional | Sandbox/test only. |

## Success criteria

- Valid finalizations succeed.
- Replays are idempotent.
- Duplicate finalize attempts do not create duplicate bookings.
- Payment/webhook dependencies remain test/sandbox-only.
- Data cleanup is documented.
- Booking lifecycle dashboard shows route behavior.

## Public rollout evidence

text Command: Commit: Environment: Hold pool: Total requests: Successes: Idempotent replays: Real failures: Duplicate booking count: Cleanup result: Dashboard link: Decision: 

---

# Scenario 5 — Media metadata

## Status

| Field | Value |
|---|---|
| Script | tests/load/media-metadata-load-test.ts |
| Status | TODO |
| Required for private beta | Recommended smoke proof |
| Required for public rollout | Yes |
| Owner | Tori |

## Purpose

Proves media metadata persistence and upload-adjacent behavior under load without leaking private media or creating orphaned rows.

## Required env vars

| Env var | Required | Notes |
|---|---:|---|
| STAGING_BASE_URL | Yes | Staging base URL. |
| LOAD_TEST_AUTH_TOKEN | Optional | If route requires auth. |
| LOAD_TEST_MEDIA_OWNER_ID | Optional | Seeded owner if needed. |
| LOAD_TEST_MEDIA_KIND | Optional | Before/after/reference media type. |
| LOAD_TEST_STORAGE_MODE | Required when writing storage | Must be staging/test only. |

## Success criteria

- Metadata writes succeed.
- Invalid file metadata is rejected safely.
- No private media URL/path leaks in output.
- No orphaned media rows after cleanup.
- Storage/provider failures are visible in dashboard.

## Public rollout evidence

text Command: Commit: Environment: Total requests: Successes: Rejected invalid requests: Real failures: Orphan cleanup result: Dashboard link: Decision: 

---

# Scenario 6 — Checkout

## Status

| Field | Value |
|---|---|
| Script | tests/load/checkout-load-test.ts |
| Status | TODO |
| Required for private beta | Recommended smoke proof |
| Required for public rollout | Yes |
| Owner | Tori |

## Purpose

Proves checkout/session/payment-intent creation behaves correctly under load using safe Stripe test-mode behavior.

## Required env vars

| Env var | Required | Notes |
|---|---:|---|
| STAGING_BASE_URL | Yes | Staging base URL. |
| LOAD_TEST_AUTH_TOKEN | Optional | If checkout route requires auth. |
| LOAD_TEST_BOOKING_POOL_FILE | Preferred | Seeded bookings eligible for checkout. |
| LOAD_TEST_STRIPE_MODE | Yes | Must be test/sandbox for load testing. |
| LOAD_TEST_IDEMPOTENCY_KEY_PREFIX | Optional | Run-specific prefix. |

## Success criteria

- Checkout creation succeeds for valid test bookings.
- Stripe test-mode only.
- Idempotency prevents duplicate unsafe payment state.
- Expected Stripe/provider rate limits are classified separately.
- Payment dashboard shows traffic/errors.
- Cleanup or test-data isolation is documented.

## Public rollout evidence

text Command: Commit: Environment: Stripe mode: Total requests: Successes: Expected provider/rate-limit failures: Real failures: Duplicate checkout/payment mutation count: Dashboard link: Decision: 

---

# Scenario 7 — Stripe webhook replay

## Status

| Field | Value |
|---|---|
| Script | tests/load/stripe-webhook-replay-load-test.ts |
| Status | TODO |
| Required for private beta | Recommended smoke/idempotency proof |
| Required for public rollout | Yes |
| Owner | Tori |

## Purpose

Proves Stripe webhook replay, signature verification, dedupe, and idempotent state mutation under repeated delivery.

## Required env vars

| Env var | Required | Notes |
|---|---:|---|
| STAGING_BASE_URL | Yes | Staging base URL. |
| LOAD_TEST_STRIPE_WEBHOOK_SECRET | Yes | Staging/test secret only. |
| LOAD_TEST_STRIPE_EVENT_FIXTURE_FILE | Yes | Safe fixture payload. |
| LOAD_TEST_REPLAY_COUNT | Optional | Defaults should be conservative. |
| LOAD_TEST_IDEMPOTENCY_KEY_PREFIX | Optional | Run-specific prefix if needed. |

## Success criteria

- Valid signatures accepted.
- Invalid signatures rejected in negative test mode.
- Replay/dedupe behavior is correct.
- No double payment/booking mutation.
- Webhook dashboard shows received/processed/replayed/failure events.
- No secrets printed.

## Public rollout evidence

text Command: Commit: Environment: Fixture: Replay count: Accepted: Deduped: Rejected invalid signatures: Real failures: Double mutation count: Dashboard link: Decision: 

---

# Scenario 8 — Notification processing

## Status

| Field | Value |
|---|---|
| Script | tests/load/notification-processing-load-test.ts |
| Status | TODO |
| Required for private beta | Recommended if notifications enabled |
| Required for public rollout | Yes if notifications enabled |
| Owner | Tori |

## Purpose

Proves notification queue/drain behavior, provider degradation visibility, and manual-follow-up path under launch-like pressure.

## Required env vars

| Env var | Required | Notes |
|---|---:|---|
| STAGING_BASE_URL | Yes | Staging base URL if route/API based. |
| LOAD_TEST_NOTIFICATION_FIXTURE_FILE | Optional | Seeded notification requests. |
| LOAD_TEST_EMAIL_MODE | Optional | Must be test/sink mode if sending. |
| LOAD_TEST_SMS_MODE | Optional | Must be test/sink mode if sending. |
| LOAD_TEST_DISABLE_REAL_DELIVERY | Preferred | Should be true unless explicitly approved. |

## Success criteria

- Notifications are processed or safely queued.
- Provider failures are visible.
- Retry/manual follow-up behavior is documented.
- No spam to real users.
- No raw PII printed.
- Notification dashboard shows traffic/errors/backlog.

## Public rollout evidence

text Command: Commit: Environment: Delivery mode: Total notifications: Processed: Queued: Retried: Manual follow-up: Real failures: Dashboard link: Decision: 

---

# Aggregate launch load suite

## Status

| Field | Value |
|---|---|
| Script | tests/load/run-launch-load-suite.ts |
| Status | TODO |
| Required for public rollout | Yes |
| Owner | Tori |

## Purpose

Runs the approved launch load scenarios in a safe order and produces one summary for go-no-go.md.

## Required behavior

- Refuse to run without STAGING_BASE_URL.
- Refuse to run destructive/cost-heavy scenarios unless explicitly enabled.
- Print each scenario summary.
- Print aggregate pass/fail.
- Preserve each scenario exit code.
- Avoid production unless explicitly approved and documented.
- Record cleanup status.

## Recommended order

1. Availability bootstrap
2. Hold create
3. Booking finalize
4. Media metadata
5. Checkout
6. Stripe webhook replay
7. Notification processing

## Aggregate summary format

json {   "runId": "TODO",   "commit": "TODO",   "environment": "staging",   "startedAt": "TODO",   "finishedAt": "TODO",   "scenarios": [],   "passed": false,   "failedScenarios": [],   "dashboardLink": "TODO",   "decision": "TODO" } 

---

# Data safety and cleanup

Load tests must not leave uncontrolled launch-env clutter.

| Data type | Cleanup requirement |
|---|---|
| Users | Prefer reusable test users or generated users marked with run ID. |
| Phones/emails | Use test/sink credentials. Do not spam real numbers/emails. |
| Holds | Expire naturally or cleanup by run ID if supported. |
| Bookings | Use isolated test pro/client/service data and cleanup/anonymize if needed. |
| Media rows | Cleanup metadata and storage objects if created. |
| Stripe objects | Use test mode and idempotency keys. |
| Notifications | Use sink/test mode or fixture-only processing. |

Every script should include a runId in generated data where possible.

## Privacy safety

Load scripts must not print:

- Raw passwords
- Tokens
- Stripe secrets
- Webhook secrets
- Supabase service role keys
- PII AEAD/HMAC keys
- Full address payloads
- Raw private media paths
- Signed private media URLs
- Full provider response bodies if they contain sensitive values

## Recording evidence

Use this template after each staging run.

md ## Load evidence: <scenario>  Status: PASS / FAIL / BLOCKED   Owner: Tori   Commit: TODO   Environment: staging   Date: TODO   Command: TODO   Dashboard link: TODO   Script: TODO    ### Summary  Total requests: TODO   Successes: TODO   Expected rate limits/conflicts: TODO   Real failures: TODO   p50 latency: TODO   p95 latency: TODO   p99 latency: TODO    ### Data cleanup  Required: yes/no   Completed: yes/no   Notes: TODO    ### Decision  TODO  ### Follow-up  TODO 

## Public rollout requirement

Public rollout remains blocked until:

- Required load-test scripts exist.
- test:load:launch exists.
- Staging load proof is recorded.
- Booking finalize and Stripe webhook replay have no correctness failures.
- Media/private-media load proof does not expose private data.
- Notification load proof does not spam real users.
- Load results are linked in go-no-go.md.
- Any remaining load risk is listed in risk-register.md.

## Related documents

- docs/launch-readiness/go-no-go.md
- docs/launch-readiness/private-beta-checklist.md
- docs/launch-readiness/public-rollout-checklist.md
- docs/launch-readiness/risk-register.md
- docs/launch-readiness/sentry-dashboard.md
- docs/launch-readiness/slack-alerts.md
- tests/load/signup-load-test.ts

## Maintenance rule

Do not mark load proof complete because a script exists. A load test counts only after it runs against the intended environment, produces a summary, avoids unsafe data, and links dashboard evidence.