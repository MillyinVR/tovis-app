# Launch On-Call Plan

## Status

Phase: Phase 2 — Launch ops proof  
Scope: Private beta and public launch readiness  
Primary alerting path: Slack-first for private beta, unless an approved alternate alert path is documented in go-no-go.md  
Primary dashboard surface: Sentry-first, with provider dashboards linked where Sentry cannot own the signal  
Pager system: Not required for private beta, but required before public launch unless explicitly waived in go-no-go.md  
Primary owner: Tori  
Backup owner: TODO — public launch blocker  
Current default status: IN PROGRESS / APP-GENERATED SYNTHETIC ALERT ROUTING PASS — Phase 2 local code proof is green, deployed Sentry intake is proven, a saved Sentry issue-alert rule can deliver notifications to `#tovis-ops-alerts`, and a production-safe app-generated synthetic Sentry alert routed to `#tovis-ops-alerts` on 2026-06-08 at 6:31 PM local. Private beta on-call readiness is still incomplete until runbook-link-in-message, formal acknowledgement timing, dashboard proof, support path, rollback path, and risk review are completed or explicitly accepted. Backup owner and public escalation remain public launch blockers.

This file defines who owns launch incidents, where alerts route, which runbooks apply, and what must be true before TOVIS can move from private beta to public rollout.

---

# Current Phase 2 proof baseline

| Item | Status | Evidence |
|---|---|---|
| Primary launch owner | DONE | Tori |
| Sentry release/environment config | IMPLEMENTED | lib/observability/sentryConfig.ts, sentry.server.config.ts, sentry.edge.config.ts, instrumentation-client.ts |
| Deployed Sentry intake | PASS | Synthetic event captured: e56044a034cb4fb78d1b09801fb43da5 |
| Chaos suite | PASSED LOCALLY | pnpm test:chaos: 6 files / 17 tests passed |
| Launch load suite | PASSED LOCALLY | pnpm test:load:launch: 8/8 launch load steps passed |
| Aggregate launch ops verification | PASSED LOCALLY | `pnpm verify:launch-ops` passed locally against audited code commit `ae30aff20aff8b205e65f57bf3ae8b5b8b553b29`; proof recorded in `docs/launch-readiness/test-proof.md` and commit `5dc37c1` |
| Load plan reconciliation | PASS | Current Phase 2 status reflected in `docs/launch-readiness/load-test-plan.md` |
| Sentry dashboard proof reconciliation | PASS | Current Phase 2 status reflected in `docs/launch-readiness/sentry-dashboard.md` |
| Slack alert map reconciliation | PASS | Current Phase 2 status reflected in `docs/launch-readiness/slack-alerts.md` |
| Slack alert routing | PASS / RUNBOOK LINK TODO | Paid Sentry plan enabled; Sentry app added to `#tovis-ops-alerts`; saved Sentry issue-alert rule delivered a test notification to Slack on 2026-06-07; production-safe app-generated synthetic alert routed to Slack on 2026-06-08. |
| Synthetic alert delivery | PASS / RUNBOOK LINK TODO | Production-safe app-generated synthetic Sentry alert routed to `#tovis-ops-alerts` on 2026-06-08 at 6:31 PM local. Event ID `f7a0d19cb4a040a3a21f4679086f166f`; alert key `launch-readiness.synthetic-sentry-alert.v2`; Slack short ID `TOVIS-APP-K`. Runbook link in Slack message and formal acknowledgement timing still TODO. |
| Backup owner | BLOCKED | Required before public launch |
| Public P1 escalation | BLOCKED | Required before public launch unless explicitly waived |

Important distinction: local Phase 2 code proof is green, deployed Sentry intake works, saved Sentry issue-alert delivery to Slack works, and a production-safe app-generated synthetic alert routed to Slack successfully. That does not fully prove on-call readiness. On-call readiness still requires runbook-link-in-message, formal acknowledgement timing, route-specific thresholds, dashboard links, support/rollback readiness, backup ownership decisions, and public escalation.

---

# Current launch gate status

| Gate | Status | Notes |
|---|---|---|
| Primary owner named | DONE | Tori is the primary launch owner. |
| Backup owner named | BLOCKED | A named backup owner is required before public launch. |
| Sentry intake verified | DONE | Production synthetic event captured: e56044a034cb4fb78d1b09801fb43da5. |
| Phase 2 local load/chaos proof | DONE LOCALLY | `pnpm verify:launch-ops` passed locally against audited code commit `ae30aff20aff8b205e65f57bf3ae8b5b8b553b29`; proof recorded in `docs/launch-readiness/test-proof.md`. |
| Slack alert channel chosen | PASS / RUNBOOK LINK TODO | Private-beta Slack alert channel is `#tovis-ops-alerts`; Sentry app is added to the channel; saved Sentry issue-alert rule delivered a test notification on 2026-06-07; production-safe app-generated synthetic alert routed to Slack on 2026-06-08 at 6:31 PM local. Runbook link in Slack message still TODO. |
| P1/P2 alert thresholds documented | TODO | Must be completed in docs/launch-readiness/slack-alerts.md. |
| Runbooks linked from alerts | IN PROGRESS / RUNBOOK LINK IN MESSAGE TODO | Required runbooks are linked in docs; saved Sentry issue-alert delivery and production-safe app-generated synthetic alert delivery are proven. Real Slack alert messages still need runbook-link verification before private beta or an accepted follow-up in go-no-go.md. |
| Synthetic alert tested | PASS / FORMAL ACK TIMING TODO | Production-safe app-generated synthetic Sentry alert routed to `#tovis-ops-alerts` on 2026-06-08 at 6:31 PM local. Event ID `f7a0d19cb4a040a3a21f4679086f166f`; Slack short ID `TOVIS-APP-K`. Tori observed the alert in Slack; formal acknowledgement timing still TODO. |
| Public-launch pager path chosen | BLOCKED | PagerDuty/Opsgenie or equivalent escalation path must exist before public launch unless waived. |
| Public-launch P1 acknowledgement tested | BLOCKED | Requires backup owner and escalation path. |

---

# Owners

| Role | Owner | Backup | Launch gate |
|---|---|---|---|
| Primary launch owner | Tori | TODO | Backup is required before public launch. |
| Engineering incident commander | Tori | TODO | Backup is required before public launch. |
| Privacy/security incident owner | Tori | TODO | Backup is required before public launch. |
| Customer/support comms owner | Tori | TODO | Backup is required before public launch. |
| Provider/vendor escalation owner | Tori | TODO | Backup is required before public launch. |
| Go/no-go decision owner | Tori | TODO | Backup/signoff required before public launch. |

Until a backup owner is named, public launch remains blocked. Private beta can proceed only if this single-owner risk is explicitly accepted in go-no-go.md.

---

# Alert destinations

| Destination | Purpose | Status | Notes |
|---|---|---|---|
| Slack private-beta ops channel | First-line alert routing during private beta | CONNECTED / APP-GENERATED SYNTHETIC ALERT PASSED | Channel: `#tovis-ops-alerts`. Paid Sentry plan enabled. Sentry app added to channel. Saved Sentry issue-alert rule delivered a test notification on 2026-06-07. Production-safe app-generated synthetic alert routed to Slack on 2026-06-08 at 6:31 PM local. Runbook link in Slack message still TODO. |
| Sentry issues/events | Error grouping, regressions, performance visibility | PASS / RUNBOOK LINK TODO | Sentry intake is proven, saved Sentry issue-alert delivery to Slack is proven, and production-safe app-generated alert routing to Slack is proven. Runbook link in Slack message, route-specific thresholds, and formal acknowledgement timing still TODO. |
| Sentry dashboards | Primary app observability surface | TODO LIVE DASHBOARD PROOF | Dashboard links/sections still need live verification. |
| Provider dashboards | Stripe, Twilio, Postmark, Supabase, Vercel, database/Redis provider status | TODO | Must be linked where Sentry is not source of truth. |
| Direct owner notification | Temporary private-beta fallback | NOT SELECTED | Sentry-to-Slack is the selected private-beta alert path. Direct owner notification remains a fallback only if documented and accepted in go-no-go.md. |
| Email alert from Sentry | Possible alternate alert route | NOT SELECTED | Sentry-to-Slack is the selected private-beta alert path. Email alerting may remain supplemental, but is not the primary beta alert path. |
| Pager system | Public launch P1/P2 escalation | BLOCKED | Required before public launch unless waived. |

---

# Severity levels

## P1 — Launch-stopping incident

Use P1 when users cannot complete a core booking/payment/auth flow, privacy boundaries may be compromised, or infrastructure is broadly unavailable.

Examples:

- Production or staging launch environment is unavailable.
- Booking finalize path fails above threshold.
- Payment or Stripe webhook processing fails above threshold.
- Privacy/export/delete route authorization fails.
- PII redaction, logging, or audit boundary regression is suspected.
- Database is unavailable or data integrity is at risk.
- Redis/rate-limit failure causes high-risk routes to fail open.
- Storage outage causes unsafe media state or public/private media policy failure.
- Private media access policy regression is confirmed.
- Sentry intake or alerting is unavailable during a launch window.

Required response:

1. Acknowledge in the approved alert destination.
2. Open the relevant runbook.
3. Assign incident owner.
4. Post current impact.
5. Decide mitigation or rollback.
6. Update go-no-go.md if this affects launch status.
7. Record follow-up in risk-register.md.

## P2 — Degraded launch-critical flow

Use P2 when a core flow is degraded but not fully down.

Examples:

- Elevated auth errors.
- Elevated hold creation failures.
- Elevated checkout creation failures.
- Elevated notification failures.
- Postmark/Twilio degradation with retry/manual follow-up available.
- Media upload failures below P1 threshold.
- Background jobs delayed but not blocked.
- Availability bootstrap or day availability latency above SLO.
- Rate-limit blocks are unusually high but safe.

Required response:

1. Acknowledge in the approved alert destination.
2. Check dashboard and related runbook.
3. Confirm whether the issue affects private beta users.
4. Record mitigation or owner.
5. Escalate to P1 if user-facing impact grows.

## P3 — Operational warning

Use P3 when the system is still healthy but trending toward risk.

Examples:

- Error rate is rising but below launch-blocking threshold.
- Background queue depth is increasing.
- Provider latency is elevated.
- Rate-limit blocks are unusually high but not user-blocking.
- Load-test latency approaches SLO threshold.
- A dashboard panel is stale or missing data.
- Sentry quota or ingestion warning appears.

Required response:

1. Triage during working hours.
2. Create a follow-up issue if not resolved quickly.
3. Update risk-register.md if risk remains open.

---

# Required alert coverage

Every alert must have:

- Owner
- Backup
- Severity
- Destination
- Threshold
- Dashboard link
- Runbook link
- Escalation path
- Launch impact
- Verification step
- Evidence that routing works

No alert should be considered launch-ready without those fields.

Do not mark a route-specific alert complete because Sentry captured an event, because a saved Sentry issue-alert test notification reached Slack, or because the production-safe synthetic alert routed successfully. Sentry intake proves the app can report. Sentry-to-Slack test delivery proves the routing path can reach the channel. The production-safe synthetic alert proves the deployed app can generate an alert that routes to Slack. Route-specific alert readiness still requires the launch-critical signal, threshold, runbook link, destination, owner, and acknowledgement behavior to be recorded.

---

# Minimum private-beta alerts

| Area | Severity | Alert | Owner | Backup | Runbook | Status |
|---|---|---|---|---|---|---|
| Health/readiness | P1 | Readiness endpoint failing | Tori | TODO | docs/runbooks/health-readiness.md | TODO ROUTING PROOF |
| Database | P1 | Postgres unavailable or severe query failures | Tori | TODO | docs/runbooks/postgres-outage.md | TODO ROUTING PROOF |
| Redis/rate limits | P1 | Redis outage affects rate-limit/session safety | Tori | TODO | docs/runbooks/redis-outage.md | TODO ROUTING PROOF |
| Booking funnel | P1 | Booking finalize failure spike | Tori | TODO | docs/runbooks/booking-funnel.md | TODO ROUTING PROOF |
| Booking funnel | P2 | Hold create failure spike | Tori | TODO | docs/runbooks/booking-funnel.md | TODO ROUTING PROOF |
| Availability | P2 | Availability bootstrap latency or error spike | Tori | TODO | docs/runbooks/booking-funnel.md | TODO ROUTING PROOF |
| Pro session lifecycle | P2 | Closeout/session lifecycle failures spike | Tori | TODO | docs/runbooks/pro-session-lifecycle.md | TODO ROUTING PROOF |
| Media uploads | P2 | Media upload/signing/metadata failures spike | Tori | TODO | docs/runbooks/supabase-storage-outage.md | TODO ROUTING PROOF |
| Private media | P1 | Private media access policy regression | Tori | TODO | docs/runbooks/private-media-incident.md | TODO ROUTING PROOF |
| Payments/webhooks | P1 | Stripe webhook verification or processing failure spike | Tori | TODO | docs/runbooks/stripe-degradation.md | TODO ROUTING PROOF |
| Notifications | P2 | Notification backlog or delivery failure spike | Tori | TODO | docs/runbooks/notification-backlog.md | TODO ROUTING PROOF |
| Email provider | P2 | Postmark degradation | Tori | TODO | docs/runbooks/postmark-degradation.md | TODO ROUTING PROOF |
| SMS provider | P2 | Twilio degradation | Tori | TODO | docs/runbooks/twilio-degradation.md | TODO ROUTING PROOF |
| Auth | P1 | Login/register/password-reset failure spike | Tori | TODO | docs/runbooks/auth-session.md | TODO ROUTING PROOF |
| Rate limits | P2 | Abnormal high-risk route rate-limit blocks | Tori | TODO | docs/runbooks/redis-outage.md | TODO ROUTING PROOF |
| SLO/error budget | P2 | API error budget burn exceeds threshold | Tori | TODO | docs/runbooks/slo-error-budget.md | TODO ROUTING PROOF |

---

# Synthetic alert proof

Before private beta, at least one alert must be tested end-to-end.

## Current synthetic Sentry event proof

| Field | Value |
|---|---|
| Event tested | Synthetic Sentry event capture |
| Environment | Production |
| Route | POST /api/internal/debug/sentry-test |
| Date | 2026-06-07 |
| Result | PASS |
| Event ID | e56044a034cb4fb78d1b09801fb43da5 |
| What it proves | Deployed Sentry intake works. |
| What it does not prove | Slack routing, alert thresholding, acknowledgement, escalation, dashboard completeness. |

## Current Sentry-to-Slack routing proof

| Field | Value |
|---|---|
| Alert tested | Saved Sentry issue-alert rule test notification |
| Environment | Sentry test notification / no deployed app environment |
| Date | 2026-06-07 |
| Trigger method | Sentry alert builder test notification from saved issue-alert rule |
| Destination | Tovis Slack workspace / `#tovis-ops-alerts` |
| Slack message title | Sentry Test Issue |
| Project | `tovis-app` |
| Sentry alert shown in Slack | Issue Stream |
| Short ID shown in Slack | TOVIS-APP-J |
| Message observed by | Tori |
| Time observed | 8:36 PM local |
| Time to acknowledgement | TODO — formal acknowledgement workflow not yet tested |
| Runbook link included? | No — default Sentry test issue message only |
| Result | PASS FOR SAVED SENTRY ISSUE-ALERT RULE TO SLACK / COMPLETED BY APP-GENERATED SYNTHETIC ALERT TEST BELOW |

This confirms that a saved Sentry issue-alert rule can deliver a test notification to the intended private-beta Slack alert channel. This saved-rule test alone did not prove an app-generated production-safe signal, threshold behavior, runbook link, or acknowledgement timing. The production-safe app-generated alert proof below completes the basic app-generated routing requirement.

## Current production-safe synthetic alert proof

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

## Remaining blocker

The Sentry plan/routing blocker is resolved. Basic Sentry-to-Slack delivery is proven, and production-safe app-generated synthetic alert routing to `#tovis-ops-alerts` is proven.

Remaining on-call alert follow-ups before private beta are runbook-link-in-message and formal acknowledgement timing, unless those are explicitly accepted as private-beta follow-ups in go-no-go.md. A direct owner notification or email alert is no longer the selected primary private-beta path because Sentry-to-Slack is available. Public launch still requires a stronger P1 escalation path unless explicitly accepted in go-no-go.md.

---

# Completed on-call routing evidence

## On-call evidence: saved Sentry issue-alert rule to Slack

Status: PARTIAL PASS  
Owner: Tori  
Backup: TODO  
Environment: Sentry issue-alert rule / no deployed app environment  
Date: 2026-06-07  
Alert destination: Tovis Slack workspace / `#tovis-ops-alerts`  
Routing test: Saved Sentry issue-alert rule test notification  
Sentry event ID: N/A for default Sentry test notification  
Dashboard link: TODO  
Runbook link: Not included in default Sentry test issue message  
Acknowledged by: Tori observed message in Slack; formal acknowledgement workflow TODO  
Time observed: 8:36 PM local  
Time to acknowledgement: TODO  

### What was verified

- Paid Sentry plan is enabled.
- Sentry app is added to `#tovis-ops-alerts`.
- Tori's Slack account is linked to Sentry as `support@tovis.app`.
- Sentry alert builder can send a test issue notification to `#tovis-ops-alerts`.
- The Slack message showed project `tovis-app`, alert `Issue Stream`, and short ID `TOVIS-APP-J`.
- A Sentry issue-alert rule was created/saved for the `tovis-app` project.
- The saved Sentry issue-alert rule can deliver a test notification to `#tovis-ops-alerts`.

### Known gaps

- This was a Sentry test notification, not an app-generated production-safe synthetic alert.
- The message did not include a launch runbook link.
- Formal acknowledgement timing was not recorded.
- P1/P2 alert thresholds are still TODO.
- Live dashboard links are still TODO.
- Backup owner is still TODO for public launch.
- Public P1 escalation is still TODO.

### Launch decision

This partially unblocked private-beta alert routing by proving Sentry-to-Slack delivery works. The production-safe app-generated synthetic alert test below later proved deployed app-generated alert routing to `#tovis-ops-alerts`.

## On-call evidence: production-safe app-generated synthetic alert to Slack

Status: PASS  
Owner: Tori  
Backup: TODO  
Environment: production  
Date: 2026-06-08  
Time observed: 6:31 PM local  
Alert destination: Tovis Slack workspace / `#tovis-ops-alerts`  
Routing test: Production-safe app-generated synthetic Sentry alert  
Route: `POST /api/internal/debug/sentry-test`  
Trigger method: Authorized curl request with production origin header and internal job secret  
Sentry event ID: `f7a0d19cb4a040a3a21f4679086f166f`  
Alert key: `launch-readiness.synthetic-sentry-alert.v2`  
Alert message: `TOVIS production-safe synthetic Sentry alert v2`  
Slack alert rule: `Notify #tovis-ops-alerts via Slack`  
Slack short ID: `TOVIS-APP-K`  
Dashboard link: TODO  
Runbook link: Not included in Slack message — follow-up TODO  
Acknowledged by: Tori observed the alert in Slack  
Time to acknowledgement: TODO — formal acknowledgement workflow not yet timed  
Result: PASS  

### What was verified

- Production route accepted a same-origin authorized request.
- Internal job secret authorization worked.
- The deployed app generated a Sentry event.
- The event included stable alert metadata: `launch-readiness.synthetic-sentry-alert.v2`.
- Sentry routed the app-generated alert to `#tovis-ops-alerts`.
- Tori observed the alert in Slack.

### Known gaps

- Slack alert message did not include a runbook link.
- Formal acknowledgement timing still needs to be recorded if required for private beta.
- Route-specific P1/P2 thresholds are still TODO.
- Live dashboard proof is still TODO.
- Backup owner is still TODO for public launch.
- Public P1 escalation is still TODO.

### Launch decision

This clears the private-beta blocker for basic app-generated synthetic alert routing to Slack. Private beta remains NO-GO until dashboard proof, deployed smoke proof, support path, rollback path, and risk review are complete or explicitly accepted.

---

# Public-launch escalation requirements

Before public launch, the following must be true:

1. A named backup owner exists.
2. P1 alerts route somewhere stronger than passive Slack-only monitoring.
3. P1 escalation has a tested acknowledgement path.
4. Every P1 alert has a runbook.
5. Every P1 alert has a rollback or mitigation note.
6. At least one staging or production-safe synthetic alert has been tested end-to-end.
7. go-no-go.md has an explicit sign-off section.
8. Alert links are recorded in go-no-go.md.
9. Remaining alert gaps are recorded in risk-register.md.
10. Public launch has no unaccepted P1/P2 alert-routing gaps.

Until these are complete, public launch remains blocked.

---

# Incident response checklist

Use this checklist for P1 and P2 incidents.

1. Acknowledge the alert in the approved alert destination.
2. State severity: P1, P2, or P3.
3. Name the incident owner.
4. Link the relevant dashboard.
5. Link the relevant runbook.
6. Summarize current user impact.
7. Identify whether the issue affects:
   - Private beta only
   - Public launch readiness
   - Privacy/security boundary
   - Payments
   - Booking lifecycle
   - Media/storage
   - Notifications
   - Auth/session
   - Rate limits
   - Infrastructure dependency
8. Choose action:
   - Monitor
   - Mitigate
   - Roll back
   - Disable feature
   - Escalate to provider
   - Block launch
9. Post next update.
10. Record follow-up in risk-register.md.

---

# Launch-blocking conditions

Private beta is blocked if any of the following are true:

- pnpm typecheck fails.
- pnpm verify:privacy-phase1 fails.
- Health/readiness proof is missing.
- Booking lifecycle smoke proof is missing.
- No alert destination exists.
- Production-safe app-generated synthetic alert routing to `#tovis-ops-alerts` is missing or broken, unless a temporary accepted risk is explicitly recorded in go-no-go.md.
- Sentry-to-Slack delivery to `#tovis-ops-alerts` is broken during the beta window.
- No owner is assigned for P1 alerts.
- Privacy/export/delete authorization proof fails.
- Payment/webhook verification proof fails when payments are enabled.
- Storage policy proof fails.
- Sentry intake is broken.
- There is no way for the owner to see critical failures during beta.

Public launch is blocked if any of the following are true:

- Any private-beta blocker remains open.
- No named backup owner exists.
- No tested P1 escalation path exists.
- P1/P2 alerts do not link to runbooks.
- Load tests are missing or failing for launch-critical flows.
- Chaos tests are missing or failing for required dependency failures.
- risk-register.md contains unresolved high-severity launch risks.
- go-no-go.md has not been reviewed and signed.
- Public P1 escalation is passive Slack-only without explicit accepted risk.
- Alert thresholds are undefined.
- P1/P2 launch-critical alert routing has not been tested end-to-end with threshold, runbook link, destination, and acknowledgement evidence.

---

# Required runbooks

The following runbooks should be linked from alerts where applicable:

| Incident area | Runbook |
|---|---|
| Health/readiness | docs/runbooks/health-readiness.md |
| Redis/rate limits | docs/runbooks/redis-outage.md |
| Database/Postgres | docs/runbooks/postgres-outage.md |
| Supabase Storage | docs/runbooks/supabase-storage-outage.md |
| Stripe | docs/runbooks/stripe-degradation.md |
| Postmark | docs/runbooks/postmark-degradation.md |
| Twilio | docs/runbooks/twilio-degradation.md |
| Private media | docs/runbooks/private-media-incident.md |
| Notifications | docs/runbooks/notification-backlog.md |
| Booking funnel | docs/runbooks/booking-funnel.md |
| Auth/session | docs/runbooks/auth-session.md |
| Pro session lifecycle | docs/runbooks/pro-session-lifecycle.md |
| SLO/error budget | docs/runbooks/slo-error-budget.md |

If a required runbook does not exist, the related alert remains open until the runbook is created or an existing runbook is confirmed as sufficient.

---

# Alert documentation template

Use this template in docs/launch-readiness/slack-alerts.md for every alert.

```md
## Alert: <name>

Severity: P1 / P2 / P3  
Owner: Tori  
Backup: TODO  
Destination: TODO  
Dashboard: TODO  
Runbook: TODO  
Source: Sentry / provider dashboard / app metric / synthetic check  
Threshold: TODO  
Escalation: TODO  
Private beta blocker: yes/no  
Public launch blocker: yes/no  
Status: TODO / PASS / BLOCKED / ACCEPTED RISK  

### User impact

TODO

### First response

1. TODO
2. TODO
3. TODO

### Verification

TODO

### Rollback or mitigation

TODO
```

---

# On-call evidence template

Use this when marking on-call readiness complete or accepted.

```md
## On-call evidence: <private beta / public launch>

Status: PASS / FAIL / BLOCKED / ACCEPTED RISK  
Owner: Tori  
Backup: TODO  
Environment: staging / production  
Date: TODO  
Alert destination: TODO  
Synthetic alert tested: TODO  
Sentry event ID: TODO  
Dashboard link: TODO  
Runbook link: TODO  
Acknowledged by: TODO  
Time to acknowledgement: TODO  

### What was verified

TODO

### Known gaps

TODO

### Launch decision

TODO
```

---

# Open blockers

| Blocker | Severity | Owner | Required before | Current status |
|---|---|---|---|---|
| Name backup owner | High | Tori | Public launch | BLOCKED |
| Choose Slack ops channel or approved alternate | High | Tori | Private beta | DONE — selected `#tovis-ops-alerts`; saved Sentry issue-alert rule delivered test notification to Slack |
| Test synthetic alert routing | High | Tori | Private beta | PASS / RUNBOOK LINK TODO — production-safe app-generated synthetic alert routed to `#tovis-ops-alerts`; runbook-link-in-message and formal acknowledgement timing still TODO |
| Link all P1/P2 alerts to runbooks | High | Tori | Public launch | IN PROGRESS / REAL ALERT TEST TODO — required runbooks are linked; real alert messages still need runbook-link verification |
| Define P1/P2 alert thresholds | High | Tori | Private beta/public launch | TODO |
| Decide public-launch pager path | High | Tori | Public launch | BLOCKED |
| Test P1 acknowledgement path | High | Tori | Public launch | BLOCKED |
| Complete live dashboard links | High | Tori | Private beta/public launch | TODO |
| Link provider dashboards | Medium | Tori | Private beta/public launch | TODO |

---

# Related documents

- docs/launch-readiness/checklist.md
- docs/launch-readiness/slack-alerts.md
- docs/launch-readiness/sentry-dashboard.md
- docs/launch-readiness/go-no-go.md
- docs/launch-readiness/private-beta-checklist.md
- docs/launch-readiness/public-rollout-checklist.md
- docs/launch-readiness/risk-register.md
- docs/launch-readiness/test-proof.md
- docs/launch-readiness/load-test-plan.md
- docs/launch-readiness/chaos-test-plan.md
- docs/privacy/phase-1-privacy-proof.md
- docs/privacy/phase-1-remaining-work.md
- docs/runbooks/booking-funnel.md
- docs/runbooks/auth-session.md
- docs/runbooks/pro-session-lifecycle.md
- docs/runbooks/slo-error-budget.md

---

# Maintenance rule

Do not mark an alert or on-call item complete because a doc exists, a local test passed, or Sentry captured an event.

On-call readiness is complete only when the owner is named, the backup requirement is handled or explicitly accepted for private beta, the runbook link works, the alert destination is known, the routing path has been tested with a launch-relevant signal, and acknowledgement/escalation behavior is recorded.

Local Phase 2 proof, deployed Sentry intake proof, saved Sentry issue-alert delivery proof, and production-safe app-generated synthetic alert proof are supporting evidence. They prove the app can report, the Sentry-to-Slack path works, and the deployed app can generate an alert that reaches `#tovis-ops-alerts`. They do not replace route-specific P1/P2 thresholds, runbook-link-in-message, formal acknowledgement timing, dashboard proof, backup ownership, or public escalation proof.