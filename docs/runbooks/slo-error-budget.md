# SLO / Error Budget Incident Runbook

## Status

Phase: Phase 2 — Launch ops proof  
Scope: Private beta and public rollout reliability readiness  
Incident area: API error rate, latency, SLO/error budget burn, broad reliability degradation  
Primary owner: Tori  
Backup owner: TODO — public rollout blocker  
Related alert: API error budget burn exceeds threshold  
Related launch docs:
- docs/launch-readiness/oncall.md
- docs/launch-readiness/slack-alerts.md
- docs/launch-readiness/sentry-dashboard.md
- docs/launch-readiness/go-no-go.md
- docs/launch-readiness/risk-register.md
- docs/launch-readiness/load-test-plan.md
- docs/launch-readiness/chaos-test-plan.md
- docs/launch-readiness/test-proof.md

This runbook is used when the app is not clearly “down,” but reliability is degraded enough that launch confidence is affected.

This covers broad API error spikes, route latency spikes, Sentry issue bursts, degraded core flows, error-budget burn, and “everything is technically alive but behaving like it has been cursed by a tiny infrastructure goblin.”

---

# When to use this runbook

Use this runbook when:

- API error rate rises above launch threshold.
- Multiple launch-critical routes show elevated failures.
- p95 or p99 latency exceeds accepted launch thresholds.
- Sentry shows a new error burst after deploy.
- Load-test baselines drift badly.
- Dashboard health looks degraded but no single provider is clearly responsible.
- Private beta users report multiple unrelated slow/failing flows.
- A launch decision depends on whether reliability is still acceptable.

Use a more specific runbook if the issue clearly maps to one area:

| Symptom | Use runbook |
|---|---|
| Health/readiness failing | docs/runbooks/health-readiness.md |
| Database unavailable or severe query errors | docs/runbooks/postgres-outage.md |
| Redis/rate-limit degradation | docs/runbooks/redis-outage.md |
| Storage/media failures | docs/runbooks/supabase-storage-outage.md |
| Private media access issue | docs/runbooks/private-media-incident.md |
| Stripe/payment degradation | docs/runbooks/stripe-degradation.md |
| Postmark degradation | docs/runbooks/postmark-degradation.md |
| Twilio degradation | docs/runbooks/twilio-degradation.md |
| Notification backlog | docs/runbooks/notification-backlog.md |
| Booking funnel failure | docs/runbooks/booking-funnel.md |
| Auth/session failure | docs/runbooks/auth-session.md |
| Pro lifecycle failure | docs/runbooks/pro-session-lifecycle.md |

---

# Severity guide

## P1 — Launch-stopping reliability incident

Treat as P1 if any of these are true:

- Core app availability is broadly degraded.
- Booking, payment, auth, media, or privacy routes have active widespread failures.
- API 5xx rate is high across multiple core routes.
- Error budget burn indicates launch should pause.
- A new deploy causes broad regression.
- Privacy, payment correctness, private media, or booking data integrity may be affected.
- Sentry intake or dashboards are unavailable during an active launch window.
- No one can determine whether the system is healthy.

## P2 — Degraded launch-critical reliability

Treat as P2 if:

- One launch-critical route is degraded but workaround exists.
- p95 latency exceeds threshold on a core path.
- Error rate is elevated but contained.
- Private beta users experience intermittent failures.
- Provider latency is elevated but app behavior remains safe.
- Background jobs are delayed but recoverable.

## P3 — Reliability warning

Treat as P3 if:

- Latency is trending upward but still below blocker threshold.
- Sentry issue volume is elevated but not user-blocking.
- Load-test baseline drift is detected.
- Dashboard panel is stale.
- Provider warning appears but app impact is not confirmed.

---

# Initial thresholds

These are starting thresholds for private beta. Tune after real dashboard data exists.

| Signal | Private beta threshold | Public rollout threshold |
|---|---:|---:|
| API 5xx across all routes | 3 or more in 15 minutes | 5 or more in 10 minutes |
| Booking finalize 5xx | 1 or more in 15 minutes | 3 or more in 10 minutes |
| Auth/register/login 5xx | 1 or more in 15 minutes | 3 or more in 10 minutes |
| Media metadata/upload 5xx | 1 or more in 15 minutes | 3 or more in 10 minutes |
| Stripe webhook processing failures | 1 or more in 15 minutes | 3 or more in 10 minutes |
| Notification processing failures | 3 or more in 30 minutes | 5 or more in 15 minutes |
| Core route p95 latency | Above local/staging baseline by 2x | Above accepted SLO threshold |
| Sentry new issue burst | 3 new unresolved issues in 30 minutes | 5 new unresolved issues in 15 minutes |
| Error budget burn | Any sustained burn during beta window | Public threshold must be defined before rollout |

These thresholds are intentionally conservative. Beta is not where we discover that “some errors are fine” actually means “the booking path is on fire.”

---

# Launch-critical routes / flows

Track error rate and latency for these launch-critical areas:

- Health/readiness
- Auth/register/login/password reset/phone correction
- Availability bootstrap/day availability
- Hold create
- Booking finalize
- Pro booking lifecycle routes
- Pro session finish/closeout
- Checkout mark-paid/waive/payment state
- Stripe webhook handling
- Media upload/signing/metadata
- Notification processing
- Privacy export/delete authorization
- Background jobs

If dashboard route names differ, update this runbook and the Sentry dashboard doc.

---

# First response checklist

1. Acknowledge the alert.
2. State severity: P1, P2, or P3.
3. Name the incident owner.
4. Open the Sentry dashboard.
5. Identify whether the problem is:
   - broad app failure
   - one route group
   - one provider dependency
   - one deploy/release
   - one user/pro/client cohort
6. Check recent deploys and release metadata.
7. Check top Sentry issues by count and affected users.
8. Check p95/p99 latency for launch-critical routes.
9. Check provider dashboards if dependency symptoms appear.
10. Decide whether to monitor, mitigate, roll back, pause launch, or escalate.

---

# Dashboard checks

Open docs/launch-readiness/sentry-dashboard.md and check the SLO/error budget section.

Review:

| Signal | What to check |
|---|---|
| API error rate | Is failure broad or route-specific? |
| New Sentry issues | Did a new issue begin after the latest deploy? |
| Top failing transactions | Which route/action is causing the burn? |
| p95/p99 latency | Which route is slow and when did it start? |
| Affected users | Is one beta user affected or everyone? |
| Release/environment | Is the issue tied to a specific deploy? |
| Provider dependency signals | DB, Redis, Storage, Stripe, Postmark, Twilio, Vercel |
| Load-test baseline | Are live results worse than smoke/baseline proof? |

If dashboard links are missing, this is itself a launch-readiness gap. Record it in:

- docs/launch-readiness/sentry-dashboard.md
- docs/launch-readiness/risk-register.md
- docs/launch-readiness/go-no-go.md

---

# Triage flow

## 1. Determine blast radius

Ask:

- Is this staging, production, or local-only?
- Is it all users or one beta tester?
- Is it all routes or one flow?
- Is it read-only behavior or mutation behavior?
- Does it affect privacy, payments, private media, or booking correctness?
- Did it start after a deploy?
- Is a provider degraded?

## 2. Classify the failing area

| Failing area | Next action |
|---|---|
| Health/readiness | Open health-readiness runbook |
| Auth/session | Open auth-session runbook |
| Booking funnel | Open booking-funnel runbook |
| Pro lifecycle | Open pro-session-lifecycle runbook |
| Payments/webhooks | Open Stripe runbook |
| Media/storage | Open Supabase/private media runbook |
| Notifications | Open notification/Postmark/Twilio runbook |
| Database | Open Postgres runbook |
| Redis/rate limits | Open Redis runbook |
| Unknown/broad | Continue with this SLO runbook |

## 3. Decide launch action

| Condition | Launch action |
|---|---|
| P1 active | Block or pause launch. |
| Privacy/payment/private-media/data-integrity risk | Block launch until resolved and re-tested. |
| P2 with workaround | Private beta may continue only if accepted and users are supported. |
| Dashboard blind spot | Do not public rollout. Private beta requires explicit accepted risk. |
| Sentry intake broken | Block launch. |
| Alert routing unavailable | Private beta requires accepted alternate path; public rollout blocked. |

---

# Mitigation options

Choose the safest available mitigation.

| Situation | Mitigation |
|---|---|
| Regression started after latest deploy | Roll back to last known good deploy. |
| One feature/route is failing | Disable or pause that flow if possible. |
| Booking/payment/media correctness uncertain | Stop affected writes until verified. |
| Provider degradation | Follow provider runbook and communicate impact. |
| Auth failures elevated | Pause beta expansion and use auth-session runbook. |
| Background jobs delayed | Monitor queue/backlog and use manual follow-up path. |
| Sentry issue burst but no confirmed user impact | Keep beta small, monitor closely, and create follow-up. |
| Dashboard/alert blind spot | Do not expand launch until observability is restored. |

Do not keep pushing rollout stages while SLO burn is active. That is not “moving fast”; that is feeding the bonfire.

---

# Rollback guidance

Rollback is recommended when:

- A new release correlates with the error or latency spike.
- Booking, payment, auth, media, or privacy routes are affected.
- There is no quick safe mitigation.
- Error rate continues rising.
- Sentry traces point to recently changed code.
- You cannot determine impact and beta users are active.

Rollback is not enough when:

- Bad data was written.
- Payments or webhook state may be wrong.
- Private media access may be exposed.
- Privacy/export/delete authorization may have failed.
- Provider outage is external and the app is still on the same dependency.
- Manual cleanup/backfill is required.

After rollback, verify:

1. Error rate returns to baseline.
2. p95/p99 latency returns to baseline.
3. Core route smoke checks pass.
4. No new issue continues on the old deploy.
5. Affected users/records are identified.
6. Launch docs are updated if readiness changed.

---

# Communication template

For private beta reliability degradation:

text We’re seeing elevated errors or latency in part of the app and are checking the affected route group now. We’re keeping the beta scope limited while we verify whether this is a deploy issue, provider issue, or isolated workflow problem. 

For launch-stopping reliability issue:

text Launch expansion is paused because a launch-critical reliability signal crossed threshold. We’re checking the affected routes, recent deploys, provider status, and rollback options before continuing. 

For resolved issue:

text The reliability issue has been mitigated and the affected route/error signal is back within the expected range. We’re keeping monitoring active and recording follow-up items before resuming any launch expansion. 

Keep updates factual. Do not guess root cause. Do not expose internal IDs unless needed. Do not include PII, tokens, full addresses, signed URLs, or provider secrets.

---

# Verification after mitigation

Before closing an SLO/error budget incident:

- Error rate is back under threshold.
- p95/p99 latency is back under threshold or accepted.
- No P1 launch-critical issue remains open.
- Sentry issue count has stabilized.
- Recent deploy/release correlation is understood.
- Provider status is known.
- Any affected user/booking/payment/media records are identified.
- Any manual follow-up is tracked.
- Dashboard/alert gaps are recorded.
- Risk register is updated if launch readiness changed.

---

# Evidence to record

Use this format for incidents or launch proof:

md ## SLO/error budget evidence  Status: PASS / FAIL / BLOCKED / MITIGATED Owner: Tori Backup: TODO Environment: staging / production Date: Related alert: Dashboard link: Sentry issue/event: Affected routes: Affected release: Runbook used: docs/runbooks/slo-error-budget.md  ### What happened  TODO  ### Impact  TODO  ### Signals checked  TODO  ### Mitigation  TODO  ### Verification  TODO  ### Follow-up  TODO  ### Launch decision  TODO 

Update these files when relevant:

- docs/launch-readiness/go-no-go.md
- docs/launch-readiness/risk-register.md
- docs/launch-readiness/sentry-dashboard.md
- docs/launch-readiness/slack-alerts.md
- docs/launch-readiness/oncall.md
- docs/launch-readiness/test-proof.md

---

# Alert mapping

Related alert:

| Field | Value |
|---|---|
| Alert name | API error budget burn exceeds threshold |
| Severity | P2 by default; escalate to P1 if core route, privacy, payment, media, auth, or booking integrity is affected |
| Owner | Tori |
| Backup | TODO |
| Destination | #tovis-ops-alerts or approved alternate |
| Dashboard | docs/launch-readiness/sentry-dashboard.md |
| Runbook | docs/runbooks/slo-error-budget.md |
| Status | TODO ROUTING PROOF |

Before public rollout, this alert must have:

- Threshold
- Dashboard link
- Routing proof
- Backup owner
- Escalation path
- Acknowledgement proof

---

# Suggested dashboard widgets

Create or link Sentry widgets for:

- Total API error rate by environment
- Top 10 failing transactions
- Top 10 new issues by release
- p95 transaction duration by route
- p99 transaction duration by route
- Error count by release
- Error count by environment
- Core booking route latency
- Auth route latency/errors
- Media route latency/errors
- Stripe webhook errors
- Notification job errors
- Background job duration/failure
- Error budget burn or equivalent reliability summary

Provider dashboards should be linked where Sentry is not source of truth.

---

# Data safety rules

Do not expose:

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
- Raw email or phone values outside approved privacy/security boundaries
- Signed private media URLs
- Private storage paths
- Full webhook payloads containing sensitive fields
- Full provider response bodies containing sensitive data

Use redacted IDs and minimal context in shared incident notes.

---

# Related proof commands

Useful local proof commands:

bash git rev-parse HEAD git status --short pnpm typecheck pnpm verify:privacy-phase1 pnpm test:chaos pnpm test:load:launch pnpm verify:launch-ops pnpm test 

Useful launch docs:

- docs/launch-readiness/test-proof.md
- docs/launch-readiness/go-no-go.md
- docs/launch-readiness/risk-register.md
- docs/launch-readiness/sentry-dashboard.md
- docs/launch-readiness/slack-alerts.md
- docs/launch-readiness/oncall.md
- docs/launch-readiness/load-test-plan.md
- docs/launch-readiness/chaos-test-plan.md

---

# Closeout checklist

Before closing the incident:

- [ ] Severity was assigned.
- [ ] Owner was named.
- [ ] Dashboard was checked.
- [ ] Sentry issue/event was reviewed.
- [ ] Top affected routes were identified.
- [ ] Release/deploy correlation was checked.
- [ ] Provider dashboards were checked where relevant.
- [ ] Error rate returned under threshold.
- [ ] p95/p99 latency returned under threshold or was accepted.
- [ ] Affected users/records were identified if applicable.
- [ ] Rollback/mitigation was verified.
- [ ] Follow-up was recorded.
- [ ] Launch docs were updated if readiness changed.
- [ ] Alert/runbook gaps were recorded.

---

# Maintenance rule

Do not close an SLO/error budget incident because “it seems fine now.”

Close it only after the relevant error and latency signals are back inside threshold, affected launch-critical flows are safe, and any launch-readiness impact is recorded.

For this runbook, “green” means the system is observable, stable, and safe enough to continue launch — not merely quiet.