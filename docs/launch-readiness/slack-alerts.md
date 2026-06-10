# Slack Alert Map

## Status

Phase: Phase 2 — Launch ops proof  
Scope: Private beta alert routing and public-launch escalation readiness  
Primary private-beta alert destination: Slack-first  
Public rollout requirement: P1 escalation path must be stronger than passive Slack-only monitoring unless explicitly accepted in go-no-go.md  
Primary owner: Tori  
Backup owner: NONE — solo operator; accepted private-beta risk (2026-06-09, RISK-001); public rollout blocker  
Current default status: APP-GENERATED SYNTHETIC ALERT ROUTING PASS / RUNBOOK LINK TODO — deployed Sentry intake has been proven with a synthetic production event, a saved Sentry issue-alert rule can deliver notifications to `#tovis-ops-alerts`, and a production-safe app-generated synthetic Sentry alert routed to `#tovis-ops-alerts` on 2026-06-08 at 6:31 PM local. Private beta alert routing proof is now PASS for the synthetic app alert, but runbook-link-in-message, formal acknowledgement timing, live dashboard proof, and public P1 escalation remain TODO.

## Current alert-routing proof

Sentry event capture itself is no longer the blocker. A synthetic deployed Sentry event was successfully captured from production:

| Field | Value |
|---|---|
| Base URL | https://www.tovis.app |
| Route | POST /api/internal/debug/sentry-test |
| Event ID | e56044a034cb4fb78d1b09801fb43da5 |
| Result | HTTP 200, synthetic Sentry event captured |
| Date | 2026-06-07 |
| Verified by | Tori |

Sentry-to-Slack routing is no longer blocked by plan access. The paid Sentry plan is active, the Sentry app is added to `#tovis-ops-alerts`, and a saved Sentry issue-alert rule delivered a test notification to Slack.

| Field | Value |
|---|---|
| Slack workspace | Tovis |
| Slack channel | `#tovis-ops-alerts` |
| Sentry app added to channel | PASS |
| Sentry account linked in Slack | PASS — linked as `support@tovis.app` |
| Test notification type | Sentry issue-alert test notification |
| Slack message title | Sentry Test Issue |
| Project | `tovis-app` |
| Sentry alert shown in Slack | Issue Stream |
| Short ID shown in Slack | TOVIS-APP-J |
| Date tested | 2026-06-07 |
| Time observed | 8:36 PM local |
| Verified by | Tori |
| Result | PASS FOR SAVED SENTRY ISSUE-ALERT RULE TO SLACK / REAL APP-GENERATED SYNTHETIC ALERT TODO |

This proves that a saved Sentry issue-alert rule can send a test issue notification to the private-beta Slack alert channel. That test alone did not prove a production-safe app-generated synthetic alert, threshold behavior, runbook link, acknowledgement process, P1 escalation, or dashboard completeness.

A production-safe app-generated synthetic Sentry alert was later triggered successfully from the deployed app and routed to Slack:

| Field | Value |
|---|---|
| Route | `POST /api/internal/debug/sentry-test` |
| Environment | production |
| Date tested | 2026-06-08 |
| Time observed | 6:31 PM local |
| Trigger method | Authorized curl request with production origin header and internal job secret |
| Sentry event ID | `f7a0d19cb4a040a3a21f4679086f166f` |
| Alert key | `launch-readiness.synthetic-sentry-alert.v2` |
| Alert message | `TOVIS production-safe synthetic Sentry alert v2` |
| Slack workspace | Tovis |
| Slack channel | `#tovis-ops-alerts` |
| Slack alert rule | `Notify #tovis-ops-alerts via Slack` |
| Slack short ID | `TOVIS-APP-K` |
| Message observed by | Tori |
| Runbook link included? | No — follow-up TODO |
| Formal acknowledgement timing | TODO |
| Result | PASS |

This proves that the deployed app can generate a production-safe synthetic Sentry alert and that Sentry can route that app-generated alert to the intended private-beta Slack alert channel. It does not yet prove runbook-link-in-message, formal acknowledgement timing, route-specific P1/P2 thresholds, public P1 escalation, or dashboard completeness.

## Current Phase 2 proof baseline

| Item | Status | Evidence |
|---|---|---|
| Sentry release/environment config | IMPLEMENTED | lib/observability/sentryConfig.ts, sentry.server.config.ts, sentry.edge.config.ts, instrumentation-client.ts |
| Deployed Sentry intake | PASS | Synthetic event captured: e56044a034cb4fb78d1b09801fb43da5 |
| Chaos suite | PASSED LOCALLY | pnpm test:chaos: 6 files / 17 tests passed |
| Launch load suite | PASSED LOCALLY | pnpm test:load:launch: 8/8 launch load steps passed |
| Aggregate launch ops verification | PASSED LOCALLY | `pnpm verify:launch-ops` passed locally against audited code commit `ae30aff20aff8b205e65f57bf3ae8b5b8b553b29`; proof recorded in `docs/launch-readiness/test-proof.md` |
| Load plan reconciliation | PASS | Current Phase 2 status reflected in `docs/launch-readiness/load-test-plan.md` |
| Sentry dashboard proof reconciliation | PASS | Current Phase 2 status reflected in `docs/launch-readiness/sentry-dashboard.md` |
| Booking funnel runbook | PASS | `docs/runbooks/booking-funnel.md` exists |
| Slack alert routing | PASS / RUNBOOK LINK TODO | Paid Sentry plan enabled; Sentry app added to `#tovis-ops-alerts`; saved Sentry issue-alert rule delivered a test notification to Slack on 2026-06-07; production-safe app-generated synthetic alert routed to Slack on 2026-06-08. |
| Synthetic Slack alert proof | PASS / RUNBOOK LINK TODO | Production-safe app-generated synthetic alert routed to `#tovis-ops-alerts` on 2026-06-08 at 6:31 PM local. Event ID `f7a0d19cb4a040a3a21f4679086f166f`; alert key `launch-readiness.synthetic-sentry-alert.v2`; Slack short ID `TOVIS-APP-K`. Runbook link in Slack message and formal acknowledgement timing still TODO. |
| Backup owner / escalation | BLOCKED | Required before public rollout |

Important line: local Phase 2 code proof is green, deployed Sentry intake works, saved Sentry issue-alert delivery to Slack works, and a production-safe app-generated synthetic alert routed to Slack successfully. Private beta alert routing proof is now PASS for the synthetic app alert. Runbook-link-in-message, formal acknowledgement timing, dashboard proof, deployed smoke proof, support path, rollback path, and risk review remain TODO.

---

# Alert readiness rule

An alert is not launch-ready unless it has:

- Severity
- Owner
- Backup status
- Slack destination or approved alternate destination
- Source signal
- Threshold
- Dashboard link
- Runbook link
- Escalation path
- Launch impact
- Verification step
- Evidence that the alert actually routes

No orphan alerts. No alert should exist without a human who knows what to do with it.

Do not mark an alert complete because Sentry captured an event or because a saved Sentry issue-alert test notification reached Slack. Sentry intake proves the app can report. Sentry-to-Slack test delivery proves the routing path can reach the channel. Alert proof still requires a launch-critical signal, threshold, runbook link, destination, owner, and acknowledgement behavior to be recorded.

---

# Slack destinations

| Destination | Purpose | Status | Notes |
|---|---|---|---|
| #tovis-ops-alerts | Private-beta alert channel | CONNECTED / APP-GENERATED SYNTHETIC ALERT PASSED | Paid Sentry plan enabled. Sentry app added to channel. Saved Sentry issue-alert rule delivered a test notification on 2026-06-07. Production-safe app-generated synthetic alert routed to Slack on 2026-06-08 at 6:31 PM local. Runbook link in Slack message still TODO. |
| #tovis-beta-support | Proposed beta support/feedback channel | TODO | Optional if support uses another path. |
| #tovis-incidents | Proposed incident coordination channel | TODO | Optional for private beta, recommended before public rollout. |
| Direct owner notification | Backup path for P1 during private beta | NOT SELECTED | Sentry-to-Slack is the selected private-beta alert path. Direct owner notification remains a fallback only if documented and accepted in go-no-go.md. |
| Email notification from Sentry | Possible alternate alert route | NOT SELECTED | Sentry-to-Slack is the selected private-beta alert path. Email alerting may remain supplemental, but is not the primary beta alert path. |
| Vercel/provider notifications | Supplemental provider path | TODO | Useful for deploy/provider alerts, not enough for all app-level alerts. |
| PagerDuty/Opsgenie/equivalent | Public rollout P1 escalation | BLOCKED | Required before public rollout unless waived in go-no-go.md. |

---

# Severity routing

| Severity | Slack routing | Required response | Public rollout requirement |
|---|---|---|---|
| P1 | Ops alerts + incident channel + owner ping | Immediate acknowledgement | Tested escalation path required |
| P2 | Ops alerts | Same-day acknowledgement during beta support hours | Alert owner and runbook required |
| P3 | Ops alerts or ticket/follow-up | Triage during working hours | Can be ticket-only if documented |

---

# Response-time targets

| Severity | Private beta target | Public rollout target |
|---|---:|---:|
| P1 | Acknowledge within 15 minutes during support window | Acknowledge within 5 minutes |
| P2 | Acknowledge same day during support window | Acknowledge within 30 minutes during coverage |
| P3 | Review during next working session | Review within one business day |

These are initial targets. Tighten them when there is a named backup owner and tested public escalation.

---

# Initial Alert Thresholds

These thresholds are the repo-owned starter thresholds for private-beta alert configuration. They are copied from `docs/launch-readiness/dashboard-checklist.md` where possible and should be tightened after real beta traffic establishes a baseline.

| Alert area | Severity | Initial threshold | Verification source |
|---|---|---|---|
| Readiness failing | P1 | `/api/health/live` non-200 for 1 minute, `/api/health/ready` down for 1 minute, or readiness degraded for 5 minutes | Deployed health proof plus synthetic/monitor alert |
| Database/Postgres outage | P1 | Postgres readiness down once, pool exhaustion sustained, or severe query failure spike | Health/readiness, provider dashboard, Sentry |
| Redis/rate-limit safety issue | P1 | Redis degraded for 5 minutes, or high-risk route rate-limit safety fails open | Health/readiness, rate-limit dashboard, chaos proof |
| Booking finalize failure spike | P1 | Booking finalize success `< 99%` for 5 minutes, 5xx `> 1%` for 5 minutes, or any confirmed double booking | Booking funnel dashboard, Sentry |
| Stripe webhook verification/processing failure | P1 | Stripe webhook 2xx `< 99%` for 5 minutes, processing p95 `> 60s` for 5 minutes, sustained failed webhook count, or any duplicate payment side effect | Stripe dashboard, Sentry, app state |
| Private media policy regression | P1 | Any confirmed private-media exposure or unauthorized access | Storage policy proof, Sentry, provider dashboard |
| Auth failure spike | P1 | Auth route 5xx `> 1%`, broad login/register drop, or phone send success `< 95%` for 5 minutes | Auth/rate-limit dashboard, Sentry |
| Hold create failure spike | P2 | Hold creation success `< 99%` for 5 minutes | Booking funnel dashboard, Sentry |
| Availability bootstrap latency/error spike | P2 | Availability p95 above cold target for 5 minutes or sustained availability error spike | Booking funnel dashboard, Sentry |
| Pro session lifecycle failure spike | P2 | Session start success `< 99%` for 5 minutes or sustained stuck-step/closeout blocker spike | Pro lifecycle dashboard, Sentry |
| Media upload/storage failure | P2 | Media metadata success `< 99%` for 5 minutes, upload success `< 98%` for 5 minutes, or storage degraded for 5 minutes | Media dashboard, Supabase dashboard |
| Notification backlog/delivery failure | P2 | Oldest pending notification `> 10 min`, processor success `< 98%` for 10 minutes, or critical provider delivery below threshold | Notification dashboard, provider dashboard |
| Postmark degradation | P2 | Postmark readiness degraded for 10 minutes or email delivery success `< 98%` for 10 minutes | Postmark dashboard, Sentry |
| Twilio degradation | P2 | Twilio readiness degraded for 10 minutes or SMS delivery success `< 95%` for 10 minutes | Twilio dashboard, Sentry |
| Rate-limit anomaly | P2 | High-risk route 429 spike, suspicious drop to zero during attack traffic, or Redis/rate-limit backend anomaly | Auth/rate-limit dashboard |
| API error budget burn | P2 | Route-specific P1/P2 threshold breached or API 5xx `> 1%` for 5 minutes | SLO/error-budget dashboard |

Thresholds alone do not make an alert complete. Each alert still needs a live rule, dashboard link, runbook link in or adjacent to the alert message, routing proof, acknowledgement timing, and public escalation where required.

---

# Alert ownership summary

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

# Current runbook gap summary

| Alert area | Runbook status | Launch impact |
|---|---|---|
| Booking funnel | `docs/runbooks/booking-funnel.md` exists | Supports booking/availability/hold/finalize alerts; booking-specific alert proof still TODO |
| Auth/session | `docs/runbooks/auth-session.md` exists | Supports auth/session alerts; saved Sentry issue-alert delivery proof exists; auth-specific alert proof still TODO |
| Pro session lifecycle | `docs/runbooks/pro-session-lifecycle.md` exists | Supports pro lifecycle alerts; saved Sentry issue-alert delivery proof exists; lifecycle-specific alert proof still TODO |
| SLO/error budget | `docs/runbooks/slo-error-budget.md` exists | Supports SLO/error budget alerts; saved Sentry issue-alert delivery proof exists; SLO/error-budget alert proof still TODO |

---

# Required P1 alerts

## Alert: Readiness endpoint failing

| Field | Value |
|---|---|
| Severity | P1 |
| Owner | Tori |
| Backup | TODO |
| Destination | #tovis-ops-alerts or approved alternate |
| Source | Sentry synthetic check, health/readiness monitor, or provider monitor |
| Dashboard | docs/launch-readiness/sentry-dashboard.md |
| Runbook | docs/runbooks/health-readiness.md |
| Threshold | `/api/health/live` non-200 for 1 minute, `/api/health/ready` down for 1 minute, or readiness degraded for 5 minutes |
| Private beta blocker | Yes, if missing or failing |
| Public rollout blocker | Yes |
| Status | TODO ROUTING PROOF |

### User impact

Users may be unable to access the app or complete core flows.

### First response

1. Confirm whether the failure is app-only or dependency-related.
2. Check health/readiness dashboard.
3. Open docs/runbooks/health-readiness.md.
4. Check recent deploy/release.
5. Decide monitor, rollback, or provider escalation.

### Verification

Trigger or simulate a staging readiness alert and confirm it routes to Slack or the approved alternate destination.

---

## Alert: Database/Postgres unavailable or severe query failure

| Field | Value |
|---|---|
| Severity | P1 |
| Owner | Tori |
| Backup | TODO |
| Destination | #tovis-ops-alerts or approved alternate |
| Source | Health/readiness, Sentry errors, provider dashboard |
| Dashboard | docs/launch-readiness/sentry-dashboard.md |
| Runbook | docs/runbooks/postgres-outage.md |
| Threshold | Postgres readiness down once, pool exhaustion sustained, or severe query failure spike |
| Private beta blocker | Yes |
| Public rollout blocker | Yes |
| Status | TODO ROUTING PROOF |

### User impact

Core app flows may fail, including auth, booking, payments, media metadata, and admin privacy actions.

### First response

1. Confirm provider status.
2. Open Postgres runbook.
3. Check whether reads, writes, or both are impacted.
4. Pause launch/rollout if active.
5. Decide rollback, maintenance, or provider escalation.

### Verification

Trigger a staging-safe database readiness failure or synthetic failure and confirm alert routing.

---

## Alert: Redis/rate-limit safety degraded

| Field | Value |
|---|---|
| Severity | P1 |
| Owner | Tori |
| Backup | TODO |
| Destination | #tovis-ops-alerts or approved alternate |
| Source | Health/readiness, Sentry errors, rate-limit wrapper signals |
| Dashboard | docs/launch-readiness/sentry-dashboard.md |
| Runbook | docs/runbooks/redis-outage.md |
| Threshold | Redis degraded for 5 minutes, or high-risk route rate-limit safety fails open |
| Private beta blocker | Yes |
| Public rollout blocker | Yes |
| Status | TODO ROUTING PROOF |

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
| Destination | #tovis-ops-alerts or approved alternate |
| Source | Sentry errors/app event |
| Dashboard | docs/launch-readiness/sentry-dashboard.md |
| Runbook | docs/runbooks/booking-funnel.md |
| Threshold | Booking finalize success `< 99%` for 5 minutes, 5xx `> 1%` for 5 minutes, or any confirmed double booking |
| Private beta blocker | Yes |
| Public rollout blocker | Yes |
| Status | TODO ROUTING PROOF |

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
| Destination | #tovis-ops-alerts or approved alternate |
| Source | Sentry errors/app event, Stripe dashboard |
| Dashboard | docs/launch-readiness/sentry-dashboard.md |
| Runbook | docs/runbooks/stripe-degradation.md |
| Threshold | Stripe webhook 2xx `< 99%` for 5 minutes, processing p95 `> 60s` for 5 minutes, sustained failed webhook count, or any duplicate payment side effect |
| Private beta blocker | Yes, if payments are enabled |
| Public rollout blocker | Yes |
| Status | TODO ROUTING PROOF |

### User impact

Payment state may not update correctly. Booking/payment status may become delayed or inconsistent.

### First response

1. Check Stripe dashboard and Sentry webhook errors.
2. Confirm signature verification failures versus processing failures.
3. Check idempotency/replay behavior.
4. Pause rollout if payment correctness is uncertain.
5. Follow Stripe runbook.

### Verification

Staging webhook replay proof must route failures to Slack or the approved alternate destination.

---

## Alert: Private media access policy regression

| Field | Value |
|---|---|
| Severity | P1 |
| Owner | Tori |
| Backup | TODO |
| Destination | #tovis-ops-alerts or approved alternate |
| Source | Storage policy proof, Sentry errors, manual/synthetic check |
| Dashboard | docs/launch-readiness/sentry-dashboard.md |
| Runbook | docs/runbooks/private-media-incident.md |
| Threshold | Any confirmed regression |
| Private beta blocker | Yes |
| Public rollout blocker | Yes |
| Status | TODO ROUTING PROOF |

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
| Destination | #tovis-ops-alerts or approved alternate |
| Source | Sentry errors/app event |
| Dashboard | docs/launch-readiness/sentry-dashboard.md |
| Runbook | docs/runbooks/auth-session.md |
| Threshold | Auth route 5xx `> 1%`, broad login/register drop, or phone send success `< 95%` for 5 minutes |
| Private beta blocker | Yes |
| Public rollout blocker | Yes |
| Status | TODO ROUTING PROOF |

### User impact

Users may be unable to register, log in, reset password, or correct phone/auth information.

### First response

1. Check auth/rate-limit dashboard section.
2. Determine which auth route is failing.
3. Check recent deploy and provider dependencies.
4. Confirm HMAC contact lookup/privacy paths are not regressed.
5. Pause rollout if login/register is broadly affected.

### Verification

Synthetic auth failure alert or staging test must route to Slack or the approved alternate destination.

---

# Required P2 alerts

## Alert: Hold create failure spike

| Field | Value |
|---|---|
| Severity | P2 |
| Owner | Tori |
| Backup | TODO |
| Destination | #tovis-ops-alerts or approved alternate |
| Source | Sentry errors/app event |
| Dashboard | docs/launch-readiness/sentry-dashboard.md |
| Runbook | docs/runbooks/booking-funnel.md |
| Threshold | Hold creation success `< 99%` for 5 minutes |
| Private beta blocker | Yes, if missing before beta |
| Public rollout blocker | Yes |
| Status | TODO ROUTING PROOF |

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
| Destination | #tovis-ops-alerts or approved alternate |
| Source | Sentry performance/errors |
| Dashboard | docs/launch-readiness/sentry-dashboard.md |
| Runbook | docs/runbooks/booking-funnel.md |
| Threshold | Availability p95 above cold target for 5 minutes or sustained availability error spike |
| Private beta blocker | Yes |
| Public rollout blocker | Yes |
| Status | TODO ROUTING PROOF |

### User impact

Clients may see slow or failed booking availability.

### First response

1. Check availability dashboard section.
2. Inspect Sentry route performance and errors.
3. Check DB/cache/provider dependency status.
4. Compare against load-test baseline.
5. Escalate if booking funnel failures rise.

### Verification

Availability bootstrap load or synthetic proof should route failures to Slack or the approved alternate destination.

---

## Alert: Pro session lifecycle or closeout failure spike

| Field | Value |
|---|---|
| Severity | P2 |
| Owner | Tori |
| Backup | TODO |
| Destination | #tovis-ops-alerts or approved alternate |
| Source | Sentry errors/app event |
| Dashboard | docs/launch-readiness/sentry-dashboard.md |
| Runbook | docs/runbooks/pro-session-lifecycle.md |
| Threshold | Session start success `< 99%` for 5 minutes or sustained stuck-step/closeout blocker spike |
| Private beta blocker | Yes |
| Public rollout blocker | Yes |
| Status | TODO ROUTING PROOF |

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
| Destination | #tovis-ops-alerts or approved alternate |
| Source | Sentry errors/performance, Supabase dashboard |
| Dashboard | docs/launch-readiness/sentry-dashboard.md |
| Runbook | docs/runbooks/supabase-storage-outage.md |
| Threshold | Media metadata success `< 99%` for 5 minutes, upload success `< 98%` for 5 minutes, or storage degraded for 5 minutes |
| Private beta blocker | Yes |
| Public rollout blocker | Yes |
| Status | TODO ROUTING PROOF |

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
| Destination | #tovis-ops-alerts or approved alternate |
| Source | Sentry errors/app event, Postmark/Twilio dashboards |
| Dashboard | docs/launch-readiness/sentry-dashboard.md |
| Runbook | docs/runbooks/notification-backlog.md |
| Threshold | Oldest pending notification `> 10 min`, processor success `< 98%` for 10 minutes, or critical provider delivery below threshold |
| Private beta blocker | Yes, if notifications are beta-critical |
| Public rollout blocker | Yes |
| Status | TODO ROUTING PROOF |

### User impact

Users may miss booking, payment, aftercare, or account notifications.

### First response

1. Check notification dashboard section.
2. Determine email, SMS, or queue/backlog scope.
3. Check provider dashboards.
4. Use manual follow-up path if needed.
5. Escalate to provider-specific runbook if degradation is provider-side.

### Verification

Notification processing load/chaos proof should route failures to Slack or the approved alternate destination.

---

## Alert: Postmark degradation

| Field | Value |
|---|---|
| Severity | P2 |
| Owner | Tori |
| Backup | TODO |
| Destination | #tovis-ops-alerts or approved alternate |
| Source | Postmark dashboard, Sentry errors |
| Dashboard | docs/launch-readiness/sentry-dashboard.md |
| Runbook | docs/runbooks/postmark-degradation.md |
| Threshold | Postmark readiness degraded for 10 minutes or email delivery success `< 98%` for 10 minutes |
| Private beta blocker | Yes, if email is beta-critical |
| Public rollout blocker | Yes |
| Status | TODO ROUTING PROOF |

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
| Destination | #tovis-ops-alerts or approved alternate |
| Source | Twilio dashboard, Sentry errors |
| Dashboard | docs/launch-readiness/sentry-dashboard.md |
| Runbook | docs/runbooks/twilio-degradation.md |
| Threshold | Twilio readiness degraded for 10 minutes or SMS delivery success `< 95%` for 10 minutes |
| Private beta blocker | Yes, if SMS is beta-critical |
| Public rollout blocker | Yes |
| Status | TODO ROUTING PROOF |

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
| Destination | #tovis-ops-alerts or approved alternate |
| Source | Sentry/app event, Redis/rate-limit backend |
| Dashboard | docs/launch-readiness/sentry-dashboard.md |
| Runbook | docs/runbooks/redis-outage.md |
| Threshold | High-risk route 429 spike, suspicious drop to zero during attack traffic, or Redis/rate-limit backend anomaly |
| Private beta blocker | Yes, if missing |
| Public rollout blocker | Yes |
| Status | TODO ROUTING PROOF |

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
| Destination | #tovis-ops-alerts or approved alternate |
| Source | Sentry performance/errors |
| Dashboard | docs/launch-readiness/sentry-dashboard.md |
| Runbook | docs/runbooks/slo-error-budget.md |
| Threshold | Route-specific P1/P2 threshold breached or API 5xx `> 1%` for 5 minutes |
| Private beta blocker | No, if core route alerts exist |
| Public rollout blocker | Yes |
| Status | TODO ROUTING PROOF |

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

---

# Synthetic alert test

Before private beta, test at least one alert end-to-end.

## Current routing test

| Field | Value |
|---|---|
| Alert tested | Saved Sentry issue-alert rule test notification |
| Environment | Sentry issue-alert rule / no deployed app environment |
| Date | 2026-06-07 |
| Trigger method | Sentry alert builder test notification from saved issue-alert rule |
| Destination | Tovis Slack workspace / `#tovis-ops-alerts` |
| Slack message title | Sentry Test Issue |
| Project | `tovis-app` |
| Sentry alert shown in Slack | Issue Stream |
| Short ID shown in Slack | TOVIS-APP-J |
| Message observed by | Tori |
| Time to alert message | Immediate enough for private-beta routing proof; observed at 8:36 PM local |
| Time to acknowledgement | TODO — formal acknowledgement workflow not yet tested |
| Runbook link included? | No — default Sentry test issue message only |
| Result | PASS FOR SAVED SENTRY ISSUE-ALERT RULE TO SLACK / REAL APP-GENERATED SYNTHETIC ALERT TODO |

This confirms that a saved Sentry issue-alert rule can deliver a test notification to the intended private-beta Slack alert channel. It does not yet satisfy full private-beta alert proof because the test did not prove an app-generated production-safe signal, threshold behavior, runbook link, or acknowledgement timing.

## Current app-generated synthetic alert proof

| Field | Value |
|---|---|
| Alert tested | Production-safe app-generated synthetic Sentry alert |
| Environment | production |
| Date | 2026-06-08 |
| Time observed | 6:31 PM local |
| Route | `POST /api/internal/debug/sentry-test` |
| Trigger method | Authorized curl request with production origin header and internal job secret |
| Destination | Tovis Slack workspace / `#tovis-ops-alerts` |
| Sentry event ID | `f7a0d19cb4a040a3a21f4679086f166f` |
| Alert key | `launch-readiness.synthetic-sentry-alert.v2` |
| Alert message | `TOVIS production-safe synthetic Sentry alert v2` |
| Slack alert rule | `Notify #tovis-ops-alerts via Slack` |
| Slack short ID | `TOVIS-APP-K` |
| Acknowledged by | Tori observed the alert in Slack |
| Time to alert message | Observed at 6:31 PM local |
| Time to acknowledgement | TODO — formal acknowledgement workflow not yet timed |
| Runbook link included? | No — follow-up TODO |
| Result | PASS |

This confirms that the deployed app can generate a production-safe synthetic Sentry alert and that Sentry can route the app-generated alert to `#tovis-ops-alerts`. It does not yet prove runbook-link-in-message, formal acknowledgement timing, public P1 escalation, or route-specific P1/P2 alert thresholds.

## Current synthetic Sentry event proof

| Field | Value |
|---|---|
| Event tested | Synthetic Sentry event capture |
| Environment | Production |
| Date | 2026-06-07 |
| Trigger method | POST /api/internal/debug/sentry-test |
| Result | PASS |
| Event ID | e56044a034cb4fb78d1b09801fb43da5 |
| What it proves | Deployed Sentry intake works |
| What it does not prove | Slack alert routing, alert thresholding, acknowledgement, escalation |

## Remaining blocker

The Sentry plan/routing blocker is resolved. Basic Sentry-to-Slack delivery is proven, and production-safe app-generated synthetic alert routing to `#tovis-ops-alerts` is proven.

Remaining alert follow-ups before private beta are runbook-link-in-message and formal acknowledgement timing, unless those are explicitly accepted as private-beta follow-ups in go-no-go.md. Public rollout remains blocked until P1 escalation is stronger than passive Slack-only monitoring or explicitly accepted in go-no-go.md.

## Selected private-beta alert path

Selected path: paid Sentry plan with Sentry-to-Slack routing into `#tovis-ops-alerts`.

Current status:

1. Paid Sentry plan enabled.
2. Sentry app added to `#tovis-ops-alerts`.
3. Saved Sentry issue-alert rule delivered a test notification to Slack.
4. Production-safe app-generated synthetic alert routed to Slack successfully.
5. Runbook link in Slack message still TODO.
6. Formal acknowledgement timing still TODO.
7. Public P1 escalation still TODO.

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

---

# Alert message template

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

---

# Alert verification template

Use this when marking an alert complete.

```md
## Verification: <alert name>

Status: PASS / FAIL / BLOCKED  
Environment: staging / production  
Date: TODO  
Owner: Tori  
Backup: TODO  
Destination: TODO  
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

---

# Completed alert-routing verifications

## Verification: saved Sentry issue-alert rule to Slack

Status: PARTIAL PASS  
Environment: Sentry issue-alert rule / no deployed app environment  
Date: 2026-06-07  
Owner: Tori  
Backup: TODO  
Destination: Tovis Slack workspace / `#tovis-ops-alerts`  
Dashboard link: TODO  
Runbook link: Not included in default Sentry test issue message  
Trigger method: Sentry alert builder test notification from saved issue-alert rule  
Threshold: Not applicable to default Sentry test issue  
Observed behavior: Saved Sentry issue-alert rule posted a test issue notification in `#tovis-ops-alerts`  
Slack message title: Sentry Test Issue  
Project: `tovis-app`  
Sentry alert shown in Slack: Issue Stream  
Short ID shown in Slack: TOVIS-APP-J  
Acknowledged by: Tori observed message in Slack; formal acknowledgement workflow TODO  
Time to alert message: Observed at 8:36 PM local  
Time to acknowledgement: TODO  
Result: Saved Sentry issue-alert rule can deliver to Slack  
Follow-up: Completed by production-safe app-generated synthetic alert test on 2026-06-08; see verification below.

## Verification: production-safe app-generated synthetic alert to Slack

Status: PASS  
Environment: production  
Date: 2026-06-08  
Owner: Tori  
Backup: TODO  
Destination: Tovis Slack workspace / `#tovis-ops-alerts`  
Dashboard link: TODO  
Runbook link: Not included in Slack message — follow-up TODO  
Trigger method: Authorized `POST /api/internal/debug/sentry-test` request with production origin header and internal job secret  
Threshold: Synthetic alert trigger; route-specific P1/P2 starter thresholds are documented above, but live alert-rule verification is still TODO
Observed behavior: Deployed app generated a Sentry event and Sentry posted the app-generated alert in `#tovis-ops-alerts`  
Sentry event ID: `f7a0d19cb4a040a3a21f4679086f166f`  
Alert key: `launch-readiness.synthetic-sentry-alert.v2`  
Alert message: `TOVIS production-safe synthetic Sentry alert v2`  
Slack alert rule: `Notify #tovis-ops-alerts via Slack`  
Slack short ID: `TOVIS-APP-K`  
Acknowledged by: Tori observed the alert in Slack; formal acknowledgement workflow TODO  
Time to alert message: Observed at 6:31 PM local  
Time to acknowledgement: TODO  
Result: PASS  
Follow-up: Add runbook link to Slack alert message or document accepted private-beta follow-up; configure and verify live route-specific alert rules; public P1 escalation still TODO.

---

# Public rollout requirements

Public rollout cannot proceed until:

- Every P1 alert has a threshold.
- Every P1 alert has a runbook.
- Every P1 alert has an owner and backup.
- Every P1 alert routes to Slack or the approved alert destination.
- Public P1 escalation is tested.
- Every P2 alert has a threshold.
- Every P2 alert has a runbook.
- At least one launch-critical P1/P2 synthetic alert has been tested end-to-end.
- Alert links are recorded in go-no-go.md.
- Open gaps are listed in risk-register.md.
- Backup owner is named and available.
- P1 acknowledgement path is stronger than passive Slack-only monitoring unless explicitly accepted in go-no-go.md.

---

# Related documents

- docs/launch-readiness/oncall.md
- docs/launch-readiness/go-no-go.md
- docs/launch-readiness/private-beta-checklist.md
- docs/launch-readiness/public-rollout-checklist.md
- docs/launch-readiness/risk-register.md
- docs/launch-readiness/sentry-dashboard.md
- docs/launch-readiness/checklist.md
- docs/launch-readiness/test-proof.md
- docs/launch-readiness/load-test-plan.md
- docs/launch-readiness/chaos-test-plan.md
- docs/runbooks/health-readiness.md
- docs/runbooks/postgres-outage.md
- docs/runbooks/redis-outage.md
- docs/runbooks/supabase-storage-outage.md
- docs/runbooks/private-media-incident.md
- docs/runbooks/stripe-degradation.md
- docs/runbooks/postmark-degradation.md
- docs/runbooks/twilio-degradation.md
- docs/runbooks/notification-backlog.md
- docs/runbooks/booking-funnel.md
- docs/runbooks/auth-session.md
- docs/runbooks/pro-session-lifecycle.md
- docs/runbooks/slo-error-budget.md

---

# Maintenance rule

Do not mark an alert complete because a Slack channel exists, a Sentry event was captured, or a local test passed.

An alert is complete only when the signal, threshold, routing, owner, runbook, and verification are all recorded.

Sentry intake proof, saved Sentry issue-alert delivery proof, and production-safe app-generated synthetic alert proof are supporting evidence. They prove events can reach Sentry, a saved Sentry issue-alert rule can reach Slack, and the deployed app can generate an alert that routes to `#tovis-ops-alerts`. They do not prove route-specific P1/P2 thresholds, runbook-link-in-message, formal acknowledgement timing, public escalation, dashboard coverage, or full operational readiness.
