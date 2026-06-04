# Private Beta Checklist

## Status

Phase: Phase 2 — Launch ops proof  
Scope: Controlled private beta only  
Current default decision: NO-GO until required evidence is linked  
Primary owner: Tori  
Backup owner: TODO — required before public rollout, optional only as an accepted private-beta risk  
Alerting path: Slack-first  
Dashboard surface: Sentry-first, with provider dashboards linked where needed

This checklist defines the minimum requirements before TOVIS can enter private beta with a limited group of users. Private beta is not public launch. It is a controlled release with known users, explicit support coverage, and fast rollback.

## Private beta purpose

Private beta exists to prove:

- Real users can complete the core booking flow.
- Pros can manage session lifecycle without unsafe state transitions.
- Payments and webhooks behave correctly.
- Media upload and private-media boundaries hold.
- Notifications send or fail safely.
- Privacy/export/delete foundations remain protected.
- Launch dashboards and Slack alerts provide enough operational visibility.
- Support and rollback paths are clear before the app is exposed more broadly.

## Private beta decision

| Field | Value |
|---|---|
| Decision | TODO |
| Target start date | TODO |
| Target end date | TODO |
| Commit | TODO |
| Environment | TODO |
| Owner | Tori |
| Backup | TODO |
| Support channel | TODO |
| Slack ops channel | TODO |
| Accepted risks | TODO |
| Blocking risks | TODO |

Decision values:

| Decision | Meaning |
|---|---|
| GO | All required private-beta gates are green. |
| GO WITH ACCEPTED RISKS | Required gates are green, but known risks are documented and accepted. |
| NO-GO | One or more private-beta blockers are open. |
| DEFER | Decision is postponed because evidence is incomplete. |

## Beta cohort

| Item | Status | Owner | Evidence/notes |
|---|---|---|---|
| Max beta user count defined | TODO | Tori | TODO |
| Beta invite list created | TODO | Tori | TODO |
| Beta pro list created | TODO | Tori | TODO |
| Beta client list created | TODO | Tori | TODO |
| Test/service geography defined | TODO | Tori | TODO |
| Support expectations communicated | TODO | Tori | TODO |
| Known limitations communicated | TODO | Tori | TODO |
| Feedback collection path defined | TODO | Tori | TODO |
| Bug escalation path defined | TODO | Tori | TODO |

Recommended starting limit:

text Private beta should start with a small known cohort before expanding. Do not begin with public signup traffic. 

## Required pre-beta proof

| Gate | Status | Owner | Evidence | Notes |
|---|---|---|---|---|
| Local branch matches intended beta commit | TODO | Tori | TODO | Record git rev-parse HEAD. |
| pnpm typecheck passes | TODO | Tori | TODO | Required. |
| pnpm verify:privacy-phase1 passes | TODO | Tori | TODO | Required. |
| pnpm test passes or focused equivalent is documented | TODO | Tori | TODO | Full suite preferred. |
| Staging deploy verified | TODO | Tori | TODO | Link deploy/version. |
| Sentry release/environment tagging exists | TODO | Tori | TODO | Required for meaningful beta debugging. |
| Health/readiness proof exists | TODO | Tori | TODO | Must include staging. |
| Booking lifecycle smoke proof exists | TODO | Tori | TODO | Client booking + pro session path. |
| Payment/Stripe webhook proof exists | TODO | Tori | TODO | Signed webhook + idempotency/replay behavior. |
| Media upload proof exists | TODO | Tori | TODO | Upload path and metadata persistence. |
| Private media policy proof exists | TODO | Tori | TODO | Private media cannot be publicly accessed. |
| Notifications proof exists | TODO | Tori | TODO | Email/SMS behavior or safe failure path. |
| Export/delete route authorization proof exists | TODO | Tori | TODO | SUPER_ADMIN only. |
| Privacy request runbook exists | TODO | Tori | docs/runbooks/privacy-request.md | Confirm current. |
| Phase 1 remaining work reviewed | TODO | Tori | docs/privacy/phase-1-remaining-work.md | Confirm no private-beta blocker remains. |

## Required docs

| Document | Status | Owner | Notes |
|---|---|---|---|
| docs/launch-readiness/oncall.md | TODO | Tori | Must name owner and alert path. |
| docs/launch-readiness/go-no-go.md | TODO | Tori | Must contain private beta gate. |
| docs/launch-readiness/private-beta-checklist.md | TODO | Tori | This file. |
| docs/launch-readiness/risk-register.md | TODO | Tori | Required before GO decision. |
| docs/launch-readiness/sentry-dashboard.md | TODO | Tori | Required before beta. |
| docs/launch-readiness/slack-alerts.md | TODO | Tori | Required before beta. |

## Required dashboard sections

Before private beta, the Sentry/dashboard proof must cover at least:

| Section | Status | Evidence | Notes |
|---|---|---|---|
| Health/readiness | TODO | TODO | Required. |
| Booking funnel | TODO | TODO | Required. |
| Pro session lifecycle | TODO | TODO | Required. |
| Media uploads | TODO | TODO | Required. |
| Payments/webhooks | TODO | TODO | Required. |
| Notifications | TODO | TODO | Required. |
| Background jobs | TODO | TODO | Required if any beta-critical jobs exist. |
| Auth/rate limits | TODO | TODO | Required. |
| Infrastructure dependencies | TODO | TODO | Provider dashboards may be linked. |
| SLO/error budget | TODO | TODO | At minimum: error rate and p95 latency. |

## Required private-beta alerts

Private beta does not require PagerDuty/Opsgenie, but it does require Slack alerts for critical signals.

| Alert area | Severity | Status | Runbook | Notes |
|---|---|---|---|---|
| Readiness failing | P1 | TODO | docs/runbooks/health-readiness.md | Required. |
| Database/Postgres outage | P1 | TODO | docs/runbooks/postgres-outage.md | Required. |
| Redis/rate-limit safety issue | P1 | TODO | docs/runbooks/redis-outage.md | Required. |
| Booking finalize failure spike | P1 | TODO | TODO | Required. |
| Hold create failure spike | P2 | TODO | TODO | Required. |
| Availability bootstrap error/latency spike | P2 | TODO | docs/runbooks/health-readiness.md | Required. |
| Stripe webhook verification/processing failure | P1 | TODO | docs/runbooks/stripe-degradation.md | Required. |
| Media upload/storage failure | P2 | TODO | docs/runbooks/supabase-storage-outage.md | Required. |
| Private media policy regression | P1 | TODO | docs/runbooks/private-media-incident.md | Required. |
| Notification backlog/delivery failure | P2 | TODO | docs/runbooks/notification-backlog.md | Required. |
| Postmark degradation | P2 | TODO | docs/runbooks/postmark-degradation.md | Required if email is beta-critical. |
| Twilio degradation | P2 | TODO | docs/runbooks/twilio-degradation.md | Required if SMS is beta-critical. |
| Auth failure spike | P1 | TODO | TODO | Required. |
| Rate-limit anomaly | P2 | TODO | docs/runbooks/redis-outage.md | Required. |

Every alert must have an owner, Slack destination, threshold, runbook, and first-response instruction in docs/launch-readiness/slack-alerts.md.

## Support coverage

| Item | Status | Owner | Notes |
|---|---|---|---|
| Private beta support hours defined | TODO | Tori | TODO |
| Support contact/channel chosen | TODO | Tori | TODO |
| Bug intake path defined | TODO | Tori | TODO |
| User-impact message template drafted | TODO | Tori | TODO |
| Payment issue escalation path defined | TODO | Tori | TODO |
| Privacy request escalation path defined | TODO | Tori | TODO |
| Refund/manual payment handling decision documented | TODO | Tori | TODO |
| Beta participant expectations documented | TODO | Tori | TODO |

## Feature scope

Private beta should include only the flows required to prove launch readiness.

| Feature/flow | Included in beta? | Status | Notes |
|---|---:|---|---|
| Client signup/login | TODO | TODO | TODO |
| Pro signup/login | TODO | TODO | TODO |
| Pro onboarding/readiness | TODO | TODO | TODO |
| Search/discovery | TODO | TODO | TODO |
| Availability bootstrap/day availability | TODO | TODO | TODO |
| Hold create | TODO | TODO | TODO |
| Booking finalize | TODO | TODO | TODO |
| Checkout/payment | TODO | TODO | TODO |
| Stripe webhook processing | TODO | TODO | TODO |
| Pro session lifecycle | TODO | TODO | TODO |
| Aftercare/rebook | TODO | TODO | TODO |
| Media upload | TODO | TODO | TODO |
| Notifications | TODO | TODO | TODO |
| Export/delete admin routes | Admin-only proof | TODO | Not beta user-facing. |
| White-label/tenant features | No | TODO | Not ready for beta unless explicitly scoped. |

## Kill switch and rollback

Private beta requires a clear rollback path.

| Item | Status | Owner | Evidence/notes |
|---|---|---|---|
| Rollback owner named | TODO | Tori | TODO |
| Last known good commit identified | TODO | Tori | TODO |
| Deploy rollback process documented | TODO | Tori | TODO |
| Feature disable/kill switch strategy documented | TODO | Tori | TODO |
| Payment/webhook safe rollback note documented | TODO | Tori | TODO |
| Media/storage rollback note documented | TODO | Tori | TODO |
| Notification disable strategy documented | TODO | Tori | TODO |
| User communication path documented | TODO | Tori | TODO |

Rollback triggers:

- Booking finalize failure spike.
- Payment/webhook correctness issue.
- Private media access regression.
- PII/logging/audit-redaction concern.
- Auth/session instability.
- Provider degradation that blocks core flow.
- Any high-severity issue without an owner.

## Data and privacy checks

| Check | Status | Owner | Evidence/notes |
|---|---|---|---|
| Phase 1 privacy verification passed on beta commit | TODO | Tori | TODO |
| PII baseline reviewed | TODO | Tori | 471 known baseline entries accepted for Phase 1. |
| Audit redaction remains enabled | TODO | Tori | TODO |
| Export safety deny-list remains enforced | TODO | Tori | TODO |
| SUPER_ADMIN gating verified for export/delete | TODO | Tori | TODO |
| HMAC v2 launch-env rerun decision documented | TODO | Tori | TODO |
| AEAD address launch-env rerun decision documented | TODO | Tori | TODO |
| Privacy request runbook confirmed current | TODO | Tori | docs/runbooks/privacy-request.md |

## Provider readiness

| Provider/dependency | Status | Owner | Evidence/notes |
|---|---|---|---|
| Vercel/deploy environment | TODO | Tori | TODO |
| Database/Postgres | TODO | Tori | TODO |
| Redis/rate-limit backend | TODO | Tori | TODO |
| Supabase Storage | TODO | Tori | TODO |
| Stripe | TODO | Tori | TODO |
| Postmark | TODO | Tori | TODO |
| Twilio | TODO | Tori | TODO |
| Sentry | TODO | Tori | TODO |
| Domain/DNS | TODO | Tori | TODO |
| Secrets/env vars | TODO | Tori | TODO |

Minimum env/secrets check:

- App base URL
- Database URL
- Redis/rate-limit credentials
- Supabase URL and service role key
- Stripe secret and webhook secret
- Postmark token
- Twilio credentials
- Sentry DSN/environment/release
- PII AEAD key config
- PII HMAC lookup key config
- Turnstile/CAPTCHA config if enabled

Do not paste secret values into this file. Record only present, missing, or verified by deploy environment.

## Daily beta review

During private beta, review this daily.

| Review item | Status | Notes |
|---|---|---|
| New P1/P2 incidents | TODO | TODO |
| Booking funnel failures | TODO | TODO |
| Payment/webhook failures | TODO | TODO |
| Media upload failures | TODO | TODO |
| Notification failures | TODO | TODO |
| Auth/session failures | TODO | TODO |
| Privacy/security concerns | TODO | TODO |
| Support tickets/feedback | TODO | TODO |
| Open bugs by severity | TODO | TODO |
| New risks added to risk register | TODO | TODO |
| Continue beta / pause / rollback decision | TODO | TODO |

## Exit criteria from private beta

Private beta can move toward public rollout only when:

- No unresolved P1 issues remain.
- No unowned P2 issues remain.
- Booking flow is stable for the beta cohort.
- Payment/webhook processing is stable.
- Media/private-media behavior is stable.
- Notifications are stable or safe failure paths are documented.
- Support process is working.
- Sentry dashboard has useful real data.
- Slack alerts have been exercised.
- Load tests exist and pass against staging.
- Chaos tests exist and pass.
- Backup owner and public-launch escalation path are named.
- Public rollout checklist is complete.
- Risk register has no unowned high-severity risks.

## Automatic private-beta NO-GO

Private beta is automatically blocked if any of the following are true:

- pnpm typecheck fails.
- pnpm verify:privacy-phase1 fails.
- Health/readiness proof is missing.
- Booking lifecycle smoke proof is missing.
- Stripe webhook verification proof is missing.
- Storage/private-media proof is missing.
- Slack alert destination is missing.
- No P1 owner is assigned.
- Export/delete route authorization proof fails.
- A suspected PII leak or privacy-boundary regression is open.
- A high-severity risk has no owner.
- Rollback owner/path is missing.

## Sign-off

| Role | Name | Decision | Date | Notes |
|---|---|---|---|---|
| Product/owner | Tori | TODO | TODO | TODO |
| Engineering | Tori | TODO | TODO | TODO |
| Privacy/security | Tori | TODO | TODO | TODO |
| Support/comms | Tori | TODO | TODO | TODO |

Final private beta decision:

text Decision: TODO Commit: TODO Environment: TODO Start date: TODO Max beta users: TODO Accepted risks: TODO Blocking risks: TODO Rollback trigger: TODO Support channel: TODO Notes: TODO 

## Related documents

- docs/launch-readiness/oncall.md
- docs/launch-readiness/go-no-go.md
- docs/launch-readiness/sentry-dashboard.md
- docs/launch-readiness/slack-alerts.md
- docs/launch-readiness/risk-register.md
- docs/launch-readiness/public-rollout-checklist.md
- docs/launch-readiness/checklist.md
- docs/privacy/phase-1-privacy-proof.md
- docs/privacy/phase-1-remaining-work.md
- docs/runbooks/privacy-request.md

## Maintenance rule

Do not mark private beta as GO unless the required proof exists and is linked. Private beta is allowed to be small and imperfect; it is not allowed to be blind.