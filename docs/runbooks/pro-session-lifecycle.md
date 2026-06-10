# Pro Session Lifecycle Incident Runbook

## Status

Phase: Phase 2 — Launch ops proof  
Scope: Private beta and public rollout operational readiness  
Incident area: Pro session lifecycle, closeout, aftercare, media/payment blockers  
Primary owner: Tori  
Backup owner: NONE — solo operator; accepted private-beta risk (2026-06-09, RISK-001); public rollout blocker  
Related alert: Pro session lifecycle or closeout failure spike  
Related launch docs:
- docs/launch-readiness/oncall.md
- docs/launch-readiness/slack-alerts.md
- docs/launch-readiness/sentry-dashboard.md
- docs/launch-readiness/go-no-go.md
- docs/launch-readiness/risk-register.md

This runbook is used when pros cannot start, progress, close out, or complete session-related actions safely.

The goal is not “make the error go away.” The goal is to protect booking state, payment state, client/pro trust, private media, and aftercare records while figuring out what broke. Tiny distinction. Very large consequences.

---

# When to use this runbook

Use this runbook for incidents involving:

- Pro session page failures
- Session start/check-in failures
- Session lifecycle transition failures
- Illegal state transition spikes
- Closeout failures
- Final review or aftercare blockers
- Session finish failures
- Media-related closeout blockers
- Payment/checkout-related closeout blockers
- Booking state mismatches visible during pro workflow
- Pros reporting that completed services cannot be closed out

Use a more specific runbook if the root cause is clearly isolated:

| Root cause | Use runbook |
|---|---|
| Database unavailable or severe query failures | docs/runbooks/postgres-outage.md |
| Redis/rate-limit/session safety issue | docs/runbooks/redis-outage.md |
| Storage/media provider failure | docs/runbooks/supabase-storage-outage.md |
| Private media access issue | docs/runbooks/private-media-incident.md |
| Stripe/payment provider issue | docs/runbooks/stripe-degradation.md |
| Notification backlog/delivery issue | docs/runbooks/notification-backlog.md |

---

# Severity guide

## P1 — Launch-stopping

Treat as P1 if any of these are true:

- Pros broadly cannot complete sessions.
- Session lifecycle state integrity is uncertain.
- A session can be completed from an invalid state.
- Closeout creates wrong booking/payment/media state.
- Private media access is suspected to be exposed incorrectly.
- Payment/checkout state can be corrupted from session workflow.
- A recent deploy caused widespread pro workflow failures.
- There is a suspected privacy, payment, or booking data-integrity regression.

## P2 — Degraded launch-critical flow

Treat as P2 if:

- Some pros cannot complete closeout.
- Session action failures are elevated but contained.
- Closeout blockers are noisy or unclear.
- Session-related errors affect a subset of bookings.
- Workaround exists, but support/manual follow-up is needed.

## P3 — Operational warning

Treat as P3 if:

- Session errors are elevated but not blocking users.
- Dashboard panels are stale or missing.
- Closeout latency is trending high.
- A non-critical lifecycle action is flaky.
- A beta tester reports confusing but recoverable behavior.

---

# User impact

Possible impact:

- Pros may be unable to complete appointments.
- Clients may not receive correct completion, aftercare, media, payment, or notification updates.
- Booking status may appear stuck.
- Payment or checkout steps may be delayed.
- Support may need to manually verify booking/session state.
- In severe cases, booking lifecycle integrity may be uncertain.

Do not promise users that state is correct until the relevant booking, session, payment, and media records have been checked.

---

# First response checklist

1. Acknowledge the alert or report.
2. State severity: P1, P2, or P3.
3. Name the incident owner.
4. Open the pro session lifecycle dashboard section.
5. Check whether the issue is isolated to one pro, one booking, one service, one route, or all sessions.
6. Check recent deploys and commits.
7. Check Sentry errors for the affected routes/actions.
8. Check provider dashboards if media, payment, or notification behavior is involved.
9. Decide whether to monitor, mitigate, roll back, or pause launch.
10. Record the incident or follow-up in docs/launch-readiness/risk-register.md if it affects launch readiness.

---

# Routes and workflows to inspect

Start with the routes/actions related to:

- Pro booking detail/read/update
- Pro booking cancel
- Pro booking final review
- Pro booking consultation services
- Pro booking checkout mark-paid
- Pro booking checkout waive
- Pro booking invite
- Pro booking rebook
- Pro session finish
- Client booking reschedule
- Media metadata attached to bookings
- Payment or checkout state connected to a booking

Known route/test areas from launch-readiness proof include:

- app/api/pro/bookings/route.test.ts
- app/api/pro/bookings/[id]/route.test.ts
- app/api/pro/bookings/[id]/cancel/route.test.ts
- app/api/pro/bookings/[id]/final-review/route.test.ts
- app/api/pro/bookings/[id]/consultation-services/route.test.ts
- app/api/pro/bookings/[id]/checkout/mark-paid/route.test.ts
- app/api/pro/bookings/[id]/checkout/waive/route.test.ts
- app/api/pro/bookings/[id]/invite/route.test.ts
- app/api/pro/bookings/[id]/rebook/route.test.ts
- app/api/pro/bookings/[id]/session/finish/route.test.ts
- app/api/bookings/[id]/reschedule/route.test.ts

If route names move, update this runbook. Stale runbooks are operational confetti.

---

# Dashboard checks

Open the Sentry dashboard section for pro session lifecycle.

Check:

| Signal | What to look for |
|---|---|
| Pro session page/load errors | Page crashes, API 5xx, auth/session failures |
| Session lifecycle action attempts | Whether actions are visible by action type |
| Session lifecycle action failures | Spikes by route/action |
| Illegal transition blocks | Whether expected blocks are normal or suddenly noisy |
| Closeout blocker events | Whether blockers are legitimate or caused by route/provider failure |
| Closeout completion failures | Any unexplained failures during closeout |
| Aftercare/payment/media blocker failures | Whether downstream requirements are blocking session finish |
| Recent release/deploy | Whether the spike started after a deploy |
| User/pro concentration | Whether one account or all accounts are affected |

If dashboard links are missing, record that gap in:

- docs/launch-readiness/sentry-dashboard.md
- docs/launch-readiness/risk-register.md

---

# Provider checks

Check provider dashboards only if related symptoms appear.

| Symptom | Provider/check |
|---|---|
| Media upload/metadata closeout blockers | Supabase Storage and media route errors |
| Private media access issue | Supabase Storage policy proof and private media incident runbook |
| Checkout/payment closeout blockers | Stripe dashboard and Stripe runbook |
| Notification completion issue | Postmark/Twilio dashboards and notification backlog runbook |
| Database write/read failures | Postgres provider dashboard and DB runbook |
| Rate-limit/session failure | Redis/rate-limit dashboard and Redis runbook |

---

# Safe investigation steps

Use production-safe read-only checks first.

1. Identify affected booking/session IDs from Sentry or support report.
2. Confirm whether the booking exists and belongs to the expected pro/client.
3. Confirm current booking/session lifecycle state.
4. Confirm whether the requested transition is valid.
5. Check for related payment/media/aftercare blockers.
6. Check whether the same route fails for multiple records.
7. Check recent deploys.
8. Check whether failures are validation errors, conflicts, auth failures, DB failures, or provider failures.
9. Avoid manual writes until you know whether data integrity is safe.

Do not paste raw PII, tokens, full addresses, signed media URLs, or secret-bearing payloads into Slack, docs, GitHub, or Sentry comments.

---

# Immediate mitigation options

Choose the least risky mitigation that protects data integrity.

| Situation | Mitigation |
|---|---|
| Recent deploy likely caused failures | Roll back to last known good deploy. |
| Single booking stuck | Use support/manual workflow after verifying state. |
| Closeout blocker is legitimate | Communicate expected blocker and next step to pro/support. |
| Closeout blocker is caused by provider outage | Follow provider runbook and use manual follow-up. |
| Data integrity is uncertain | Pause affected workflow and avoid manual mutation until verified. |
| Payment state is uncertain | Do not mark paid/waived manually until Stripe/payment state is checked. |
| Private media issue suspected | Escalate to P1 and use private media incident runbook. |
| Broad pro workflow outage | Pause launch/beta expansion and update go/no-go status. |

---

# Rollback guidance

Rollback is appropriate when:

- The issue started after a deploy.
- Core pro session lifecycle actions are failing broadly.
- Closeout or completion behavior is corrupting state.
- Payment/media/private-media state is at risk.
- The fix is unknown and beta/pro usage is active.

Rollback is not enough when:

- Bad data has already been written.
- Payment state has been mutated incorrectly.
- Private media access may have leaked.
- Provider outage is the root cause.
- A manual correction/backfill is required.

After rollback, verify:

1. Pro session route errors return to baseline.
2. A test pro session lifecycle action succeeds.
3. No new invalid state transitions occur.
4. Affected users are identified.
5. Any manual follow-up is tracked.

---

# Communication template

Use this for private beta support updates:

text We’re investigating an issue affecting pro session completion/closeout. We’ve paused changes to the affected workflow while we verify booking state and related payment/media requirements. We’ll update you when the session is safe to continue or if manual support is needed. 

For P1 incidents:

text We’ve identified a launch-blocking issue in the pro session lifecycle path. Booking/session state integrity is being verified before we resume the affected workflow. Launch or rollout expansion is paused until this is resolved and re-tested. 

Keep user-facing messages calm and specific. Do not expose internals, stack traces, provider secrets, IDs that are not needed, or guesses dressed up as facts.

---

# Verification after mitigation

Before closing the incident, verify:

- Affected route/action is no longer erroring.
- Session lifecycle transition rules still hold.
- No illegal transition succeeded.
- Booking status is consistent.
- Payment state is consistent, if involved.
- Media state is consistent, if involved.
- Notifications are queued/sent or manual follow-up is documented, if involved.
- Sentry shows error rate back to baseline.
- Dashboard section is updated or gap is recorded.
- Risk register is updated if launch readiness changed.

---

# Evidence to record

Record incident evidence in the appropriate launch docs if this affects private beta or public rollout.

Use this shape:

md ## Pro session lifecycle incident evidence  Status: PASS / FAIL / BLOCKED / MITIGATED Owner: Tori Backup: TODO Environment: staging / production Date: Related alert: Dashboard link: Sentry issue/event: Affected route/action: Affected booking/session scope: Runbook used: docs/runbooks/pro-session-lifecycle.md  ### What happened  TODO  ### Impact  TODO  ### Mitigation  TODO  ### Verification  TODO  ### Follow-up  TODO  ### Launch decision  TODO 

Update these files when relevant:

- docs/launch-readiness/go-no-go.md
- docs/launch-readiness/risk-register.md
- docs/launch-readiness/sentry-dashboard.md
- docs/launch-readiness/slack-alerts.md
- docs/launch-readiness/oncall.md

---

# Alert mapping

Related alert:

| Field | Value |
|---|---|
| Alert name | Pro session lifecycle or closeout failure spike |
| Severity | P2 by default; escalate to P1 for integrity/privacy/payment risk |
| Owner | Tori |
| Backup | TODO |
| Destination | #tovis-ops-alerts or approved alternate |
| Dashboard | docs/launch-readiness/sentry-dashboard.md |
| Runbook | docs/runbooks/pro-session-lifecycle.md |
| Status | TODO ROUTING PROOF |

Before public rollout, this alert must have:

- Threshold
- Dashboard link
- Routing proof
- Backup owner
- Escalation path
- Acknowledgement proof

---

# Suggested alert thresholds

Initial placeholder thresholds for private beta. Tune after live dashboard data exists.

| Signal | Private beta starting threshold | Public rollout starting threshold |
|---|---:|---:|
| Pro session lifecycle 5xx errors | 1 or more in 15 minutes | 3 or more in 10 minutes |
| Closeout completion failures | 1 or more in 15 minutes | 3 or more in 10 minutes |
| Illegal transition unexpected success | Any occurrence | Any occurrence |
| Closeout blocker spike | 3 or more for same route/action in 30 minutes | 5 or more in 15 minutes |
| Pro session page crash | 1 or more beta user report or Sentry issue | 3 or more users in 15 minutes |

These thresholds are intentionally conservative for beta. Tune only after dashboard proof exists.

---

# Data safety rules

Do not expose:

- Raw session tokens
- Client action tokens
- Claim/invite tokens
- Full addresses
- Raw phone/email values outside approved privacy boundaries
- Signed media URLs
- Private storage paths
- Stripe secrets or webhook secrets
- Full payment payloads
- Full Sentry event payloads containing sensitive fields
- Raw booking notes if they contain personal details

Use redacted IDs and minimal context in shared incident notes.

---

# Related tests and proof

Relevant local proof areas:

- Pro booking route tests
- Session finish route tests
- Checkout mark-paid/waive route tests
- Invite/rebook/final-review route tests
- Client reschedule route tests
- Launch load suite
- Chaos tests for DB, storage, Stripe, Redis, Postmark, and Twilio degradation

Relevant launch docs:

- docs/launch-readiness/test-proof.md
- docs/launch-readiness/load-test-plan.md
- docs/launch-readiness/chaos-test-plan.md
- docs/launch-readiness/sentry-dashboard.md
- docs/launch-readiness/slack-alerts.md
- docs/launch-readiness/oncall.md
- docs/launch-readiness/go-no-go.md
- docs/launch-readiness/risk-register.md

---

# Closeout checklist

Before closing the incident:

- [ ] Severity was assigned.
- [ ] Owner was named.
- [ ] Relevant dashboard was checked.
- [ ] Relevant Sentry issue/event was reviewed.
- [ ] Related provider dashboards were checked, if applicable.
- [ ] Booking/session state integrity was verified.
- [ ] Payment state was verified, if applicable.
- [ ] Media/private-media state was verified, if applicable.
- [ ] User/support communication was sent, if needed.
- [ ] Follow-up was recorded.
- [ ] Launch docs were updated if readiness changed.
- [ ] Alert/runbook gaps were recorded.

---

# Maintenance rule

Do not close a pro session lifecycle incident just because the error stopped.

Close it only after affected booking/session state has been checked, downstream payment/media/notification state is safe, and any launch-readiness impact is recorded.

For this runbook, “fixed” means the workflow is safe, not merely quiet.