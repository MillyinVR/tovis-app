# Go / No-Go Launch Gate

## Status

Phase: Phase 2 — Launch ops proof  
Scope: Private beta and public rollout readiness  
Current default decision: NO-GO until required operational evidence is linked  
Primary dashboard surface: Sentry-first  
Primary private-beta alerting path: Slack-first, unless an approved alternate alert path is documented here  
Public-launch escalation: BLOCKED until named backup owner and tested P1 escalation path exist  
Primary owner: Tori  
Backup owner: TODO — public rollout blocker

This document is the launch decision gate for TOVIS. It should block launch unless the required proof exists. Do not mark an item green because the code “probably works.” Link the command output, dashboard, runbook, staging proof, production-safe synthetic proof, or PR that proves it.

Important distinction: Phase 2 local code proof is now green, and deployed Sentry intake is proven. That does not mean launch observability is complete. Private beta still requires dashboard/alert proof or an explicit accepted alternate alert path. Public rollout still requires backup ownership, tested escalation, live dashboard proof, load/chaos proof, and final sign-off.

---

# Decision summary

| Launch stage | Decision | Reason |
|---|---|---|
| Private beta | NO-GO | Local load/chaos proof is green and Sentry intake works, but live dashboard evidence and alert-routing proof are still incomplete. |
| Public rollout | NO-GO | Public rollout requires all private-beta gates plus named backup owner, tested P1 escalation, live dashboard proof, provider proof, rollout/rollback proof, and signed launch decision. |

---

# Current Phase 2 proof baseline

| Item | Status | Evidence |
|---|---|---|
| Intended launch/audit commit recorded | PASS | ae30aff20aff8b205e65f57bf3ae8b5b8b553b29 recorded from git rev-parse HEAD on 2026-06-07 |
| Phase 2 local chaos suite | PASS | pnpm test:chaos: 6 files / 17 tests passed |
| Phase 2 full local test suite | PASS | pnpm test: 311 files / 3317 tests passed |
| Phase 2 local launch load suite | PASS | pnpm test:load:launch: 8/8 launch load steps passed through pnpm verify:launch-ops |
| Aggregate launch ops verification | PASS LOCALLY | pnpm verify:launch-ops passed locally at commit ae30aff20aff8b205e65f57bf3ae8b5b8b553b29; evidence recorded in docs/launch-readiness/test-proof.md |
| Signup strict success proof | PASS LOCALLY | LOAD_TEST_EXPECT_SIGNUP_SUCCESS=true: 30/30 successful client signups, 0 rate limits, 0 real failures |
| Sentry release/environment config | IMPLEMENTED | lib/observability/sentryConfig.ts, sentry.server.config.ts, sentry.edge.config.ts, instrumentation-client.ts |
| Deployed Sentry intake | PASS | Synthetic event captured: e56044a034cb4fb78d1b09801fb43da5 |
| Live Sentry dashboard proof | TODO | Dashboard sections still need links/evidence |
| Synthetic alert routing | BLOCKED | Requires Sentry plan upgrade or approved alternate alerting path |
| Slack alert routing | BLOCKED | Requires paid Sentry plan or approved alternate alerting path |
| Backup owner | BLOCKED | Required before public rollout |
| Public P1 escalation | BLOCKED | Required before public rollout unless explicitly waived |

---

# Decision rules

Use only these decision values:

| Decision | Meaning |
|---|---|
| GO | All required gates are green, evidence is linked, and risks are accepted. |
| GO WITH ACCEPTED RISKS | Required launch blockers are green, but known non-blocking risks remain documented in risk-register.md. |
| NO-GO | One or more launch blockers are open. |
| DEFER | Launch decision is intentionally postponed because evidence is incomplete. |

---

# Required evidence format

Every gate must include:

- Status: TODO, PASS, FAIL, BLOCKED, or ACCEPTED RISK
- Owner
- Evidence link or command output
- Date verified
- Notes

A gate is not complete without evidence.

---

# Private beta required gates

| Gate | Status | Owner | Evidence | Date | Notes |
|---|---|---|---|---|---|
| Local worktree is clean | TODO | Tori | TODO | TODO | Recheck with `git status --short` after this proof update is committed. |
| pnpm typecheck passes | PASS | Tori | `pnpm typecheck` passed | 2026-06-07 | Required before launch-stage testing. |
| pnpm verify:privacy-phase1 passes | PASS | Tori | `pnpm verify:privacy-phase1` passed: canonical normalization passed, PII plaintext reads passed with 471 known baseline entries, privacy tests passed 240 total tests | 2026-06-07 | Required because Phase 1 privacy is a launch blocker. |
| Phase 1 privacy proof is current | TODO | Tori | docs/privacy/phase-1-privacy-proof.md | TODO | Must reflect current launch commit. |
| Remaining Phase 1 launch-env reruns are tracked | TODO | Tori | docs/privacy/phase-1-remaining-work.md | TODO | HMAC/address backfills may be launch-env reruns, not code blockers. |
| Local branch matches intended launch commit | PASS | Tori | git rev-parse HEAD returned ae30aff20aff8b205e65f57bf3ae8b5b8b553b29 | 2026-06-07 | Current audited commit recorded. |
| pnpm test passes or documented focused equivalent passes | PASS | Tori | pnpm test: 311 files / 3317 tests passed | 2026-06-07 | Full local test suite passed. |
| Phase 2 local launch ops proof exists | PASS | Tori | docs/launch-readiness/test-proof.md; pnpm verify:launch-ops passed locally at commit ae30aff20aff8b205e65f57bf3ae8b5b8b553b29 | 2026-06-07 | Local smoke proof is green. This does not replace deployed staging/dashboard/alert proof. |
| Health/readiness endpoint verified in deployed environment | TODO | Tori | TODO | TODO | Include provider-live check setting if applicable. |
| Booking lifecycle smoke proof exists | TODO | Tori | TODO | TODO | Must cover client booking path and pro lifecycle path. |
| Stripe checkout and webhook verification proof exists | TODO | Tori | TODO | TODO | Must include signed webhook verification and replay/idempotency behavior. |
| Storage policy proof exists | TODO | Tori | TODO | TODO | Must prove private media cannot leak. |
| Export/delete route authorization proof exists | TODO | Tori | TODO | TODO | Must remain SUPER_ADMIN gated. |
| Sentry release/environment tagging exists | PASS | Tori | Sentry metadata visible in deployed response baggage; Sentry event ID e56044a034cb4fb78d1b09801fb43da5 | 2026-06-07 | Deployed Sentry intake works. |
| Sentry dashboard has required launch sections | TODO LIVE PROOF | Tori | docs/launch-readiness/sentry-dashboard.md | TODO | All 10 sections must be mapped and linked. |
| Slack alert destination exists | TODO / BLOCKED | Tori | docs/launch-readiness/slack-alerts.md | TODO | Required for private beta unless alternate path is accepted. |
| P1/P2 alert map exists | TODO | Tori | docs/launch-readiness/slack-alerts.md | TODO | Every critical alert needs owner, threshold, runbook, and escalation. |
| On-call owner is named | PASS | Tori | docs/launch-readiness/oncall.md | TODO | Tori is primary owner. |
| Backup owner status is explicit | PASS FOR PRIVATE BETA ONLY | Tori | docs/launch-readiness/oncall.md | TODO | Missing backup is allowed for private beta only if accepted; public rollout remains blocked. |
| Synthetic alert tested | BLOCKED | Tori | TODO | TODO | At least one alert must route to Slack or approved alternate. |
| Private beta checklist complete | TODO | Tori | docs/launch-readiness/private-beta-checklist.md | TODO | Must include cohort, support path, rollback trigger. |
| Risk register created and reviewed | TODO | Tori | docs/launch-readiness/risk-register.md | TODO | High risks must have owner and mitigation. |
| Private beta alerting risk accepted or resolved | TODO / BLOCKED | Tori | This document + slack-alerts.md | TODO | Required if Slack routing remains blocked. |

---

# Public rollout required gates

Public rollout requires every private beta gate to be green, plus the gates below.

| Gate | Status | Owner | Evidence | Date | Notes |
|---|---|---|---|---|---|
| Named backup owner exists | BLOCKED | Tori | docs/launch-readiness/oncall.md | TODO | Required before public rollout. |
| P1 escalation path is tested | BLOCKED | Tori | TODO | TODO | Slack-only is not enough unless explicitly accepted in writing. |
| Public rollout checklist complete | TODO | Tori | docs/launch-readiness/public-rollout-checklist.md | TODO | Must include staged rollout and rollback criteria. |
| Load test suite exists | PASS | Tori | tests/load/*, tests/load/run-launch-load-suite.ts, package scripts | 2026-06-07 | Repo-side load suite exists. |
| Load test suite passed locally | PASS | Tori | docs/launch-readiness/test-proof.md; pnpm verify:launch-ops passed 8/8 launch load steps at commit ae30aff20aff8b205e65f57bf3ae8b5b8b553b29 | 2026-06-07 | Local smoke proof only; deployed staging proof still TODO. |
| Load test suite passed against deployed staging | TODO | Tori | TODO | TODO | Required before public rollout. |
| Availability bootstrap load proof exists | PASS LOCALLY | Tori | pnpm test:load:availability; included in verify:launch-ops | 2026-06-07 | Deployed staging proof still TODO. |
| Hold create load proof exists | PASS LOCALLY | Tori | pnpm test:load:holds; included in verify:launch-ops | 2026-06-07 | Deployed staging proof still TODO. |
| Booking finalize load proof exists | PASS LOCALLY | Tori | pnpm test:load:booking-finalize; included in verify:launch-ops | 2026-06-07 | Deployed staging proof still TODO. |
| Media metadata load proof exists | PASS LOCALLY | Tori | pnpm test:load:media-metadata; included in verify:launch-ops | 2026-06-07 | Deployed staging proof still TODO. |
| Checkout load proof exists | PASS LOCALLY | Tori | pnpm test:load:checkout; included in verify:launch-ops | 2026-06-07 | Deployed staging proof still TODO. |
| Stripe webhook replay proof exists | PASS LOCALLY | Tori | pnpm test:load:stripe-webhook-replay; included in verify:launch-ops | 2026-06-07 | Deployed staging proof still TODO. |
| Notification processing load proof exists | PASS LOCALLY | Tori | pnpm test:load:notifications; included in verify:launch-ops | 2026-06-07 | Deployed staging proof still TODO. |
| Chaos test suite exists | PASS | Tori | tests/chaos/*, pnpm test:chaos | 2026-06-07 | Repo-side chaos suite exists. |
| Chaos test suite passed locally | PASS | Tori | pnpm test:chaos: 6 files / 17 tests passed | 2026-06-07 | Local deterministic proof. |
| Redis outage behavior proven | PASS LOCALLY | Tori | tests/chaos/redis-outage.test.ts | 2026-06-07 | Must remain green in CI/final proof. |
| Storage outage behavior proven | PASS LOCALLY | Tori | tests/chaos/supabase-storage-outage.test.ts | 2026-06-07 | Must avoid unsafe media state. |
| Stripe webhook storm behavior proven | PASS LOCALLY | Tori | tests/chaos/stripe-webhook-storm.test.ts | 2026-06-07 | Must prove dedupe/idempotency. |
| Postmark degradation behavior proven | PASS LOCALLY | Tori | tests/chaos/postmark-degradation.test.ts | 2026-06-07 | Must prove retry/manual follow-up path. |
| Twilio degradation behavior proven | PASS LOCALLY | Tori | tests/chaos/twilio-degradation.test.ts | 2026-06-07 | Must prove retry/manual follow-up path. |
| DB degradation behavior proven | PASS LOCALLY | Tori | tests/chaos/db-degradation.test.ts | 2026-06-07 | Deterministic DB failure proof exists. |
| DB replica lag/stale-read behavior proven | TODO / CLARIFY SCOPE | Tori | TODO | TODO | Current proof is DB degradation, not necessarily replica-lag semantics. |
| P1/P2 alerts link to runbooks | TODO | Tori | docs/launch-readiness/slack-alerts.md | TODO | No orphan alerts. |
| Provider quota/capacity confirmed | TODO | Tori | TODO | TODO | Stripe, Twilio, Postmark, storage, database, Redis, Vercel. |
| Provider dashboards linked | TODO | Tori | docs/launch-readiness/sentry-dashboard.md | TODO | Needed where Sentry is not source of truth. |
| Live Sentry dashboard proof exists | TODO LIVE PROOF | Tori | docs/launch-readiness/sentry-dashboard.md | TODO | Required before public rollout. |
| Alert routing tested | BLOCKED | Tori | TODO | TODO | Required before public rollout. |
| Rollback path documented | TODO | Tori | docs/launch-readiness/public-rollout-checklist.md | TODO | Must include trigger thresholds. |
| High-severity risks closed or accepted | TODO | Tori | docs/launch-readiness/risk-register.md | TODO | No unowned high-severity risk. |
| Final launch sign-off completed | TODO | Tori | This document | TODO | Required before public rollout. |

---

# Automatic NO-GO conditions

Private beta is automatically NO-GO if any of these are true:

- pnpm typecheck fails.
- pnpm verify:privacy-phase1 fails.
- Health/readiness proof is missing.
- Booking lifecycle smoke proof is missing.
- Stripe webhook verification proof is missing when payments are enabled.
- Storage/private-media proof is missing when media is enabled.
- Sentry intake is broken.
- Alert destination is missing, unless an alternate path is documented and accepted.
- Synthetic alert routing is untested, unless explicitly accepted as a private-beta risk.
- No owner is assigned for P1 alerts.
- Export/delete route authorization proof fails.
- A suspected PII leak, audit-redaction failure, or privacy-boundary regression is open.
- A high-severity risk in risk-register.md has no owner.

Public rollout is automatically NO-GO if any of these are true:

- Any private-beta blocker remains open.
- No named backup owner exists.
- P1 escalation path has not been tested.
- P1/P2 alerts do not link to runbooks.
- Alert routing has not been tested end-to-end.
- Live dashboard proof is missing.
- Load tests are missing or failing for booking/payment/media/notification paths.
- Chaos tests are missing or failing for required dependency failures.
- Provider quota/capacity is unknown.
- Rollback criteria are missing.
- risk-register.md contains unowned high-severity risks.
- Final sign-off is incomplete.

---

# Required launch commands

Run these before private beta decision:

bash git status --short git rev-parse HEAD pnpm typecheck pnpm verify:privacy-phase1 

Run these before public rollout decision:

bash git status --short git rev-parse HEAD pnpm typecheck pnpm test pnpm verify:privacy-phase1 pnpm test:chaos pnpm test:load:launch pnpm verify:launch-ops 

If pnpm test:load:launch requires staging-only secrets or seeded IDs, record the exact command, environment, commit, and output in the evidence section instead of pretending it ran in a generic environment. Tiny distinction. Huge difference. Classic deployment gremlin trap.

---

# Current local Phase 2 evidence

## Evidence: Phase 2 launch ops local proof

Status: PASS LOCALLY  
Owner: Tori  
Environment: local app using staging-style smoke profile  
Commit: `ae30aff20aff8b205e65f57bf3ae8b5b8b553b29`  
Date: 2026-06-07  
Evidence record: `docs/launch-readiness/test-proof.md`

Command:

```bash
LOAD_TEST_ALLOW_SLOT_REUSE=true \
LOAD_TEST_TRUSTED_IP_HEADER_NAME=x-forwarded-for \
LOAD_TEST_TRUSTED_IP_PREFIX=10.252 \
LOAD_TEST_EXPECT_SIGNUP_SUCCESS=true \
pnpm verify:launch-ops

- pnpm test:chaos passed.
- Chaos result: 6 files passed, 17 tests passed.
- pnpm test:load:launch passed.
- Launch load result: 8/8 steps passed.
- Availability bootstrap passed.
- Hold-create passed with expected conflict/rate-limit pressure.
- Booking finalize passed.
- Checkout passed.
- Media metadata passed.
- Notification processing passed.
- Stripe webhook replay passed.
- Signup passed with expected success/rate-limit mix and zero real failures.

### Known gaps

- This was local/staging-config proof, not deployed staging proof.
- Live Sentry dashboard links are still TODO.
- Synthetic alert routing is still TODO/BLOCKED.
- Slack alert routing is still TODO/BLOCKED.
- Provider dashboard links are still TODO.
- Formal public SLO thresholds are still TODO.
- Backup owner is still TODO/BLOCKED.

### Launch decision

Local Phase 2 code proof is complete.  
Private beta observability/alert proof remains incomplete.  
Public rollout remains blocked.

---

# Current deployed Sentry evidence

## Evidence: deployed Sentry intake proof

Status: PASS  
Owner: Tori  
Environment: production  
Date: 2026-06-07 
Route: POST /api/internal/debug/sentry-test  
Event ID: e56044a034cb4fb78d1b09801fb43da5

### What was verified

- The deployed app accepted an authorized synthetic Sentry test request.
- The deployed app captured a Sentry event.
- Sentry release/environment metadata is visible in deployed responses.
- The debug route returned a controlled success response.

### What was not verified

- Slack alert routing.
- Alert threshold behavior.
- Alert acknowledgement.
- P1 escalation.
- Dashboard section completeness.
- Provider dashboard links.
- Public rollout readiness.

### Launch decision

This unblocks the “does Sentry intake work?” question.  
It does not unblock private beta alert proof or public rollout escalation proof.

---

# Required dashboard sections

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

---

# Required alert categories

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

---

# Required runbook links

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
| Booking funnel | docs/runbooks/booking-funnel.md |
| Auth/session | docs/runbooks/auth-session.md |
| Pro session lifecycle | docs/runbooks/pro-session-lifecycle.md |
| SLO/error budget | docs/runbooks/slo-error-budget.md |

If a runbook is missing, either create it or explicitly map the alert to a sufficient existing runbook.

---

# Risk acceptance rules

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
- No public-launch P1 escalation path.
- No owner for public-launch P1 incidents.

---

# Current known accepted/deferred areas

These are not automatically launch blockers if tracked and accepted, but they must stay visible:

| Area | Launch treatment | Tracking |
|---|---|---|
| PII plaintext-read baseline | Accepted Phase 1 baseline; burn down over time | docs/privacy/phase-1-privacy-proof.md |
| Booking-level anonymization beyond Phase 1 boundary | Deferred beyond Phase 1 conservative implementation | docs/privacy/phase-1-remaining-work.md |
| Message deletion implementation | Deferred until retention/ownership policy is converted into code | docs/privacy/phase-1-remaining-work.md |
| Storage object byte deletion workflow | Deferred follow-up; must be tracked for privacy operations | docs/privacy/phase-1-remaining-work.md |
| Launch-environment backfill reruns | Required before public launch if launch env has relevant rows | docs/privacy/phase-1-remaining-work.md |
| Missing named backup owner | Allowed only as private-beta accepted risk; public launch blocker | docs/launch-readiness/oncall.md |
| Sentry-to-Slack routing blocked by plan | Private beta blocker unless alternate path is documented/tested; public rollout blocker unless resolved or formally accepted | docs/launch-readiness/slack-alerts.md |
| Deployed staging dashboard proof missing | Private beta/public rollout blocker until linked or accepted | docs/launch-readiness/sentry-dashboard.md |

---

# Private beta sign-off

Complete this section when private beta gates are reviewed.

| Role | Name | Decision | Date | Notes |
|---|---|---|---|---|
| Product/owner | Tori | TODO | TODO | TODO |
| Engineering | Tori | TODO | TODO | TODO |
| Privacy/security | Tori | TODO | TODO | TODO |
| Support/comms | Tori | TODO | TODO | TODO |

Private beta decision:

```text
Decision: TODO
Commit: ae30aff20aff8b205e65f57bf3ae8b5b8b553b29
Environment: TODO
Date: TODO
Sentry event proof: e56044a034cb4fb78d1b09801fb43da5
Alert routing proof: TODO
Dashboard proof: TODO
Accepted risks: TODO
Launch notes: TODO
```

---

# Public rollout sign-off

Complete this section only after private beta evidence, load proof, chaos proof, dashboard proof, alert routing, escalation, and rollback criteria are complete.

| Role | Name | Decision | Date | Notes |
|---|---|---|---|---|
| Product/owner | Tori | TODO | TODO | TODO |
| Engineering | Tori | TODO | TODO | TODO |
| Privacy/security | Tori | TODO | TODO | TODO |
| Support/comms | Tori | TODO | TODO | TODO |
| Backup owner | TODO | TODO | TODO | Required before public rollout. |

Public rollout decision:

```text
Decision: TODO
Commit: ae30aff20aff8b205e65f57bf3ae8b5b8b553b29
Environment: TODO
Date: TODO
Accepted risks: TODO
Rollout stage: TODO
Rollback trigger: TODO
Launch notes: TODO
```

---

# Maintenance rule

Do not change a gate from TODO, FAIL, or BLOCKED to PASS without evidence. If evidence is not linked or recorded, the gate is still open.

A local passing test proves the repo behavior. A deployed Sentry event proves intake. A launch gate proves humans can see, understand, respond to, and roll back real production failures.

This document should be strict. A launch gate that does not block anything is just a vibes checklist wearing a tiny hard hat.