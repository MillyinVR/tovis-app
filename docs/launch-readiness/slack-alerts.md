# Slack Alert Map

## Status

Phase: Phase 2 — Launch ops proof  
Scope: Private beta alert routing and public-launch escalation readiness  
Primary private-beta alert destination: Slack-first  
Public rollout requirement: P1 escalation path must be stronger than passive Slack-only monitoring unless explicitly accepted in go-no-go.md  
Primary owner: Tori  
Backup owner: TODO — public rollout blocker  
Current default status: BLOCKED — Sentry-to-Slack routing requires a paid Sentry plan or an alternate alerting path before it can be tested.

## Current blocker

Sentry-to-Slack alert routing is currently blocked because the required Sentry plan is not available yet. This does not block the Sentry release/environment metadata work, but it does block private-beta alert proof until Sentry is upgraded or an alternate alerting path is chosen.

## Alert readiness rule

An alert is not launch-ready unless it has:

- Severity
- Owner
- Backup status
- Slack destination
- Source signal
- Threshold
- Dashboard link
- Runbook link
- Escalation path
- Launch impact
- Verification step

No orphan alerts. No alert should exist without a human who knows what to do with it.

## Slack destinations

| Destination | Purpose | Status | Notes |
|---|---|---|---|
| `#tovis-ops-alerts` | Proposed private-beta alert channel | BLOCKED | Sentry-to-Slack routing requires a paid Sentry plan or alternate alerting path before this can be tested. |
| `#tovis-beta-support` | Proposed beta support/feedback channel | TODO | Optional if support uses another path. |
| `#tovis-incidents` | Proposed incident coordination channel | TODO | Optional for private beta, recommended before public rollout. |
| Direct owner notification | Backup path for P1 during private beta | TODO | Can be used temporarily, but does not replace tested alert routing. |
| PagerDuty/Opsgenie/equivalent | Public rollout P1 escalation | BLOCKED | Required before public rollout unless waived in `go-no-go.md`. |

## Severity routing

| Severity | Slack routing | Required response | Public rollout requirement |
|---|---|---|---|
| P1 | Ops alerts + incident channel + owner ping | Immediate acknowledgement | Tested escalation path required |
| P2 | Ops alerts | Same-day acknowledgement during beta support hours | Alert owner and runbook required |
| P3 | Ops alerts or ticket/follow-up | Triage during working hours | Can be ticket-only if documented |

## Response-time targets

| Severity | Private beta target | Public rollout target |
|---|---:|---:|
| P1 | Acknowledge within 15 minutes during support window | Acknowledge within 5 minutes |
| P2 | Acknowledge same day during support window | Acknowledge within 30 minutes during coverage |
| P3 | Review during next working session | Review within one business day |

These are initial targets. Tighten them when there is a named backup owner and tested public escalation.

## Alert ownership summary

| Alert area | Primary owner | Backup | Status |
|---|---|---|---|
| Health/readiness | Tori | TODO | Backup blocks public rollout. |
| Database/Postgres | Tori | TODO | Backup blocks public rollout. |
| Redis/rate limits | Tori | TODO | Backup blocks public rollout. |
| Booking funnel | Tori | TODO | Backup blocks public rollout. |
| Availability | Tori | TODO | Backup blocks public rollout. |
| Pro session lifecycle | Tori | TODO | Backup blocks public rollout. |
| Media/private media | Tori | TODO | Backup blocks public rollout. |
| Payments/webhooks | Tori | TODO | Backup blocks public rollout. |
| Notifications | Tori | TODO | Backup blocks public rollout. |
| Auth/session | Tori | TODO | Backup blocks public rollout. |
| SLO/error budget | Tori | TODO | Backup blocks public rollout. |

---

# Required P1 alerts

## Alert: Readiness endpoint failing

| Field | Value |
|---|---|
| Severity | P1 |
| Owner | Tori |
| Backup | TODO |
| Slack destination | #tovis-ops-alerts |
| Source | Sentry synthetic check or health/readiness monitor |
| Dashboard | docs/launch-readiness/sentry-dashboard.md |
| Runbook | docs/runbooks/health-readiness.md |
| Threshold | TODO |
| Private beta blocker | Yes, if missing or failing |
| Public rollout blocker | Yes |
| Status | TODO |

### User impact

Users may be unable to access the app or complete core flows.

### First response

1. Confirm whether the failure is app-only or dependency-related.
2. Check health/readiness dashboard.
3. Open docs/runbooks/health-readiness.md.
4. Check recent deploy/release.
5. Decide monitor, rollback, or provider escalation.

### Verification

Trigger or simulate a staging readiness alert and confirm it routes to Slack.

---

## Alert: Database/Postgres unavailable or severe query failure

| Field | Value |
|---|---|
| Severity | P1 |
| Owner | Tori |
| Backup | TODO |
| Slack destination | #tovis-ops-alerts |
| Source | Health/readiness, Sentry errors, provider dashboard |
| Dashboard | docs/launch-readiness/sentry-dashboard.md |
| Runbook | docs/runbooks/postgres-outage.md |
| Threshold | TODO |
| Private beta blocker | Yes |
| Public rollout blocker | Yes |
| Status | TODO |

### User impact

Core app flows may fail, including auth, booking, payments, media metadata, and admin privacy actions.

### First response

1. Confirm provider status.
2. Open Postgres runbook.
3. Check whether reads, writes, or both are impacted.
4. Pause launch/rollout if active.
5. Decide rollback, maintenance, or provider escalation.

### Verification

Trigger a staging-safe database readiness failure or synthetic failure and confirm Slack routing.

---

## Alert: Redis/rate-limit safety degraded

| Field | Value |
|---|---|
| Severity | P1 |
| Owner | Tori |
| Backup | TODO |
| Slack destination | #tovis-ops-alerts |
| Source | Health/readiness, Sentry errors, rate-limit wrapper signals |
| Dashboard | docs/launch-readiness/sentry-dashboard.md |
| Runbook | docs/runbooks/redis-outage.md |
| Threshold | TODO |
| Private beta blocker | Yes |
| Public rollout blocker | Yes |
| Status | TODO |

### User impact

High-risk routes may degrade. SMS, auth, token, and booking mutation safety may be affected depending on route policy.

### First response

1. Confirm whether affected routes fail closed or degrade safely.
2. Open Redis outage runbook.
3. Check auth/rate-limit dashboard section.
4. Pause launch if high-risk routes fail open.
5. Escalate provider or disable risky flows if needed.

### Verification

Chaos test or staging-safe synthetic alert proves Redis degradation routes correctly.

---

## Alert: Booking finalize failure spike

| Field | Value |
|---|---|
| Severity | P1 |
| Owner | Tori |
| Backup | TODO |
| Slack destination | #tovis-ops-alerts |
| Source | Sentry errors/app event |
| Dashboard | docs/launch-readiness/sentry-dashboard.md |
| Runbook | TODO |
| Threshold | TODO |
| Private beta blocker | Yes |
| Public rollout blocker | Yes |
| Status | TODO |

### User impact

Clients may be unable to complete bookings. Revenue and trust path is affected.

### First response

1. Check booking funnel dashboard.
2. Confirm whether failures are validation, conflict, payment, or database related.
3. Check recent deploy.
4. Pause rollout if active.
5. If data integrity is suspected, stop booking writes until root cause is known.

### Verification

Alert must fire from staging test or synthetic failure before public rollout.

---

## Alert: Stripe webhook verification or processing failure spike

| Field | Value |
|---|---|
| Severity | P1 |
| Owner | Tori |
| Backup | TODO |
| Slack destination | #tovis-ops-alerts |
| Source | Sentry errors/app event, Stripe dashboard |
| Dashboard | docs/launch-readiness/sentry-dashboard.md |
| Runbook | docs/runbooks/stripe-degradation.md |
| Threshold | TODO |
| Private beta blocker | Yes |
| Public rollout blocker | Yes |
| Status | TODO |

### User impact

Payment state may not update correctly. Booking/payment status may become delayed or inconsistent.

### First response

1. Check Stripe dashboard and Sentry webhook errors.
2. Confirm signature verification failures versus processing failures.
3. Check idempotency/replay behavior.
4. Pause rollout if payment correctness is uncertain.
5. Follow Stripe runbook.

### Verification

Staging webhook replay proof must route failures to Slack.

---

## Alert: Private media access policy regression

| Field | Value |
|---|---|
| Severity | P1 |
| Owner | Tori |
| Backup | TODO |
| Slack destination | #tovis-ops-alerts |
| Source | Storage policy proof, Sentry errors, manual/synthetic check |
| Dashboard | docs/launch-readiness/sentry-dashboard.md |
| Runbook | docs/runbooks/private-media-incident.md |
| Threshold | Any confirmed regression |
| Private beta blocker | Yes |
| Public rollout blocker | Yes |
| Status | TODO |

### User impact

Private media may be exposed incorrectly. This is a privacy/security incident.

### First response

1. Stop rollout immediately.
2. Confirm scope and affected assets.
3. Open private media incident runbook.
4. Revoke or rotate signed access if applicable.
5. Record incident in risk register.
6. Do not resume launch until root cause is fixed and proof is rerun.

### Verification

Private media synthetic/policy proof must be linked before beta and public rollout.

---

## Alert: Auth failure spike

| Field | Value |
|---|---|
| Severity | P1 |
| Owner | Tori |
| Backup | TODO |
| Slack destination | #tovis-ops-alerts |
| Source | Sentry errors/app event |
| Dashboard | docs/launch-readiness/sentry-dashboard.md |
| Runbook | TODO |
| Threshold | TODO |
| Private beta blocker | Yes |
| Public rollout blocker | Yes |
| Status | TODO |

### User impact

Users may be unable to register, log in, reset password, or correct phone/auth information.

### First response

1. Check auth/rate-limit dashboard section.
2. Determine which auth route is failing.
3. Check recent deploy and provider dependencies.
4. Confirm HMAC contact lookup/privacy paths are not regressed.
5. Pause rollout if login/register is broadly affected.

### Verification

Synthetic auth failure alert or staging test must route to Slack.

---

# Required P2 alerts

## Alert: Hold create failure spike

| Field | Value |
|---|---|
| Severity | P2 |
| Owner | Tori |
| Backup | TODO |
| Slack destination | #tovis-ops-alerts |
| Source | Sentry errors/app event |
| Dashboard | docs/launch-readiness/sentry-dashboard.md |
| Runbook | TODO |
| Threshold | TODO |
| Private beta blocker | Yes, if missing before beta |
| Public rollout blocker | Yes |
| Status | TODO |

### User impact

Clients may be unable to reserve a slot before checkout/finalization.

### First response

1. Check booking funnel dashboard.
2. Confirm if failures are availability, hold conflict, rate-limit, or database related.
3. Check recent deploy.
4. Escalate to P1 if finalize path or broad booking flow is affected.

### Verification

Staging hold-create proof should be linked before public rollout.

---

## Alert: Availability bootstrap latency or error spike

| Field | Value |
|---|---|
| Severity | P2 |
| Owner | Tori |
| Backup | TODO |
| Slack destination | #tovis-ops-alerts |
| Source | Sentry performance/errors |
| Dashboard | docs/launch-readiness/sentry-dashboard.md |
| Runbook | docs/runbooks/health-readiness.md |
| Threshold | TODO |
| Private beta blocker | Yes |
| Public rollout blocker | Yes |
| Status | TODO |

### User impact

Clients may see slow or failed booking availability.

### First response

1. Check availability dashboard section.
2. Inspect Sentry route performance and errors.
3. Check DB/cache/provider dependency status.
4. Compare against load-test baseline.
5. Escalate if booking funnel failures rise.

### Verification

Availability bootstrap load or synthetic proof should route failures to Slack.

---

## Alert: Pro session lifecycle or closeout failure spike

| Field | Value |
|---|---|
| Severity | P2 |
| Owner | Tori |
| Backup | TODO |
| Slack destination | #tovis-ops-alerts |
| Source | Sentry errors/app event |
| Dashboard | docs/launch-readiness/sentry-dashboard.md |
| Runbook | TODO |
| Threshold | TODO |
| Private beta blocker | Yes |
| Public rollout blocker | Yes |
| Status | TODO |

### User impact

Pros may be unable to progress or complete sessions correctly.

### First response

1. Check pro session lifecycle dashboard section.
2. Confirm whether closeout blockers are legitimate or route failures.
3. Check recent deploy.
4. Escalate to P1 if session state integrity is affected.

### Verification

Lifecycle smoke/regression proof should be linked.

---

## Alert: Media upload/signing/metadata failure spike

| Field | Value |
|---|---|
| Severity | P2 |
| Owner | Tori |
| Backup | TODO |
| Slack destination | #tovis-ops-alerts |
| Source | Sentry errors/performance, Supabase dashboard |
| Dashboard | docs/launch-readiness/sentry-dashboard.md |
| Runbook | docs/runbooks/supabase-storage-outage.md |
| Threshold | TODO |
| Private beta blocker | Yes |
| Public rollout blocker | Yes |
| Status | TODO |

### User impact

Users may be unable to upload or view required media.

### First response

1. Check media upload dashboard section.
2. Check Supabase Storage status.
3. Confirm whether metadata writes are creating orphan or unsafe state.
4. Escalate to P1 if private media access is affected.

### Verification

Storage outage chaos test and upload proof should link to this alert.

---

## Alert: Notification backlog or delivery failure spike

| Field | Value |
|---|---|
| Severity | P2 |
| Owner | Tori |
| Backup | TODO |
| Slack destination | #tovis-ops-alerts |
| Source | Sentry errors/app event, Postmark/Twilio dashboards |
| Dashboard | docs/launch-readiness/sentry-dashboard.md |
| Runbook | docs/runbooks/notification-backlog.md |
| Threshold | TODO |
| Private beta blocker | Yes, if notifications are beta-critical |
| Public rollout blocker | Yes |
| Status | TODO |

### User impact

Users may miss booking, payment, aftercare, or account notifications.

### First response

1. Check notification dashboard section.
2. Determine email, SMS, or queue/backlog scope.
3. Check provider dashboards.
4. Use manual follow-up path if needed.
5. Escalate to provider-specific runbook if degradation is provider-side.

### Verification

Notification processing load/chaos proof should route failures to Slack.

---

## Alert: Postmark degradation

| Field | Value |
|---|---|
| Severity | P2 |
| Owner | Tori |
| Backup | TODO |
| Slack destination | #tovis-ops-alerts |
| Source | Postmark dashboard, Sentry errors |
| Dashboard | docs/launch-readiness/sentry-dashboard.md |
| Runbook | docs/runbooks/postmark-degradation.md |
| Threshold | TODO |
| Private beta blocker | Yes, if email is beta-critical |
| Public rollout blocker | Yes |
| Status | TODO |

### User impact

Email notifications may be delayed or fail.

### First response

1. Check Postmark status/dashboard.
2. Check app notification errors.
3. Confirm retry/manual follow-up behavior.
4. Escalate if booking/payment-critical emails fail.

### Verification

Postmark degradation chaos test should link to this alert.

---

## Alert: Twilio degradation

| Field | Value |
|---|---|
| Severity | P2 |
| Owner | Tori |
| Backup | TODO |
| Slack destination | #tovis-ops-alerts |
| Source | Twilio dashboard, Sentry errors |
| Dashboard | docs/launch-readiness/sentry-dashboard.md |
| Runbook | docs/runbooks/twilio-degradation.md |
| Threshold | TODO |
| Private beta blocker | Yes, if SMS is beta-critical |
| Public rollout blocker | Yes |
| Status | TODO |

### User impact

SMS notifications or verification flows may be delayed or fail.

### First response

1. Check Twilio status/dashboard.
2. Check SMS route errors.
3. Confirm rate-limit behavior.
4. Confirm retry/manual follow-up behavior.
5. Escalate if auth or booking-critical SMS is affected.

### Verification

Twilio degradation chaos test should link to this alert.

---

## Alert: Rate-limit anomaly

| Field | Value |
|---|---|
| Severity | P2 |
| Owner | Tori |
| Backup | TODO |
| Slack destination | #tovis-ops-alerts |
| Source | Sentry/app event, Redis/rate-limit backend |
| Dashboard | docs/launch-readiness/sentry-dashboard.md |
| Runbook | docs/runbooks/redis-outage.md |
| Threshold | TODO |
| Private beta blocker | Yes, if missing |
| Public rollout blocker | Yes |
| Status | TODO |

### User impact

Users may be blocked unexpectedly, or high-risk routes may be under attack/abuse.

### First response

1. Check auth/rate-limit dashboard section.
2. Determine whether blocks are expected or suspicious.
3. Check Redis/rate-limit backend health.
4. Escalate to P1 if high-risk routes fail open or auth is broadly impacted.

### Verification

Rate-limit synthetic or chaos proof should link to this alert.

---

## Alert: API error budget burn

| Field | Value |
|---|---|
| Severity | P2 |
| Owner | Tori |
| Backup | TODO |
| Slack destination | #tovis-ops-alerts |
| Source | Sentry performance/errors |
| Dashboard | docs/launch-readiness/sentry-dashboard.md |
| Runbook | TODO |
| Threshold | TODO |
| Private beta blocker | No, if core route alerts exist |
| Public rollout blocker | Yes |
| Status | TODO |

### User impact

User-facing reliability may be degrading across routes even if no single route has crossed its threshold.

### First response

1. Check route-level Sentry errors.
2. Identify top failing transaction/route.
3. Check recent deploy.
4. Escalate if booking/payment/auth/media route is involved.

### Verification

Error budget dashboard widget and alert must be linked before public rollout.

---

# P3 alerts and follow-ups

| Alert | Owner | Slack/ticket destination | Status | Notes |
|---|---|---|---|---|
| Provider latency elevated but below P2 | Tori | TODO | TODO | Review during working hours. |
| Sentry quota/project warning | Tori | TODO | TODO | Must not silently drop launch events. |
| Background job stale warning | Tori | TODO | TODO | Escalate if launch-critical. |
| Dashboard panel stale/missing data | Tori | TODO | TODO | Fix before public rollout. |
| Load-test baseline drift | Tori | TODO | TODO | Review before rollout stage expansion. |

## Synthetic alert test

Before private beta, test at least one alert end-to-end.

| Field | Value |
|---|---|
| Alert tested | BLOCKED |
| Environment | staging |
| Date | TODO |
| Trigger method | Requires paid Sentry plan or alternate alerting path |
| Slack destination | `#tovis-ops-alerts` |
| Acknowledged by | TODO |
| Time to Slack message | TODO |
| Time to acknowledgement | TODO |
| Runbook link included? | TODO |
| Result | BLOCKED |

### Blocker

Sentry-to-Slack alert routing cannot be tested until the required Sentry plan is available or an alternate alerting path is selected and documented.

### Acceptable unblock paths

1. Upgrade Sentry and test Sentry-to-Slack routing.
2. Choose an alternate private-beta alert path and document it here.
3. Keep private beta blocked until alert routing proof exists.

Before public rollout, test at least one P1 escalation path end-to-end.

| Field | Value |
|---|---|
| P1 escalation tested | TODO |
| Environment | staging |
| Date | TODO |
| Trigger method | TODO |
| Escalation destination | TODO |
| Acknowledged by | TODO |
| Time to acknowledgement | TODO |
| Result | TODO |

## Alert message template

Use this format for Slack alert messages where possible:

```text
:rotating_light: <severity> <alert name>

Environment: <staging|production>
Release: <release>
Status: <triggered|resolved>
Threshold: <threshold>
Observed: <observed value>
Dashboard: <link>
Runbook: <link>
Owner: <owner>
Backup: <backup or TODO>
Launch impact: <private beta blocker/public rollout blocker/info>

First action:
1. <step>
2. <step>
3. <step>
```

## Alert verification template

Use this when marking an alert complete.

```md
## Verification: <alert name>

Status: PASS / FAIL / BLOCKED
Environment: staging / production
Date: TODO
Owner: Tori
Backup: TODO
Slack destination: TODO
Dashboard link: TODO
Runbook link: TODO
Trigger method: TODO
Threshold: TODO
Observed behavior: TODO
Acknowledged by: TODO
Time to acknowledgement: TODO
Result: TODO
Follow-up: TODO
```

## Public rollout requirements

Public rollout cannot proceed until:

- Every P1 alert has a threshold.
- Every P1 alert has a runbook.
- Every P1 alert has an owner and backup.
- Every P1 alert routes to Slack or the approved alert destination.
- Public P1 escalation is tested.
- Every P2 alert has a threshold.
- Every P2 alert has a runbook.
- At least one synthetic P1 alert has been tested.
- Alert links are recorded in `go-no-go.md`.
- Open gaps are listed in `risk-register.md`.

## Related documents

- docs/launch-readiness/oncall.md
- docs/launch-readiness/go-no-go.md
- docs/launch-readiness/private-beta-checklist.md
- docs/launch-readiness/public-rollout-checklist.md
- docs/launch-readiness/risk-register.md
- docs/launch-readiness/sentry-dashboard.md
- docs/launch-readiness/checklist.md

## Maintenance rule

Do not mark an alert complete because a Slack channel exists. It is complete only when the signal, threshold, routing, owner, runbook, and verification are all recorded.