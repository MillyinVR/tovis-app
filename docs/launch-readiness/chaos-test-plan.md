# Chaos Test Plan

## Status

Phase: Phase 2 — Launch ops proof  
Scope: Private beta and public rollout failure-mode readiness  
Current default status: TODO — required chaos/failure proof is not complete  
Primary owner: Tori  
Target test style: Deterministic Vitest/service tests first  
Target environment: Local/test harness first, staging-safe proof where applicable  
Production chaos testing: Not allowed unless explicitly approved and isolated

This document defines the failure-mode tests required before public rollout. Load tests prove TOVIS can handle pressure. Chaos tests prove TOVIS fails safely when dependencies degrade, time out, duplicate, or return nonsense like a tiny API goblin with a vendetta.

## Chaos test rule

A chaos scenario is not complete unless it has:

- Test path
- Owner
- Dependency/failure mode
- Expected safe behavior
- Expected user-facing behavior
- Expected logging/alerting behavior
- Related runbook
- Pass/fail criteria
- Staging-safe verification plan, if applicable
- Risk-register link
- Evidence from a passing run

Do not break real staging providers unless the test is isolated, reversible, and explicitly approved.

## Current status summary

| Scenario | Test path | Status | Launch impact |
|---|---|---|---|
| Redis outage | tests/chaos/redis-outage.test.ts | TODO | Required before public rollout |
| Supabase Storage outage | tests/chaos/storage-outage.test.ts | TODO | Required before public rollout |
| Stripe webhook storm | tests/chaos/stripe-webhook-storm.test.ts | TODO | Required before public rollout |
| Postmark degradation | tests/chaos/postmark-degradation.test.ts | TODO | Required before public rollout if email enabled |
| Twilio degradation | tests/chaos/twilio-degradation.test.ts | TODO | Required before public rollout if SMS enabled |
| DB replica lag/stale-read behavior | tests/chaos/db-replica-lag.test.ts | TODO | Required before public rollout |
| Shared chaos harness | tests/chaos/chaosTestHarness.ts | TODO | Required before scenario tests |

## Required package scripts

Add these scripts when the chaos tests exist:

json id="zy0vcr" {   "test:chaos": "vitest run --config vitest.config.mts tests/chaos",   "verify:launch-ops": "pnpm test:chaos && pnpm test:load:launch" } 

verify:launch-ops should not be considered complete until both chaos and load suites exist.

## Preferred testing strategy

Use this order:

1. Unit/service-level deterministic tests with mocked provider boundaries.
2. Route-level tests with provider clients mocked to fail or degrade.
3. Staging-safe synthetic checks where applicable.
4. Manual runbook exercise only where automation is not safe yet.

Avoid:

- Breaking real staging provider integrations casually.
- Sending real SMS/email during chaos runs.
- Creating real payment side effects.
- Printing secrets or PII.
- Writing test failures that depend on provider luck.

## Global chaos requirements

Every chaos test should prove:

| Requirement | Expected behavior |
|---|---|
| Dependency fails or degrades | Test injects timeout, 5xx, invalid response, duplicate event, or lag. |
| App does not leak PII | Errors/logs do not expose secrets, addresses, raw tokens, signed URLs, or private paths. |
| App fails safely | High-risk paths fail closed or degrade according to documented route policy. |
| User-facing response is safe | Response does not expose internals or misleading success. |
| Error is observable | Sentry/log/event path records useful redacted diagnostic data. |
| Alert mapping exists | Related Slack alert exists or TODO is tracked. |
| Runbook exists | Related runbook is linked or missing runbook is tracked. |
| Recovery path is defined | Manual or automatic recovery behavior is documented. |

---

# Scenario 1 — Redis outage

## Status

| Field | Value |
|---|---|
| Test path | tests/chaos/redis-outage.test.ts |
| Status | TODO |
| Owner | Tori |
| Severity | High |
| Related runbook | docs/runbooks/redis-outage.md |
| Related alert | docs/launch-readiness/slack-alerts.md |
| Related risk | RISK-022 |

## Purpose

Prove Redis/rate-limit degradation does not make high-risk routes unsafe.

## Failure modes

- Redis unavailable
- Redis timeout
- Redis returns malformed response
- Rate-limit backend unavailable
- Versioned/cache lookup unavailable, where applicable

## Expected behavior

| Area | Expected behavior |
|---|---|
| High-risk auth/SMS/token routes | Fail closed or degrade according to route policy. |
| Booking mutation routes | Do not bypass safety checks because Redis is down. |
| User response | Safe, generic error or expected rate-limit failure. |
| Logging | Redacted diagnostic data only. |
| Alerting | Redis/rate-limit alert should fire or be testable. |

## Pass criteria

- No high-risk route fails open.
- No raw token/PII leaks.
- Safe error response is returned.
- Related alert/runbook mapping exists.
- Test passes through pnpm test:chaos.

## Evidence template

text id="jlx4hu" Command: Commit: Environment: Failure injected: Routes tested: Expected failures: Unexpected failures: PII/log safety: Alert mapping: Runbook: Decision: 

---

# Scenario 2 — Supabase Storage outage

## Status

| Field | Value |
|---|---|
| Test path | tests/chaos/storage-outage.test.ts |
| Status | TODO |
| Owner | Tori |
| Severity | High |
| Related runbook | docs/runbooks/supabase-storage-outage.md |
| Related alert | docs/launch-readiness/slack-alerts.md |
| Related risk | RISK-020 |

## Purpose

Prove storage failures do not create unsafe media state or private-media leaks.

## Failure modes

- Storage upload signing fails
- Storage provider returns 5xx
- Storage provider times out
- Metadata write succeeds but object operation fails
- Object operation succeeds but metadata write fails
- Private media access check fails

## Expected behavior

| Area | Expected behavior |
|---|---|
| Upload initiation | Returns safe retryable error. |
| Metadata persistence | Does not claim success for missing/failed object. |
| Private media | No public access regression. |
| Cleanup | Orphan metadata/object state is prevented or detectable. |
| Logging | No signed URL/private path leak. |
| Alerting | Storage/media alert should fire or be testable. |

## Pass criteria

- No fake successful media state.
- No private media access leak.
- No signed URL/private path logged.
- Cleanup or orphan prevention is documented.
- Test passes through pnpm test:chaos.

---

# Scenario 3 — Stripe webhook storm

## Status

| Field | Value |
|---|---|
| Test path | tests/chaos/stripe-webhook-storm.test.ts |
| Status | TODO |
| Owner | Tori |
| Severity | Critical |
| Related runbook | docs/runbooks/stripe-degradation.md |
| Related alert | docs/launch-readiness/slack-alerts.md |
| Related risk | RISK-019 |

## Purpose

Prove repeated, duplicated, delayed, or invalid Stripe webhook events do not corrupt booking/payment state.

## Failure modes

- Duplicate valid webhook events
- High-volume replay of same event
- Out-of-order webhook delivery
- Invalid signature
- Valid signature but unsupported event type
- Provider retry storm
- Processing timeout

## Expected behavior

| Area | Expected behavior |
|---|---|
| Signature verification | Invalid signatures rejected. |
| Replay/dedupe | Duplicate valid events do not double-mutate state. |
| Payment state | No double charge, double booking, or unsafe state transition. |
| Booking state | Final booking state remains consistent. |
| Logging | No webhook secret or raw sensitive payload leaked. |
| Alerting | Webhook failure/storm alert should fire or be testable. |

## Pass criteria

- Invalid signatures fail.
- Duplicate events dedupe safely.
- No double mutation.
- Idempotency path is proven.
- Test passes through pnpm test:chaos.

---

# Scenario 4 — Postmark degradation

## Status

| Field | Value |
|---|---|
| Test path | tests/chaos/postmark-degradation.test.ts |
| Status | TODO |
| Owner | Tori |
| Severity | Medium |
| Related runbook | docs/runbooks/postmark-degradation.md |
| Related alert | docs/launch-readiness/slack-alerts.md |
| Related risk | RISK-021 |

## Purpose

Prove email failures are visible, retryable or manually recoverable, and do not block unrelated critical flows unnecessarily.

## Failure modes

- Postmark returns 5xx
- Postmark times out
- Postmark rejects request
- Partial delivery failure
- Provider degradation across repeated attempts

## Expected behavior

| Area | Expected behavior |
|---|---|
| Email send | Failure is recorded. |
| Retry/manual follow-up | Retry or manual follow-up path is visible. |
| User response | Flow does not pretend email was sent if it was not. |
| Logging | No raw email payload or sensitive values leaked. |
| Alerting | Postmark degradation alert should fire or be testable. |

## Pass criteria

- Failure is observable.
- Retry/manual-follow-up path is documented.
- No spam to real users.
- No PII leakage.
- Test passes through pnpm test:chaos.

---

# Scenario 5 — Twilio degradation

## Status

| Field | Value |
|---|---|
| Test path | tests/chaos/twilio-degradation.test.ts |
| Status | TODO |
| Owner | Tori |
| Severity | Medium |
| Related runbook | docs/runbooks/twilio-degradation.md |
| Related alert | docs/launch-readiness/slack-alerts.md |
| Related risk | RISK-021 |

## Purpose

Prove SMS failures are visible, rate-limited, retryable or manually recoverable, and do not create unsafe auth or notification behavior.

## Failure modes

- Twilio returns 5xx
- Twilio times out
- Twilio rejects number/message
- Partial delivery failure
- Provider degradation across repeated attempts
- SMS route under Redis/rate-limit degradation

## Expected behavior

| Area | Expected behavior |
|---|---|
| SMS send | Failure is recorded. |
| Rate limits | SMS route does not fail open. |
| Retry/manual follow-up | Retry or manual follow-up path is visible. |
| User response | Safe failure response if SMS is required. |
| Logging | No raw verification/token values leaked. |
| Alerting | Twilio degradation alert should fire or be testable. |

## Pass criteria

- Failure is observable.
- No unsafe auth/SMS behavior.
- Retry/manual-follow-up path is documented.
- No real-user spam.
- Test passes through pnpm test:chaos.

---

# Scenario 6 — DB replica lag / stale-read behavior

## Status

| Field | Value |
|---|---|
| Test path | tests/chaos/db-replica-lag.test.ts |
| Status | TODO |
| Owner | Tori |
| Severity | Critical |
| Related runbook | docs/runbooks/postgres-outage.md |
| Related alert | docs/launch-readiness/slack-alerts.md |
| Related risk | RISK-018 |

## Purpose

Prove launch-critical writes and post-write reads do not rely on stale replica state in ways that corrupt booking, payment, or lifecycle behavior.

## Failure modes

- Read replica lags behind primary
- Post-write read sees stale data
- Booking finalize depends on stale availability/hold state
- Payment webhook reads stale booking/payment state
- Session lifecycle reads stale booking state
- Search/display reads stale state but can safely tolerate it

## Expected behavior

| Area | Expected behavior |
|---|---|
| Critical writes | Use primary/source-of-truth path. |
| Booking finalize | Does not finalize from stale hold/availability state. |
| Payment webhook | Does not double-mutate from stale state. |
| Pro session lifecycle | Does not complete illegal state from stale read. |
| User-facing reads | May be stale only where explicitly safe. |
| Alerting | DB/latency/stale-read risk is observable or documented. |

## Pass criteria

- Critical paths are primary-backed or otherwise protected.
- Stale reads do not corrupt booking/payment/session state.
- Safe stale read areas are documented.
- Test passes through pnpm test:chaos.

---

# Shared chaos harness

## Target file

tests/chaos/chaosTestHarness.ts

## Required helpers

The harness should provide:

- Provider failure injection helpers
- Timeout helpers
- Fake provider clients
- Safe error assertions
- Redaction assertions
- Alert/event assertion helpers where feasible
- Reusable result summary helper

## Suggested helper names

ts id="g69lb9" createFailingProviderClient createTimeoutProviderClient createFlakyProviderClient expectSafeErrorResponse expectNoSensitiveValues expectRetryOrManualFollowUp expectNoDoubleMutation 

## Sensitive values to block in chaos output

Chaos tests must not print:

- Raw passwords
- Session tokens
- Reset tokens
- Client action tokens
- Stripe secrets or webhook secrets
- Supabase service role keys
- PII AEAD keys
- PII HMAC lookup keys
- Full addresses
- Raw email/phone values
- Signed private media URLs
- Private storage paths
- Full webhook payloads containing sensitive fields

---

# Evidence recording

Use this template for each chaos proof.

md id="f5egjc" ## Chaos evidence: <scenario>  Status: PASS / FAIL / BLOCKED   Owner: Tori   Commit: TODO   Environment: local/test/staging   Date: TODO   Command: TODO   Test path: TODO   Related alert: TODO   Related runbook: TODO   Related risk: TODO    ### Failure injected  TODO  ### Expected safe behavior  TODO  ### Observed behavior  TODO  ### PII/log safety  TODO  ### Recovery path  TODO  ### Decision  TODO  ### Follow-up  TODO 

## Required command proof

Before public rollout, record:

bash pnpm test:chaos 

Expected evidence:

text id="f3vqs4" Command: Commit: Environment: Total test files: Total tests: Failures: Skipped: Decision: 

## Launch treatment

| Launch stage | Chaos requirement |
|---|---|
| Private beta | Runbooks and alert mappings must exist. Deterministic chaos tests can still be in progress if risk is accepted. |
| Public rollout | Required chaos scenarios must pass or be explicitly accepted with mitigation. Critical scenarios cannot be casually accepted. |

## Automatic public rollout NO-GO

Public rollout is blocked if:

- Redis outage behavior is untested.
- Storage outage behavior is untested.
- Stripe webhook storm/idempotency behavior is untested.
- DB replica lag/stale-read behavior is untested.
- Private media failure behavior is untested.
- Notification provider degradation is untested while notifications are enabled.
- Chaos tests leak PII/secrets in output.
- Chaos test failures are unowned.
- Related P1/P2 alerts lack runbooks.

## Related documents

- docs/launch-readiness/oncall.md
- docs/launch-readiness/go-no-go.md
- docs/launch-readiness/private-beta-checklist.md
- docs/launch-readiness/public-rollout-checklist.md
- docs/launch-readiness/risk-register.md
- docs/launch-readiness/sentry-dashboard.md
- docs/launch-readiness/slack-alerts.md
- docs/launch-readiness/load-test-plan.md
- docs/runbooks/redis-outage.md
- docs/runbooks/postgres-outage.md
- docs/runbooks/supabase-storage-outage.md
- docs/runbooks/stripe-degradation.md
- docs/runbooks/postmark-degradation.md
- docs/runbooks/twilio-degradation.md
- docs/runbooks/private-media-incident.md
- docs/runbooks/notification-backlog.md

## Maintenance rule

Do not mark chaos proof complete because a test file exists. A chaos scenario counts only when it injects the failure, proves safe behavior, avoids PII leakage, links to an alert/runbook, and records evidence.