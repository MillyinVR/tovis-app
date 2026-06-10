# Public Rollout Checklist

## Status

Phase: Phase 2 — Launch ops proof  
Scope: Public rollout readiness after private beta  
Current default decision: NO-GO  
Primary owner: Tori  
Backup owner: NONE — solo operator; accepted private-beta risk (2026-06-09, RISK-001); still required before public rollout  
Private beta required first: Yes  
Public rollout requires: private beta proof, load proof, chaos proof, alert proof, rollback proof, and signed go/no-go decision

This checklist defines the requirements before TOVIS can move from controlled private beta to public rollout. Public rollout means broader user exposure, higher provider dependency, less manual oversight per user, and stricter operational proof.

## Public rollout decision

| Field | Value |
|---|---|
| Decision | TODO |
| Target rollout date | TODO |
| Commit | TODO |
| Environment | TODO |
| Primary owner | Tori |
| Backup owner | TODO |
| Support channel | TODO |
| Slack ops channel | TODO |
| P1 escalation path | TODO |
| Rollback owner | TODO |
| Accepted risks | TODO |
| Blocking risks | TODO |

Decision values:

| Decision | Meaning |
|---|---|
| GO | All public rollout gates are green and evidence is linked. |
| GO WITH ACCEPTED RISKS | Required blockers are green, and non-blocking risks are accepted in risk-register.md. |
| NO-GO | One or more public rollout blockers are open. |
| DEFER | Decision is postponed because evidence is incomplete. |

## Public rollout rule

Public rollout cannot begin until:

1. Private beta has completed or has enough signed evidence to proceed.
2. All private beta blockers are closed.
3. A named backup owner exists.
4. P1 escalation has been tested.
5. Load tests pass against staging.
6. Chaos tests pass.
7. Launch dashboards and alerts are live.
8. Rollback path is documented and tested enough for launch.
9. High/Critical risks are mitigated or explicitly accepted.
10. go-no-go.md has a signed public rollout decision.

## Private beta exit proof

| Gate | Status | Owner | Evidence | Notes |
|---|---|---|---|---|
| Private beta decision recorded | TODO | Tori | docs/launch-readiness/private-beta-checklist.md | Required. |
| Private beta cohort size recorded | TODO | Tori | TODO | Required. |
| Private beta incidents reviewed | TODO | Tori | TODO | Include P1/P2/P3 summary. |
| No unresolved P1 beta incidents | TODO | Tori | TODO | Required. |
| No unowned P2 beta incidents | TODO | Tori | TODO | Required. |
| Beta support feedback reviewed | TODO | Tori | TODO | Required. |
| Beta bug list triaged by severity | TODO | Tori | TODO | Required. |
| Risk register updated after beta | TODO | Tori | docs/launch-readiness/risk-register.md | Required. |
| Decision to continue/expand recorded | TODO | Tori | docs/launch-readiness/go-no-go.md | Required. |

## Required local and CI proof

| Check | Status | Owner | Evidence | Notes |
|---|---|---|---|---|
| Launch commit recorded | TODO | Tori | TODO | Record git rev-parse HEAD. |
| Local branch matches intended launch commit | TODO | Tori | TODO | Record git rev-list --left-right --count HEAD...origin/main or PR branch/base. |
| pnpm typecheck passes | TODO | Tori | TODO | Required. |
| pnpm test passes | TODO | Tori | TODO | Required before public rollout unless explicitly narrowed with reason. |
| pnpm verify:privacy-phase1 passes | TODO | Tori | TODO | Required. |
| pnpm test:e2e or booking smoke equivalent passes | TODO | Tori | TODO | Required. |
| CI status is green for rollout PR/commit | TODO | Tori | TODO | Required if CI exists for these checks. |
| No uncommitted launch changes | TODO | Tori | TODO | Record git status --short. |

## Required deployed/staging proof

| Gate | Status | Owner | Evidence | Notes |
|---|---|---|---|---|
| Staging deploy verified | TODO | Tori | TODO | Link deploy/version. |
| Production deploy path verified | TODO | Tori | TODO | No public traffic until rollout begins. |
| Health/readiness staging proof exists | TODO | Tori | TODO | Must verify app and dependencies. |
| Provider-live readiness setting verified | TODO | Tori | TODO | Example: HEALTH_CHECK_PROVIDERS_LIVE=true if applicable. |
| Database connectivity verified | TODO | Tori | TODO | Required. |
| Redis/rate-limit backend verified | TODO | Tori | TODO | Required. |
| Supabase Storage verified | TODO | Tori | TODO | Required. |
| Stripe live/test-mode decision documented | TODO | Tori | TODO | Required. |
| Postmark environment verified | TODO | Tori | TODO | Required if email is enabled. |
| Twilio environment verified | TODO | Tori | TODO | Required if SMS is enabled. |
| Sentry release/environment visible | TODO | Tori | TODO | Required. |

## Required observability proof

| Section | Status | Owner | Evidence | Notes |
|---|---|---|---|---|
| Sentry dashboard exists | TODO | Tori | docs/launch-readiness/sentry-dashboard.md | Required. |
| Health/readiness panel live | TODO | Tori | TODO | Required. |
| Booking funnel panel live | TODO | Tori | TODO | Required. |
| Pro session lifecycle panel live | TODO | Tori | TODO | Required. |
| Media uploads panel live | TODO | Tori | TODO | Required. |
| Payments/webhooks panel live | TODO | Tori | TODO | Required. |
| Notifications panel live | TODO | Tori | TODO | Required. |
| Background jobs panel live | TODO | Tori | TODO | Required if jobs are beta/public-critical. |
| Auth/rate limits panel live | TODO | Tori | TODO | Required. |
| Infra dependencies panel live | TODO | Tori | TODO | Provider dashboards may be linked. |
| SLO/error budget panel live | TODO | Tori | TODO | Required. |
| Deployment markers visible | TODO | Tori | TODO | Required. |
| Console/log capture policy documented | TODO | Tori | TODO | Required. |
| PII/log redaction policy confirmed | TODO | Tori | TODO | Required. |

## Required alerting proof

| Gate | Status | Owner | Evidence | Notes |
|---|---|---|---|---|
| Slack alerts documented | TODO | Tori | docs/launch-readiness/slack-alerts.md | Required. |
| Slack alert channel chosen | TODO | Tori | TODO | Required. |
| P1/P2 alert owners assigned | TODO | Tori | TODO | Required. |
| Backup owner assigned | BLOCKED | Tori | TODO | Public rollout blocker. |
| P1 escalation path chosen | BLOCKED | Tori | TODO | Public rollout blocker. |
| P1 escalation path tested | BLOCKED | Tori | TODO | Public rollout blocker. |
| Synthetic staging alert tested | TODO | Tori | TODO | Required. |
| Every P1 alert has threshold | TODO | Tori | TODO | Required. |
| Every P1 alert has runbook | TODO | Tori | TODO | Required. |
| Every P2 alert has threshold | TODO | Tori | TODO | Required. |
| Every P2 alert has runbook | TODO | Tori | TODO | Required. |
| Alert routing tested after deploy | TODO | Tori | TODO | Required. |

## Required alert categories

| Area | Severity | Status | Evidence | Notes |
|---|---|---|---|---|
| Health/readiness failure | P1 | TODO | docs/runbooks/health-readiness.md | Required. |
| Database/Postgres outage | P1 | TODO | docs/runbooks/postgres-outage.md | Required. |
| Redis/rate-limit failure | P1 | TODO | docs/runbooks/redis-outage.md | Required. |
| Booking hold create failure spike | P2 | TODO | docs/runbooks/booking-funnel.md | Required. |
| Booking finalize failure spike | P1 | TODO | docs/runbooks/booking-funnel.md | Required. |
| Availability error/latency spike | P2 | TODO | docs/runbooks/booking-funnel.md | Required. |
| Pro session lifecycle failure spike | P2 | TODO | docs/runbooks/pro-session-lifecycle.md | Required. |
| Media upload/storage failure spike | P2 | TODO | docs/runbooks/supabase-storage-outage.md | Required. |
| Private media access regression | P1 | TODO | docs/runbooks/private-media-incident.md | Required. |
| Stripe checkout/webhook failure spike | P1 | TODO | docs/runbooks/stripe-degradation.md | Required. |
| Notification backlog/delivery failure | P2 | TODO | docs/runbooks/notification-backlog.md | Required. |
| Postmark degradation | P2 | TODO | docs/runbooks/postmark-degradation.md | Required if email enabled. |
| Twilio degradation | P2 | TODO | docs/runbooks/twilio-degradation.md | Required if SMS enabled. |
| Auth failure spike | P1 | TODO | docs/runbooks/auth-session.md | Required. |
| Rate-limit anomaly | P2 | TODO | docs/runbooks/redis-outage.md | Required. |
| API error budget burn | P2 | TODO | docs/runbooks/slo-error-budget.md | Required. |

## Required load test proof

Public rollout requires launch-critical load proof.

| Flow | Status | Owner | Evidence | Notes |
|---|---|---|---|---|
| Load test harness exists | PASS | Tori | `tests/load/*`; `tests/load/run-launch-load-suite.ts`; package scripts | Required. |
| pnpm test:load:launch exists | PASS | Tori | `pnpm test:load:launch` exists and is included in `pnpm verify:launch-ops` | Required. |
| Availability bootstrap load test | PASS LOCALLY / STAGING TODO | Tori | `pnpm test:load:availability`; local proof in `docs/launch-readiness/test-proof.md` | Required. |
| Hold create load test | PASS LOCALLY / STAGING TODO | Tori | `pnpm test:load:holds`; local proof in `docs/launch-readiness/test-proof.md` | Required. |
| Booking finalize load test | PASS LOCALLY / STAGING TODO | Tori | `pnpm test:load:booking-finalize`; local proof in `docs/launch-readiness/test-proof.md` | Required. |
| Media metadata load test | PASS LOCALLY / STAGING TODO | Tori | `pnpm test:load:media-metadata`; local proof in `docs/launch-readiness/test-proof.md` | Required. |
| Checkout load test | PASS LOCALLY / STAGING TODO | Tori | `pnpm test:load:checkout`; local proof in `docs/launch-readiness/test-proof.md` | Required. |
| Stripe webhook replay load test | PASS LOCALLY / STAGING TODO | Tori | `pnpm test:load:stripe-webhook-replay`; local proof in `docs/launch-readiness/test-proof.md` | Required. |
| Notification processing load test | PASS LOCALLY / STAGING TODO | Tori | `pnpm test:load:notifications`; local proof in `docs/launch-readiness/test-proof.md` | Required. |
| Load test summary recorded | PASS LOCALLY / STAGING TODO | Tori | Local proof recorded in `docs/launch-readiness/test-proof.md`; deployed staging proof still TODO | Include commit, env, date, RPS, latency, failure rates. |
| Load test cleanup verified | TODO | Tori | TODO | Prevent staging/test data mess. |

Required load-test summary fields:

```text
Commit: TODO
Environment: TODO
Date: TODO
Command: TODO
Total requests: TODO
RPS profile: TODO
Success rate: TODO
p50 latency: TODO
p95 latency: TODO
p99 latency: TODO
Real failures: TODO
Expected rate limits: TODO
Data cleanup: TODO
Dashboard link: TODO
Decision: TODO
```

## Required chaos/failure proof

Public rollout requires deterministic failure-mode proof.

| Scenario | Status | Owner | Evidence | Notes |
|---|---|---|---|---|
| Chaos test harness exists | PASS | Tori | `tests/chaos/*`; `pnpm test:chaos` | Required. |
| pnpm test:chaos exists | PASS | Tori | `pnpm test:chaos` passed locally: 6 files / 17 tests | Required. |
| Redis outage behavior proven | PASS LOCALLY / OPERATIONAL TODO | Tori | `tests/chaos/redis-outage.test.ts`; local proof in `docs/launch-readiness/test-proof.md` | Must not fail open on high-risk paths. |
| Supabase Storage outage behavior proven | PASS LOCALLY / OPERATIONAL TODO | Tori | `tests/chaos/supabase-storage-outage.test.ts`; local proof in `docs/launch-readiness/test-proof.md` | Must avoid unsafe media state. |
| Stripe webhook storm behavior proven | PASS LOCALLY / OPERATIONAL TODO | Tori | `tests/chaos/stripe-webhook-storm.test.ts`; local proof in `docs/launch-readiness/test-proof.md` | Must prove dedupe/idempotency. |
| Postmark degradation behavior proven | PASS LOCALLY / OPERATIONAL TODO | Tori | `tests/chaos/postmark-degradation.test.ts`; local proof in `docs/launch-readiness/test-proof.md` | Must prove retry/manual follow-up. |
| Twilio degradation behavior proven | PASS LOCALLY / OPERATIONAL TODO | Tori | `tests/chaos/twilio-degradation.test.ts`; local proof in `docs/launch-readiness/test-proof.md` | Must prove retry/manual follow-up. |
| DB replica lag/stale-read behavior proven | TODO | Tori | TODO | Critical writes must not rely on stale reads. |
| Chaos results recorded in risk register | TODO | Tori | docs/launch-readiness/risk-register.md | Required. |

Chaos tests should prefer deterministic mocked provider/client boundaries. Do not intentionally break real staging providers unless the test is isolated, scheduled, and reversible.

## Required privacy/security proof

| Gate | Status | Owner | Evidence | Notes |
|---|---|---|---|---|
| pnpm verify:privacy-phase1 passed on rollout commit | TODO | Tori | TODO | Required. |
| PII plaintext-read baseline reviewed | TODO | Tori | TODO | 471 known baseline entries accepted only if guard passes. |
| Audit redaction proof current | TODO | Tori | TODO | Required. |
| Export/delete SUPER_ADMIN gate proof current | TODO | Tori | TODO | Required. |
| Export safety deny-list proof current | TODO | Tori | TODO | Required. |
| HMAC v2 launch-env rerun decision documented | TODO | Tori | docs/privacy/phase-1-remaining-work.md | Required if env has rows. |
| AEAD address launch-env rerun decision documented | TODO | Tori | docs/privacy/phase-1-remaining-work.md | Required if env has rows. |
| Privacy request runbook current | TODO | Tori | docs/runbooks/privacy-request.md | Required. |
| Storage byte deletion limitation accepted or implemented | TODO | Tori | docs/launch-readiness/risk-register.md | Required. |
| Message deletion/retention limitation accepted or implemented | TODO | Tori | docs/launch-readiness/risk-register.md | Required. |

## Required payment proof

| Gate | Status | Owner | Evidence | Notes |
|---|---|---|---|---|
| Stripe environment decision documented | TODO | Tori | TODO | Test/live mode rules. |
| Checkout creation proof exists | TODO | Tori | TODO | Required. |
| Webhook signature verification proof exists | TODO | Tori | TODO | Required. |
| Webhook replay/idempotency proof exists | TODO | Tori | TODO | Required. |
| Refund/manual payment issue path documented | TODO | Tori | TODO | Required. |
| Stripe provider dashboard checked | TODO | Tori | TODO | Required. |
| Payment-related alerts active | TODO | Tori | TODO | Required. |

## Required media/storage proof

| Gate | Status | Owner | Evidence | Notes |
|---|---|---|---|---|
| Supabase Storage policies verified | TODO | Tori | TODO | Required. |
| Private media access proof exists | TODO | Tori | TODO | Required. |
| Media upload proof exists | TODO | Tori | TODO | Required. |
| Media metadata persistence proof exists | TODO | Tori | TODO | Required. |
| Storage outage behavior documented | TODO | Tori | docs/runbooks/supabase-storage-outage.md | Required. |
| Private media incident runbook current | TODO | Tori | docs/runbooks/private-media-incident.md | Required. |

## Required provider quota/capacity proof

| Provider/dependency | Status | Owner | Evidence | Notes |
|---|---|---|---|---|
| Vercel/deploy capacity | TODO | Tori | TODO | Required. |
| Database/Postgres capacity | TODO | Tori | TODO | Required. |
| Redis/rate-limit capacity | TODO | Tori | TODO | Required. |
| Supabase Storage capacity/policy | TODO | Tori | TODO | Required. |
| Stripe account/webhook capacity | TODO | Tori | TODO | Required. |
| Postmark quota/sending limits | TODO | Tori | TODO | Required if email enabled. |
| Twilio quota/sending limits | TODO | Tori | TODO | Required if SMS enabled. |
| Sentry quota/project limits | TODO | Tori | TODO | Required. |
| Domain/DNS readiness | TODO | Tori | TODO | Required. |

## Rollout stages

Use staged rollout. Do not jump from private beta to broad public exposure in one step.

| Stage | Traffic/user scope | Decision gate | Status | Notes |
|---|---|---|---|---|
| Stage 0 | Internal/admin only | Deploy + health proof | TODO | No public traffic. |
| Stage 1 | Private beta cohort | Private beta checklist | TODO | Known users only. |
| Stage 2 | Expanded beta | No unresolved P1/P2, dashboard/alerts green | TODO | Controlled growth. |
| Stage 3 | Limited public rollout | Load/chaos proof green, backup owner named | TODO | Small public exposure. |
| Stage 4 | Full public rollout | All public gates green | TODO | Broader launch. |

## Rollback triggers

Rollback or pause rollout if any of these occur:

- Booking finalize failure spike exceeds threshold.
- Payment/webhook correctness issue appears.
- Stripe webhook replay/idempotency fails.
- Private media access regression appears.
- PII/logging/audit-redaction issue appears.
- Export/delete authorization proof fails.
- Database or Redis instability affects core flows.
- Auth/session failure spike affects users.
- Provider degradation blocks core booking/payment/notification flows.
- P1 alert fires and cannot be acknowledged/escalated.
- A high-severity risk becomes unowned.
- Support load exceeds defined coverage.

## Rollback plan

| Item | Status | Owner | Evidence/notes |
|---|---|---|---|
| Rollback owner named | TODO | Tori | TODO |
| Backup rollback owner named | TODO | Tori | Required before public rollout. |
| Last known good commit recorded | TODO | Tori | TODO |
| Deploy rollback process documented | TODO | Tori | TODO |
| Feature disable/kill switch path documented | TODO | Tori | TODO |
| Payment/webhook rollback notes documented | TODO | Tori | TODO |
| Media/storage rollback notes documented | TODO | Tori | TODO |
| Notification disable/degrade path documented | TODO | Tori | TODO |
| User communication path documented | TODO | Tori | TODO |
| Post-rollback verification checklist documented | TODO | Tori | TODO |

Post-rollback verification:

```text
Health/readiness: TODO
Booking flow: TODO
Payment/webhook: TODO
Media/private-media: TODO
Notifications: TODO
Auth/session: TODO
Sentry errors: TODO
Open incidents: TODO
User comms: TODO
Decision: TODO
```

## Support readiness

| Gate | Status | Owner | Evidence | Notes |
|---|---|---|---|---|
| Public support channel defined | TODO | Tori | TODO | Required. |
| Support hours defined | TODO | Tori | TODO | Required. |
| Escalation from support to engineering defined | TODO | Tori | TODO | Required. |
| Payment support path defined | TODO | Tori | TODO | Required. |
| Privacy request support path defined | TODO | Tori | TODO | Required. |
| Known limitations documented | TODO | Tori | TODO | Required. |
| Incident user-comms template drafted | TODO | Tori | TODO | Required. |
| Refund/manual resolution path documented | TODO | Tori | TODO | Required if payments are public. |

## Automatic public rollout NO-GO

Public rollout is automatically blocked if any of the following are true:

- Any private beta blocker remains open.
- No named backup owner exists.
- P1 escalation path is missing or untested.
- pnpm typecheck fails.
- pnpm test fails without documented acceptance.
- pnpm verify:privacy-phase1 fails.
- Health/readiness proof is missing.
- Booking lifecycle proof is missing.
- Payment/webhook proof is missing.
- Private media proof is missing.
- Sentry dashboard proof is missing.
- P1/P2 alerts are not mapped to runbooks.
- Load tests are missing or failing.
- Chaos tests are missing or failing.
- Provider quotas are unknown.
- Rollback path is missing.
- High/Critical risks are unowned or unaccepted.
- Final sign-off is incomplete.

## Final public rollout sign-off

| Role | Name | Decision | Date | Notes |
|---|---|---|---|---|
| Product/owner | Tori | TODO | TODO | TODO |
| Engineering | Tori | TODO | TODO | TODO |
| Privacy/security | Tori | TODO | TODO | TODO |
| Support/comms | Tori | TODO | TODO | TODO |
| Backup owner | TODO | TODO | TODO | Required before public rollout. |

Final decision:

```text
Decision: TODO
Commit: TODO
Environment: TODO
Rollout stage: TODO
Start date/time: TODO
Accepted risks: TODO
Blocking risks: TODO
Rollback owner: TODO
Rollback trigger: TODO
Support channel: TODO
Dashboard link: TODO
Alert proof: TODO
Load proof: TODO
Chaos proof: TODO
Notes: TODO
```

## Related documents

- docs/launch-readiness/oncall.md
- docs/launch-readiness/go-no-go.md
- docs/launch-readiness/private-beta-checklist.md
- docs/launch-readiness/risk-register.md
- docs/launch-readiness/sentry-dashboard.md
- docs/launch-readiness/slack-alerts.md
- docs/launch-readiness/checklist.md
- docs/privacy/phase-1-privacy-proof.md
- docs/privacy/phase-1-remaining-work.md
- docs/privacy/retention-policy.md
- docs/runbooks/privacy-request.md

## Maintenance rule

Do not mark public rollout GO unless the evidence exists. Public rollout is not the place to discover that dashboards are decorative, alerts are imaginary, or rollback is a motivational concept.