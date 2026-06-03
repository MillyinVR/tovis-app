# Go / No-Go Launch Gate

## Status

Phase: Phase 2 — Launch ops proof  
Scope: Private beta and public rollout readiness  
Current default decision: NO-GO until required evidence is linked  
Primary dashboard surface: Sentry-first  
Primary private-beta alerting path: Slack-first  
Public-launch escalation: BLOCKED until named backup owner and tested P1 escalation path exist

This document is the launch decision gate for TOVIS. It should block launch unless the required proof exists. Do not mark an item green because the code “probably works.” Link the command output, dashboard, runbook, staging proof, or PR that proves it.

## Decision summary

| Launch stage | Decision | Reason |
|---|---|---|
| Private beta | NO-GO | Phase 2 dashboard, alert, load, chaos, and launch docs are not fully proven yet. |
| Public rollout | NO-GO | Public rollout requires all private-beta gates plus named backup owner, tested P1 escalation, load proof, chaos proof, and signed launch decision. |

## Decision rules

Use only these decision values:

| Decision | Meaning |
|---|---|
| GO | All required gates are green, evidence is linked, and risks are accepted. |
| GO WITH ACCEPTED RISKS | Required launch blockers are green, but known non-blocking risks remain documented in risk-register.md. |
| NO-GO | One or more launch blockers are open. |
| DEFER | Launch decision is intentionally postponed because evidence is incomplete. |

## Required evidence format

Every gate must include:

- Status: TODO, PASS, FAIL, BLOCKED, or ACCEPTED RISK
- Owner
- Evidence link or command output
- Date verified
- Notes

A gate is not complete without evidence.

## Private beta required gates

| Gate | Status | Owner | Evidence | Date | Notes |
|---|---|---|---|---|---|
| Local branch matches intended launch commit | TODO | Tori | TODO | TODO | Record git rev-parse HEAD. |
| pnpm typecheck passes | TODO | Tori | TODO | TODO | Required before any launch-stage testing. |
| pnpm test passes or documented focused equivalent passes | TODO | Tori | TODO | TODO | Full test suite preferred. |
| pnpm verify:privacy-phase1 passes | TODO | Tori | TODO | TODO | Required because Phase 1 privacy is a launch blocker. |
| Phase 1 privacy proof is current | TODO | Tori | docs/privacy/phase-1-privacy-proof.md | TODO | Must reflect current commit. |
| Remaining Phase 1 launch-env reruns are tracked | TODO | Tori | docs/privacy/phase-1-remaining-work.md | TODO | HMAC/address backfills may be launch-env reruns, not code blockers. |
| Health/readiness endpoint verified in staging | TODO | Tori | TODO | TODO | Include provider-live check setting if applicable. |
| Booking lifecycle smoke proof exists | TODO | Tori | TODO | TODO | Must cover client booking path and pro lifecycle path. |
| Stripe checkout and webhook verification proof exists | TODO | Tori | TODO | TODO | Must include signed webhook verification and replay/idempotency behavior. |
| Storage policy proof exists | TODO | Tori | TODO | TODO | Must prove private media cannot leak. |
| Export/delete route authorization proof exists | TODO | Tori | TODO | TODO | Must remain SUPER_ADMIN gated. |
| Sentry release/environment tagging exists | TODO | Tori | TODO | TODO | Required for launch observability. |
| Sentry dashboard has required launch sections | TODO | Tori | docs/launch-readiness/sentry-dashboard.md | TODO | All 10 sections must be mapped. |
| Slack alert destination exists | TODO | Tori | docs/launch-readiness/slack-alerts.md | TODO | Required for private beta. |
| P1/P2 alert map exists | TODO | Tori | docs/launch-readiness/slack-alerts.md | TODO | Every critical alert needs owner, threshold, runbook, and escalation. |
| On-call owner is named | PASS | Tori | docs/launch-readiness/oncall.md | TODO | Tori is primary owner. |
| Backup owner status is explicit | TODO | Tori | docs/launch-readiness/oncall.md | TODO | Missing backup is allowed for private beta only if accepted. |
| Synthetic staging alert tested | TODO | Tori | TODO | TODO | At least one alert must route to Slack. |
| Private beta checklist complete | TODO | Tori | docs/launch-readiness/private-beta-checklist.md | TODO | Must include cohort, support path, rollback trigger. |
| Risk register created and reviewed | TODO | Tori | docs/launch-readiness/risk-register.md | TODO | High risks must have owner and mitigation. |

## Public rollout required gates

Public rollout requires every private beta gate to be green, plus the gates below.

| Gate | Status | Owner | Evidence | Date | Notes |
|---|---|---|---|---|---|
| Named backup owner exists | BLOCKED | Tori | docs/launch-readiness/oncall.md | TODO | Required before public rollout. |
| P1 escalation path is tested | BLOCKED | Tori | TODO | TODO | Slack-only is not enough unless explicitly accepted in writing. |
| Public rollout checklist complete | TODO | Tori | docs/launch-readiness/public-rollout-checklist.md | TODO | Must include staged rollout and rollback criteria. |
| Load test suite exists | TODO | Tori | TODO | TODO | Required launch-critical flows must be covered. |
| Load test suite passed against staging | TODO | Tori | TODO | TODO | Include command output, date, commit, and environment. |
| Availability bootstrap load proof exists | TODO | Tori | TODO | TODO | Required. |
| Hold create load proof exists | TODO | Tori | TODO | TODO | Required. |
| Booking finalize load proof exists | TODO | Tori | TODO | TODO | Required. |
| Media metadata load proof exists | TODO | Tori | TODO | TODO | Required. |
| Checkout load proof exists | TODO | Tori | TODO | TODO | Required. |
| Stripe webhook replay proof exists | TODO | Tori | TODO | TODO | Required. |
| Notification processing load proof exists | TODO | Tori | TODO | TODO | Required. |
| Chaos test suite exists | TODO | Tori | TODO | TODO | Required. |
| Redis outage behavior proven | TODO | Tori | TODO | TODO | Must fail closed where required. |
| Storage outage behavior proven | TODO | Tori | TODO | TODO | Must avoid unsafe media state. |
| Stripe webhook storm behavior proven | TODO | Tori | TODO | TODO | Must prove dedupe/idempotency. |
| Postmark degradation behavior proven | TODO | Tori | TODO | TODO | Must prove retry/manual follow-up path. |
| Twilio degradation behavior proven | TODO | Tori | TODO | TODO | Must prove retry/manual follow-up path. |
| DB replica lag/stale-read behavior proven | TODO | Tori | TODO | TODO | Must not finalize critical state from stale reads. |
| P1/P2 alerts link to runbooks | TODO | Tori | docs/launch-readiness/slack-alerts.md | TODO | No orphan alerts. |
| Provider quota/capacity confirmed | TODO | Tori | TODO | TODO | Stripe, Twilio, Postmark, storage, database, Redis, Vercel. |
| Rollback path documented | TODO | Tori | docs/launch-readiness/public-rollout-checklist.md | TODO | Must include trigger thresholds. |
| High-severity risks closed or accepted | TODO | Tori | docs/launch-readiness/risk-register.md | TODO | No unowned high-severity risk. |
| Final launch sign-off completed | TODO | Tori | This document | TODO | Required before public rollout. |

## Automatic NO-GO conditions

Private beta is automatically NO-GO if any of these are true:

- pnpm typecheck fails.
- pnpm verify:privacy-phase1 fails.
- Health/readiness proof is missing.
- Booking lifecycle smoke proof is missing.
- Stripe webhook verification proof is missing.
- Storage/private-media proof is missing.
- Slack alert destination is missing.
- No owner is assigned for P1 alerts.
- Export/delete route authorization proof fails.
- A suspected PII leak, audit-redaction failure, or privacy-boundary regression is open.
- A high-severity risk in risk-register.md has no owner.

Public rollout is automatically NO-GO if any of these are true:

- Any private-beta blocker remains open.
- No named backup owner exists.
- P1 escalation path has not been tested.
- P1/P2 alerts do not link to runbooks.
- Load tests are missing or failing for booking/payment/media/notification paths.
- Chaos tests are missing or failing for required dependency failures.
- Provider quota/capacity is unknown.
- Rollback criteria are missing.
- risk-register.md contains unowned high-severity risks.
- Final sign-off is incomplete.

## Required launch commands

Run these before private beta decision:

bash pnpm typecheck pnpm verify:privacy-phase1 

Run these before public rollout decision:

bash pnpm typecheck pnpm test pnpm verify:privacy-phase1 pnpm test:chaos pnpm test:load:launch 

If pnpm test:load:launch requires staging-only secrets or seeded IDs, record the exact command, environment, commit, and output in the evidence section instead of running it locally.

## Required dashboard sections

The launch dashboard must cover:

1. Health/readiness
2. Booking funnel
3. Pro session lifecycle
4. Media uploads
5. Payments/webhooks
6. Notifications
7. Background jobs
8. Auth/rate limits
9. Infrastructure dependencies
10. SLO/error budget

The dashboard is not launch-ready unless each section has an owner, source signal, threshold, and related runbook or follow-up.

## Required alert categories

At minimum, launch alerts must cover:

| Area | Minimum alert |
|---|---|
| Health/readiness | Readiness failing |
| Database | Postgres unavailable or severe query failures |
| Redis/rate limits | Redis unavailable or high-risk route rate-limit safety degraded |
| Booking | Hold creation failure spike |
| Booking | Booking finalize failure spike |
| Availability | Bootstrap/day availability latency or error spike |
| Pro session | Session lifecycle or closeout failure spike |
| Media | Upload/signing/metadata failure spike |
| Private media | Private media access policy regression |
| Payments/webhooks | Stripe webhook verification or processing failure spike |
| Notifications | Backlog or delivery failure spike |
| Email | Postmark degradation |
| SMS | Twilio degradation |
| Auth | Login/register/password-reset failure spike |
| SLO | Error budget burn |

## Required runbook links

Use existing runbooks where possible:

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

If a runbook is missing, either create it or explicitly map the alert to a sufficient existing runbook.

## Risk acceptance rules

A risk can be accepted only if:

- It is listed in docs/launch-readiness/risk-register.md.
- It has an owner.
- It has severity.
- It has mitigation.
- It has a launch-stage decision: private beta, public rollout, or deferred.
- It does not violate privacy/security/payment correctness.

The following cannot be accepted as casual risk:

- Known privacy-boundary failure.
- Known payment double-charge or webhook dedupe failure.
- Known private media access leak.
- Known export/delete authorization failure.
- Known booking finalize data-integrity failure.
- No rollback path for public rollout.

## Current known accepted/deferred areas

These are not automatically launch blockers if tracked and accepted, but they must stay visible:

| Area | Launch treatment | Tracking |
|---|---|---|
| PII plaintext-read baseline | Accepted Phase 1 baseline; burn down over time | docs/privacy/phase-1-privacy-proof.md |
| Booking-level anonymization beyond Phase 1 boundary | Deferred beyond Phase 1 conservative implementation | docs/privacy/phase-1-remaining-work.md |
| Message deletion implementation | Deferred until retention/ownership policy is converted into code | docs/privacy/phase-1-remaining-work.md |
| Storage object byte deletion workflow | Deferred follow-up; must be tracked for privacy operations | docs/privacy/phase-1-remaining-work.md |
| Launch-environment backfill reruns | Required before public launch if launch env has relevant rows | docs/privacy/phase-1-remaining-work.md |
| Missing named backup owner | Allowed only as private-beta accepted risk; public launch blocker | docs/launch-readiness/oncall.md |

## Private beta sign-off

Complete this section when private beta gates are reviewed.

| Role | Name | Decision | Date | Notes |
|---|---|---|---|---|
| Product/owner | Tori | TODO | TODO | TODO |
| Engineering | Tori | TODO | TODO | TODO |
| Privacy/security | Tori | TODO | TODO | TODO |
| Support/comms | Tori | TODO | TODO | TODO |

Private beta decision:

text Decision: TODO Commit: TODO Environment: TODO Date: TODO Accepted risks: TODO Launch notes: TODO 

## Public rollout sign-off

Complete this section only after private beta evidence, load proof, chaos proof, alert routing, and rollback criteria are complete.

| Role | Name | Decision | Date | Notes |
|---|---|---|---|---|
| Product/owner | Tori | TODO | TODO | TODO |
| Engineering | Tori | TODO | TODO | TODO |
| Privacy/security | Tori | TODO | TODO | TODO |
| Support/comms | Tori | TODO | TODO | TODO |
| Backup owner | TODO | TODO | TODO | Required before public rollout. |

Public rollout decision:

text Decision: TODO Commit: TODO Environment: TODO Date: TODO Accepted risks: TODO Rollout stage: TODO Rollback trigger: TODO Launch notes: TODO 

## Maintenance rule

Do not change a gate from TODO, FAIL, or BLOCKED to PASS without evidence. If evidence is not linked or recorded, the gate is still open.

This document should be strict. A launch gate that does not block anything is just a vibes checklist wearing a tiny hard hat.