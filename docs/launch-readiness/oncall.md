# Launch On-Call Plan

## Status

Phase: Phase 2 — Launch ops proof  
Scope: Private beta and public launch readiness  
Primary alerting path: Slack-first for private beta  
Primary dashboard surface: Sentry-first, with provider dashboards linked where Sentry cannot own the signal  
Pager system: Not required for private beta, but required before public launch unless explicitly waived in go-no-go.md

This file defines who owns launch incidents, where alerts route, which runbooks apply, and what must be true before TOVIS can move from private beta to public rollout.

## Current launch gate status

| Gate | Status | Notes |
|---|---|---|
| Primary owner named | DONE | Tori is the primary launch owner. |
| Backup owner named | BLOCKED | A named backup owner is required before public launch. |
| Slack alert channel chosen | TODO | Set the private-beta ops channel before wiring alerts. |
| P1/P2 alert thresholds documented | TODO | Must be completed in docs/launch-readiness/slack-alerts.md. |
| Runbooks linked from alerts | TODO | Existing runbooks should be reused where possible. |
| Synthetic alert tested | TODO | At least one staging alert must route to Slack before private beta. |
| Public-launch pager path chosen | BLOCKED | PagerDuty/Opsgenie or equivalent escalation path must exist before public launch. |

## Owners

| Role | Owner | Backup | Launch gate |
|---|---|---|---|
| Primary launch owner | Tori | TODO | Backup is required before public launch. |
| Engineering incident commander | Tori | TODO | Backup is required before public launch. |
| Privacy/security incident owner | Tori | TODO | Backup is required before public launch. |
| Customer/support comms owner | Tori | TODO | Backup is required before public launch. |
| Provider/vendor escalation owner | Tori | TODO | Backup is required before public launch. |

## Alert destinations

| Destination | Purpose | Status |
|---|---|---|
| Slack private-beta ops channel | First-line alert routing during private beta | TODO |
| Sentry issues/alerts | Error grouping, regressions, performance visibility | TODO |
| Provider dashboards | Stripe, Twilio, Postmark, Supabase, Vercel, database/Redis provider status | TODO |
| Pager system | Required for public launch P1/P2 escalation | BLOCKED until chosen and tested |

## Severity levels

### P1 — Launch-stopping incident

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

Required response:

1. Acknowledge in Slack.
2. Open the relevant runbook.
3. Assign incident owner.
4. Post current impact.
5. Decide mitigation or rollback.
6. Update go-no-go.md if this affects launch status.
7. Record follow-up in risk-register.md.

### P2 — Degraded launch-critical flow

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

Required response:

1. Acknowledge in Slack.
2. Check dashboard and related runbook.
3. Confirm whether the issue affects private beta users.
4. Record mitigation or owner.
5. Escalate to P1 if user-facing impact grows.

### P3 — Operational warning

Use P3 when the system is still healthy but trending toward risk.

Examples:

- Error rate is rising but below launch-blocking threshold.
- Background queue depth is increasing.
- Provider latency is elevated.
- Rate-limit blocks are unusually high.
- Load-test latency approaches SLO threshold.
- A dashboard panel is stale or missing data.

Required response:

1. Triage during working hours.
2. Create a follow-up issue if not resolved quickly.
3. Update risk-register.md if risk remains open.

## Required alert coverage

Every alert must have:

- Owner
- Backup
- Severity
- Slack destination
- Threshold
- Dashboard link
- Runbook link
- Escalation path
- Launch impact
- Verification step

No alert should be considered launch-ready without those fields.

## Minimum private-beta alerts

| Area | Severity | Alert | Owner | Backup | Runbook | Status |
|---|---|---|---|---|---|---|
| Health/readiness | P1 | Readiness endpoint failing | Tori | TODO | docs/runbooks/health-readiness.md | TODO |
| Database | P1 | Postgres unavailable or severe query failures | Tori | TODO | docs/runbooks/postgres-outage.md | TODO |
| Redis/rate limits | P1 | Redis outage affects rate-limit/session safety | Tori | TODO | docs/runbooks/redis-outage.md | TODO |
| Booking funnel | P1 | Booking finalize failure spike | Tori | TODO | TODO | TODO |
| Booking funnel | P2 | Hold create failure spike | Tori | TODO | TODO | TODO |
| Availability | P2 | Availability bootstrap latency or error spike | Tori | TODO | docs/runbooks/health-readiness.md | TODO |
| Pro session lifecycle | P2 | Closeout/session lifecycle failures spike | Tori | TODO | TODO | TODO |
| Media uploads | P2 | Media upload/signing/metadata failures spike | Tori | TODO | docs/runbooks/supabase-storage-outage.md | TODO |
| Private media | P1 | Private media access policy regression | Tori | TODO | docs/runbooks/private-media-incident.md | TODO |
| Payments/webhooks | P1 | Stripe webhook verification or processing failure spike | Tori | TODO | docs/runbooks/stripe-degradation.md | TODO |
| Notifications | P2 | Notification backlog or delivery failure spike | Tori | TODO | docs/runbooks/notification-backlog.md | TODO |
| Email provider | P2 | Postmark degradation | Tori | TODO | docs/runbooks/postmark-degradation.md | TODO |
| SMS provider | P2 | Twilio degradation | Tori | TODO | docs/runbooks/twilio-degradation.md | TODO |
| Auth | P1 | Login/register/password-reset failure spike | Tori | TODO | TODO | TODO |
| Rate limits | P2 | Abnormal high-risk route rate-limit blocks | Tori | TODO | docs/runbooks/redis-outage.md | TODO |
| SLO/error budget | P2 | API error budget burn exceeds threshold | Tori | TODO | TODO | TODO |

## Public-launch escalation requirements

Before public launch, the following must be true:

1. A named backup owner exists.
2. P1 alerts route somewhere stronger than passive Slack-only monitoring.
3. P1 escalation has a tested acknowledgement path.
4. Every P1 alert has a runbook.
5. Every P1 alert has a rollback or mitigation note.
6. At least one staging synthetic alert has been tested end-to-end.
7. go-no-go.md has an explicit sign-off section.

Until these are complete, public launch remains blocked.

## Incident response checklist

Use this checklist for P1 and P2 incidents.

1. Acknowledge the alert in Slack.
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
8. Choose action:
   - Monitor
   - Mitigate
   - Roll back
   - Disable feature
   - Escalate to provider
   - Block launch
9. Post next update.
10. Record follow-up in risk-register.md.

## Launch-blocking conditions

Private beta is blocked if any of the following are true:

- pnpm typecheck fails.
- pnpm verify:privacy-phase1 fails.
- Health/readiness proof is missing.
- Booking lifecycle smoke proof is missing.
- No Slack alert destination exists.
- No owner is assigned for P1 alerts.
- Privacy/export/delete authorization proof fails.
- Payment/webhook verification proof fails.
- Storage policy proof fails.

Public launch is blocked if any of the following are true:

- Any private-beta blocker remains open.
- No named backup owner exists.
- No tested P1 escalation path exists.
- P1/P2 alerts do not link to runbooks.
- Load tests are missing for launch-critical flows.
- Chaos tests are missing for required dependency failures.
- risk-register.md contains unresolved high-severity launch risks.
- go-no-go.md has not been reviewed and signed.

## Required runbooks

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

If a required runbook does not exist, the related alert remains open until the runbook is created or an existing runbook is confirmed as sufficient.

## Alert documentation template

Use this template in docs/launch-readiness/slack-alerts.md for every alert.

md ## Alert: <name>  Severity: P1 / P2 / P3   Owner: Tori   Backup: TODO   Slack destination: TODO   Dashboard: TODO   Runbook: TODO   Source: Sentry / provider dashboard / app metric / synthetic check   Threshold: TODO   Escalation: TODO   Private beta blocker: yes/no   Public launch blocker: yes/no    ### User impact  TODO  ### First response  1. TODO 2. TODO 3. TODO  ### Verification  TODO  ### Rollback or mitigation  TODO 

## Open blockers

| Blocker | Severity | Owner | Required before |
|---|---|---|---|
| Name backup owner | High | Tori | Public launch |
| Choose Slack ops channel | High | Tori | Private beta |
| Create alert map | High | Tori | Private beta |
| Test synthetic staging alert | High | Tori | Private beta |
| Decide public-launch pager path | High | Tori | Public launch |
| Link all P1/P2 alerts to runbooks | High | Tori | Public launch |

## Related documents

- docs/launch-readiness/checklist.md
- docs/launch-readiness/slack-alerts.md
- docs/launch-readiness/sentry-dashboard.md
- docs/launch-readiness/go-no-go.md
- docs/launch-readiness/private-beta-checklist.md
- docs/launch-readiness/public-rollout-checklist.md
- docs/launch-readiness/risk-register.md
- docs/privacy/phase-1-privacy-proof.md
- docs/privacy/phase-1-remaining-work.md

## Maintenance rule

Do not mark an alert or on-call item complete unless the implementation exists, the owner is named, the runbook link works, and the routing path has been tested or explicitly marked as private-beta-only documentation.