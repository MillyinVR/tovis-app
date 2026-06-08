# Launch On-Call Plan

## Status

Phase: Phase 2 — Launch ops proof  
Scope: Private beta and public launch readiness  
Primary alerting path: Slack-first for private beta, unless an approved alternate alert path is documented in go-no-go.md  
Primary dashboard surface: Sentry-first, with provider dashboards linked where Sentry cannot own the signal  
Pager system: Not required for private beta, but required before public launch unless explicitly waived in go-no-go.md  
Primary owner: Tori  
Backup owner: TODO — public launch blocker  
Current default status: IN PROGRESS / ALERT ROUTING BLOCKED — Phase 2 local code proof is green and deployed Sentry intake is proven, but Slack alert routing, synthetic alert delivery, backup owner, and public escalation are still incomplete.

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
| Load plan reconciliation | PASS | Updated in commit `f41b203` — `Update load test plan with current Phase 2 proof` |
| Sentry dashboard proof reconciliation | PASS | Updated in commit `aa4fe4d` — `Update Sentry dashboard proof with current Phase 2 status` |
| Slack alert map reconciliation | PASS | Updated in commit `12732a0` — `Update Slack alert map with current Phase 2 status` |
| Slack alert routing | BLOCKED | Requires paid Sentry plan or approved alternate alerting path |
| Synthetic alert delivery | BLOCKED | Cannot complete until routing path exists |
| Backup owner | BLOCKED | Required before public launch |
| Public P1 escalation | BLOCKED | Required before public launch unless explicitly waived |

Important distinction: local Phase 2 code proof is green, and deployed Sentry intake works. That does not prove on-call readiness. On-call readiness requires alert routing, acknowledgement, owners, runbooks, and escalation.

---

# Current launch gate status

| Gate | Status | Notes |
|---|---|---|
| Primary owner named | DONE | Tori is the primary launch owner. |
| Backup owner named | BLOCKED | A named backup owner is required before public launch. |
| Sentry intake verified | DONE | Production synthetic event captured: e56044a034cb4fb78d1b09801fb43da5. |
| Phase 2 local load/chaos proof | DONE LOCALLY | `pnpm verify:launch-ops` passed locally against audited code commit `ae30aff20aff8b205e65f57bf3ae8b5b8b553b29`; proof recorded in `docs/launch-readiness/test-proof.md`. |
| Slack alert channel chosen | TODO / BLOCKED | Proposed channel is `#tovis-ops-alerts`; routing is blocked until Sentry plan upgrade or approved alternate path exists. |
| P1/P2 alert thresholds documented | TODO | Must be completed in docs/launch-readiness/slack-alerts.md. |
| Runbooks linked from alerts | PARTIAL | Booking funnel runbook now exists; auth/session, pro session lifecycle, and SLO/error budget runbooks still need to be created. |
| Synthetic alert tested | BLOCKED | At least one staging or production-safe synthetic alert must route to Slack or approved alternate before private beta. |
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
| Slack private-beta ops channel | First-line alert routing during private beta | TODO / BLOCKED | Proposed channel: #tovis-ops-alerts; routing blocked until Sentry plan or alternate path exists. |
| Sentry issues/events | Error grouping, regressions, performance visibility | PARTIAL | Sentry intake is proven; alert delivery is not. |
| Sentry dashboards | Primary app observability surface | TODO LIVE DASHBOARD PROOF | Dashboard links/sections still need live verification. |
| Provider dashboards | Stripe, Twilio, Postmark, Supabase, Vercel, database/Redis provider status | TODO | Must be linked where Sentry is not source of truth. |
| Direct owner notification | Temporary private-beta fallback | TODO | Acceptable only if documented, tested, and accepted in go-no-go.md. |
| Email alert from Sentry | Possible alternate alert route | TODO | Can unblock private beta only if tested end-to-end. |
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

Do not mark an alert complete because Sentry captured an event. Sentry intake proves the app can report. Alert readiness requires the alert to reach the correct human and be acknowledged.

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
| Date | 2026-06-05 |
| Result | PASS |
| Event ID | e56044a034cb4fb78d1b09801fb43da5 |
| What it proves | Deployed Sentry intake works. |
| What it does not prove | Slack routing, alert thresholding, acknowledgement, escalation, dashboard completeness. |

## Required synthetic alert proof

| Field | Value |
|---|---|
| Alert tested | TODO |
| Environment | staging or production-safe synthetic route |
| Date | TODO |
| Trigger method | TODO |
| Destination | #tovis-ops-alerts or approved alternate |
| Acknowledged by | TODO |
| Time to alert message | TODO |
| Time to acknowledgement | TODO |
| Runbook link included? | TODO |
| Result | TODO / BLOCKED |

## Current blocker

Sentry-to-Slack routing cannot be tested until one of the following happens:

1. Sentry is upgraded and Slack routing is enabled.
2. An alternate private-beta alert path is chosen, documented, and tested.
3. Private beta remains blocked until alert routing proof exists.

A direct owner notification or email alert can temporarily unblock private beta only if it is explicitly accepted in go-no-go.md and tested end-to-end.

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
- No alert routing proof exists, unless a temporary alternate path is explicitly accepted in go-no-go.md.
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
- Alert routing has not been tested end-to-end.

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
| Choose Slack ops channel or approved alternate | High | Tori | Private beta | TODO |
| Test synthetic alert routing | High | Tori | Private beta | BLOCKED |
| Define P1/P2 alert thresholds | High | Tori | Private beta/public launch | TODO |
| Link all P1/P2 alerts to runbooks | High | Tori | Public launch | PARTIAL — booking funnel runbook exists; auth/session, pro lifecycle, and SLO/error budget runbooks still TODO |
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

On-call readiness is complete only when the owner is named, the backup requirement is handled, the runbook link works, the alert destination is known, the routing path has been tested, and acknowledgement/escalation behavior is recorded.

Local Phase 2 proof and deployed Sentry intake proof are supporting evidence. They do not replace alert routing, dashboard proof, backup ownership, or escalation proof.