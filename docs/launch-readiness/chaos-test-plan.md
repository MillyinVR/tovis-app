# Chaos Test Plan

## Status

Phase: Phase 2 — Launch ops proof  
Scope: Private beta and public rollout failure-mode readiness  
Current default status: PASS LOCALLY / OPERATIONAL PROOF STILL OPEN  
Primary owner: Tori  
Target test style: Deterministic Vitest/service tests first  
Target environment: Local/test harness first, staging-safe proof where applicable  
Production chaos testing: Not allowed unless explicitly approved and isolated

This document defines the failure-mode tests required before public rollout. Load tests prove TOVIS can handle pressure. Chaos tests prove TOVIS fails safely when dependencies degrade, time out, duplicate, or return nonsense like a tiny API goblin with a vendetta.

## Current Phase 2 chaos baseline

| Item | Current state |
|---|---|
| Latest audited Phase 2 code commit | `ae30aff20aff8b205e65f57bf3ae8b5b8b553b29` |
| Proof-recording commit | `5dc37c1` — `Record Phase 2 launch ops local proof` |
| Date verified | 2026-06-07 |
| Chaos suite status | PASS LOCALLY |
| Command | `pnpm test:chaos` |
| Local result | 6 chaos files passed / 17 tests passed |
| Aggregate launch ops proof | `pnpm verify:launch-ops` passed locally; evidence recorded in `docs/launch-readiness/test-proof.md` |
| Public rollout status | Still NO-GO until operational dashboard/alert/staging proof is complete |
| Remaining chaos-related proof | Rerun on final rollout commit, link dashboard/alert/runbook evidence, resolve DB replica-lag/stale-read scope |

Local chaos proof is not the same as deployed operational proof. The suite proves deterministic failure behavior in the repo/test harness. Public rollout still requires current evidence, alert/runbook mapping, and go/no-go signoff.

## Chaos test rule

A chaos scenario is not complete for public rollout unless it has:

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
- Evidence from a passing run on the intended launch commit

Do not break real staging providers unless the test is isolated, reversible, and explicitly approved.

A chaos scenario can be marked PASS LOCALLY when deterministic test coverage exists and pnpm test:chaos passes. It should not be marked fully operationalized until dashboard/alert/runbook evidence is linked.

## Current status summary

| Scenario | Test path | Status | Launch impact |
|---|---|---|---|
| Redis outage | tests/chaos/redis-outage.test.ts | PASS LOCALLY | Required before public rollout; alert routing still needs proof |
| Supabase Storage outage | tests/chaos/supabase-storage-outage.test.ts | PASS LOCALLY | Required before public rollout; deployed storage/provider proof still needed |
| Stripe webhook storm | tests/chaos/stripe-webhook-storm.test.ts | PASS LOCALLY | Required before public rollout; dashboard/provider alert proof still needed |
| Postmark degradation | tests/chaos/postmark-degradation.test.ts | PASS LOCALLY | Required before public rollout if email enabled |
| Twilio degradation | tests/chaos/twilio-degradation.test.ts | PASS LOCALLY | Required before public rollout if SMS enabled |
| DB degradation | tests/chaos/db-degradation.test.ts | PASS LOCALLY | Required before public rollout; confirm whether explicit replica-lag proof is separately required |
| DB replica lag/stale-read behavior | TODO / PARTIAL | PARTIAL | Generic DB degradation is covered; explicit replica-lag/stale-read proof needs confirmation |
| Shared chaos harness/helpers | tests/chaos/* | IMPLEMENTED | Keep reusable helpers deterministic and provider-safe |

## Required package scripts

These scripts now exist:

```json
{
  "test:chaos": "vitest run --config vitest.config.mts tests/chaos",
  "verify:launch-ops": "pnpm test:chaos && pnpm test:load:launch"
}
```

`verify:launch-ops` passed locally on 2026-06-07 against audited code commit `ae30aff20aff8b205e65f57bf3ae8b5b8b553b29`; proof was recorded in commit `5dc37c1`.

Before public rollout, rerun these scripts on the final rollout commit and record the output:

```bash
pnpm test:chaos
pnpm verify:launch-ops
```

If rollout proof uses a staging-config command with required database or provider env values, record the exact command, environment, commit, and output in docs/launch-readiness/test-proof.md and docs/launch-readiness/go-no-go.md.

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
- Calling a provider outage “tested” just because the provider dashboard exists. Cute, but no.

## Global chaos requirements

Every chaos test should prove:

| Requirement | Expected behavior |
|---|---|
| Dependency fails or degrades | Test injects timeout, 5xx, invalid response, duplicate event, or lag. |
| App does not leak PII | Errors/logs do not expose secrets, addresses, raw tokens, signed URLs, or private paths. |
| App fails safely | High-risk paths fail closed or degrade according to documented route policy. |
| User-facing response is safe | Response does not expose internals or misleading success. |
| Error is observable | Sentry/log/event path records useful redacted diagnostic data where applicable. |
| Alert mapping exists | Related Slack alert exists or TODO is tracked. |
| Runbook exists | Related runbook is linked or missing runbook is tracked. |
| Recovery path is defined | Manual or automatic recovery behavior is documented. |

---

# Scenario 1 — Redis outage

## Status

| Field | Value |
|---|---|
| Test path | tests/chaos/redis-outage.test.ts |
| Status | PASS LOCALLY |
| Owner | Tori |
| Severity | High |
| Related runbook | docs/runbooks/redis-outage.md |
| Related alert | docs/launch-readiness/slack-alerts.md |
| Related risk | RISK-022 |
| Public rollout state | Required; local proof exists, alert-routing proof still open |

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
- Public rollout proof is recorded against the rollout commit.

## Current evidence

```text
Status: PASS LOCALLY
Command: pnpm test:chaos
Audited code commit: ae30aff20aff8b205e65f57bf3ae8b5b8b553b29
Proof-recording commit: 5dc37c1
Date: 2026-06-07
Environment: local/test harness
Result: Included in 6 passing chaos files / 17 passing chaos tests
Alert routing: TODO / BLOCKED
Runbook: docs/runbooks/redis-outage.md
Decision: Local proof accepted; operational alert proof still required.
```

---

# Scenario 2 — Supabase Storage outage

## Status

| Field | Value |
|---|---|
| Test path | tests/chaos/supabase-storage-outage.test.ts |
| Status | PASS LOCALLY |
| Owner | Tori |
| Severity | High |
| Related runbook | docs/runbooks/supabase-storage-outage.md |
| Related alert | docs/launch-readiness/slack-alerts.md |
| Related risk | RISK-020 |
| Public rollout state | Required; local proof exists, deployed storage/provider proof still open |

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
- Deployed storage policy proof is recorded before public rollout.

## Current evidence

```text
Status: PASS LOCALLY
Command: pnpm test:chaos
Audited code commit: ae30aff20aff8b205e65f57bf3ae8b5b8b553b29
Proof-recording commit: 5dc37c1
Date: 2026-06-07
Environment: local/test harness
Result: Included in 6 passing chaos files / 17 passing chaos tests
Alert routing: TODO / BLOCKED
Runbook: docs/runbooks/supabase-storage-outage.md
Decision: Local proof accepted; deployed storage/provider proof still required.
```

---

# Scenario 3 — Stripe webhook storm

## Status

| Field | Value |
|---|---|
| Test path | tests/chaos/stripe-webhook-storm.test.ts |
| Status | PASS LOCALLY |
| Owner | Tori |
| Severity | Critical |
| Related runbook | docs/runbooks/stripe-degradation.md |
| Related alert | docs/launch-readiness/slack-alerts.md |
| Related risk | RISK-019 |
| Public rollout state | Required; local proof exists, Stripe/Sentry alert proof still open |

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
- Stripe/Sentry dashboard evidence is linked before public rollout.

## Current evidence

```text
Status: PASS LOCALLY
Command: pnpm test:chaos
Audited code commit: ae30aff20aff8b205e65f57bf3ae8b5b8b553b29
Proof-recording commit: 5dc37c1
Date: 2026-06-07
Environment: local/test harness
Result: Included in 6 passing chaos files / 17 passing chaos tests
Alert routing: TODO / BLOCKED
Runbook: docs/runbooks/stripe-degradation.md
Decision: Local proof accepted; operational webhook alert/dashboard proof still required.
```

---

# Scenario 4 — Postmark degradation

## Status

| Field | Value |
|---|---|
| Test path | tests/chaos/postmark-degradation.test.ts |
| Status | PASS LOCALLY |
| Owner | Tori |
| Severity | Medium |
| Related runbook | docs/runbooks/postmark-degradation.md |
| Related alert | docs/launch-readiness/slack-alerts.md |
| Related risk | RISK-021 |
| Public rollout state | Required if email enabled; local proof exists, provider/alert proof still open |

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
- Postmark dashboard/alert mapping is linked if email is enabled.

## Current evidence

```text
Status: PASS LOCALLY
Command: pnpm test:chaos
Audited code commit: ae30aff20aff8b205e65f57bf3ae8b5b8b553b29
Proof-recording commit: 5dc37c1
Date: 2026-06-07
Environment: local/test harness
Result: Included in 6 passing chaos files / 17 passing chaos tests
Alert routing: TODO / BLOCKED
Runbook: docs/runbooks/postmark-degradation.md
Decision: Local proof accepted; provider dashboard and alert proof still required if email is enabled.
```

---

# Scenario 5 — Twilio degradation

## Status

| Field | Value |
|---|---|
| Test path | tests/chaos/twilio-degradation.test.ts |
| Status | PASS LOCALLY |
| Owner | Tori |
| Severity | Medium |
| Related runbook | docs/runbooks/twilio-degradation.md |
| Related alert | docs/launch-readiness/slack-alerts.md |
| Related risk | RISK-021 |
| Public rollout state | Required if SMS enabled; local proof exists, provider/alert proof still open |

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
- Twilio dashboard/alert mapping is linked if SMS is enabled.

## Current evidence

```text
Status: PASS LOCALLY
Command: pnpm test:chaos
Audited code commit: ae30aff20aff8b205e65f57bf3ae8b5b8b553b29
Proof-recording commit: 5dc37c1
Date: 2026-06-07
Environment: local/test harness
Result: Included in 6 passing chaos files / 17 passing chaos tests
Alert routing: TODO / BLOCKED
Runbook: docs/runbooks/twilio-degradation.md
Decision: Local proof accepted; provider dashboard and alert proof still required if SMS is enabled.
```

---

# Scenario 6 — DB degradation / stale-read behavior

## Status

| Field | Value |
|---|---|
| Current test path | tests/chaos/db-degradation.test.ts |
| Previous planned path | tests/chaos/db-replica-lag.test.ts |
| Status | PASS LOCALLY for DB degradation; PARTIAL for explicit replica-lag proof |
| Owner | Tori |
| Severity | Critical |
| Related runbook | docs/runbooks/postgres-outage.md |
| Related alert | docs/launch-readiness/slack-alerts.md |
| Related risk | RISK-018 |
| Public rollout state | Required; confirm whether explicit replica-lag/stale-read test is needed beyond DB degradation test |

## Purpose

Prove launch-critical writes and post-write reads do not rely on stale or degraded database state in ways that corrupt booking, payment, or lifecycle behavior.

## Failure modes

- Database unavailable
- Database timeout
- Database write failure
- Database read failure
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
- DB degradation does not corrupt booking/payment/session state.
- Stale reads do not corrupt booking/payment/session state if replica-lag behavior is in scope.
- Safe stale-read areas are documented.
- Test passes through pnpm test:chaos.
- Any gap between generic DB degradation and explicit replica-lag coverage is documented.

## Current evidence

```text
Status: PASS LOCALLY for DB degradation
Command: pnpm test:chaos
Audited code commit: ae30aff20aff8b205e65f57bf3ae8b5b8b553b29
Proof-recording commit: 5dc37c1
Date: 2026-06-07
Environment: local/test harness
Result: Included in 6 passing chaos files / 17 passing chaos tests
Alert routing: TODO / BLOCKED
Runbook: docs/runbooks/postgres-outage.md
Decision: Local DB degradation proof accepted; explicit replica-lag/stale-read proof needs confirmation before public rollout.
```

## Follow-up decision needed

Decide whether public rollout requires a separate db-replica-lag.test.ts.

Recommended treatment:

- If TOVIS is not using read replicas in the launch environment: mark explicit replica-lag proof as DEFERRED with note “no read replica enabled for launch.”
- If DATABASE_URL_READ or read replica support is enabled in launch/staging: add explicit stale-read tests or proof before public rollout.
- If the existing db-degradation.test.ts already covers stale-read semantics, update this section with the exact test cases and mark replica-lag proof PASS LOCALLY.

---

# Shared chaos harness

## Current status

| Field | Value |
|---|---|
| Status | IMPLEMENTED / KEEP MAINTAINED |
| Location | tests/chaos/* |
| Owner | Tori |
| Public rollout state | Harness exists enough for current passing suite; keep helpers deterministic and reusable |

## Required helper behavior

The chaos harness should provide or preserve:

- Provider failure injection helpers
- Timeout helpers
- Fake provider clients
- Safe error assertions
- Redaction assertions
- Alert/event assertion helpers where feasible
- Reusable result summary helper

## Suggested helper names

```ts
createFailingProviderClient
createTimeoutProviderClient
createFlakyProviderClient
expectSafeErrorResponse
expectNoSensitiveValues
expectRetryOrManualFollowUp
expectNoDoubleMutation
```

The exact helper names do not matter as much as the behavior. No sacred cows here. Just make the tests readable, deterministic, and mean enough to catch regressions.

## Sensitive values to block in chaos output

Chaos tests must not print:

- Raw passwords
- Session tokens
- Reset tokens
- Client action tokens
- Claim tokens
- Invite tokens
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

```md
## Chaos evidence: <scenario>

Status: PASS / FAIL / BLOCKED / ACCEPTED RISK
Owner: Tori
Commit: TODO
Environment: local/test/staging
Date: TODO
Command: TODO
Test path: TODO
Related alert: TODO
Related runbook: TODO
Related risk: TODO

### Failure injected

TODO

### Expected safe behavior

TODO

### Observed behavior

TODO

### PII/log safety

TODO

### Recovery path

TODO

### Decision

TODO

### Follow-up

TODO
```

## Current local command proof

```text
Command: pnpm test:chaos
Audited code commit: ae30aff20aff8b205e65f57bf3ae8b5b8b553b29
Proof-recording commit: 5dc37c1
Date: 2026-06-07
Environment: local/test harness
Total test files: 6 passed
Total tests: 17 passed
Failures: 0
Skipped: 0
Decision: PASS LOCALLY
```

## Required command proof before public rollout

Before public rollout, record a fresh run on the intended rollout commit:

```bash
pnpm test:chaos
pnpm verify:launch-ops
```

Expected evidence:

```text
Command:
Commit:
Environment:
Total test files:
Total tests:
Failures:
Skipped:
Decision:
```

## Where to record evidence

Record final proof in:

- docs/launch-readiness/test-proof.md
- docs/launch-readiness/go-no-go.md
- docs/launch-readiness/risk-register.md
- This file, if scenario-specific details changed

---

# Launch treatment

| Launch stage | Chaos requirement |
|---|---|
| Private beta | Local chaos proof is a strong support signal. Runbooks and alert mappings must exist. Any missing operational alert proof must be explicitly accepted as a private-beta risk. |
| Public rollout | Required chaos scenarios must pass on the rollout commit or be explicitly accepted with mitigation. Critical scenarios cannot be casually accepted. |

## Private beta treatment

Private beta may proceed with local chaos proof if:

- pnpm test:chaos passes on the beta commit.
- Required runbooks exist.
- Related alerts are mapped, even if routing is blocked.
- Alert-routing gap is explicitly documented in go-no-go.md.
- Risk register has no unowned High/Critical blocker.
- The beta cohort is small and support coverage is defined.

## Public rollout treatment

Public rollout requires:

- pnpm test:chaos passes on the rollout commit.
- pnpm verify:launch-ops passes on the rollout commit/environment.
- Related P1/P2 alerts have thresholds.
- Related P1/P2 alerts route to Slack or approved escalation path.
- Runbooks are linked from alerts.
- Backup owner exists.
- P1 escalation path is tested.
- DB replica-lag/stale-read scope is resolved.

---

# Automatic public rollout NO-GO

Public rollout is blocked if:

- Redis outage behavior is untested or failing.
- Storage outage behavior is untested or failing.
- Stripe webhook storm/idempotency behavior is untested or failing.
- DB degradation behavior is untested or failing.
- DB replica-lag/stale-read behavior is required but unresolved.
- Private media failure behavior is untested or failing.
- Notification provider degradation is untested while notifications are enabled.
- Chaos tests leak PII/secrets in output.
- Chaos test failures are unowned.
- Related P1/P2 alerts lack runbooks.
- Related P1/P2 alerts cannot route to an approved alert destination.
- No backup owner exists for public rollout.
- P1 escalation has not been tested.

---

# Related documents

- docs/launch-readiness/oncall.md
- docs/launch-readiness/go-no-go.md
- docs/launch-readiness/private-beta-checklist.md
- docs/launch-readiness/public-rollout-checklist.md
- docs/launch-readiness/risk-register.md
- docs/launch-readiness/sentry-dashboard.md
- docs/launch-readiness/slack-alerts.md
- docs/launch-readiness/load-test-plan.md
- docs/launch-readiness/test-proof.md
- docs/runbooks/redis-outage.md
- docs/runbooks/postgres-outage.md
- docs/runbooks/supabase-storage-outage.md
- docs/runbooks/stripe-degradation.md
- docs/runbooks/postmark-degradation.md
- docs/runbooks/twilio-degradation.md
- docs/runbooks/private-media-incident.md
- docs/runbooks/notification-backlog.md

---

# Maintenance rule

Do not mark chaos proof complete because a test file exists.

A chaos scenario counts as PASS LOCALLY only when it injects the failure, proves safe behavior, avoids PII leakage, links to the expected alert/runbook, and passes through pnpm test:chaos.

A chaos scenario counts as public-rollout ready only when the passing evidence is recorded against the rollout commit and the operational path is linked. Local proof is excellent. Operational proof is the bouncer at the door.