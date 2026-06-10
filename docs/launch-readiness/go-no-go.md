# Go / No-Go Launch Gate

## Status

Phase: Phase 2 — Launch ops proof  
Scope: Private beta and public rollout readiness  
Current default decision: NO-GO until required operational evidence is linked  
Primary dashboard surface: Sentry-first  
Primary private-beta alerting path: Slack-first, unless an approved alternate alert path is documented here  
Public-launch escalation: BLOCKED until named backup owner and tested P1 escalation path exist  
Primary owner: Tori  
Backup owner: NONE — solo operator; accepted private-beta risk (2026-06-09); public rollout blocker

This document is the launch decision gate for TOVIS. It should block launch unless the required proof exists. Do not mark an item green because the code “probably works.” Link the command output, dashboard, runbook, staging proof, production-safe synthetic proof, or PR that proves it.

---

# Decision summary

| Launch stage | Decision | Reason |
|---|---|---|
| Private beta | NO-GO | Local load/chaos proof is green, current safe local checks pass, Sentry intake works, deployed health/readiness endpoints passed, saved Sentry issue-alert delivery to Slack works, and a production-safe app-generated synthetic alert routed to `#tovis-ops-alerts`. Private beta still needs live dashboard evidence, deployed smoke proof for remaining core flows, support/rollback decisions, risk review, and either runbook-link/acknowledgement timing completion or explicit accepted follow-up. |
| Public rollout | NO-GO | Public rollout requires all private-beta gates plus named backup owner, tested P1 escalation, live dashboard proof, provider proof, rollout/rollback proof, and signed launch decision. |

---

# Current Phase 2 proof baseline

| Item | Status | Evidence |
|---|---|---|
| Current repo audit HEAD recorded | PASS | `57ce1ef2fbb5be1480e0d41d1126d2d08c15bcdf` recorded from `git rev-parse HEAD` on 2026-06-10. |
| Current repo safe verification | PASS | `pnpm typecheck`, `pnpm verify:privacy-phase1`, and `pnpm test:chaos` passed on 2026-06-10 at current audit HEAD. |
| Last full launch-ops/audit commit recorded | PASS LOCALLY / STALE COMMIT | `ae30aff20aff8b205e65f57bf3ae8b5b8b553b29` recorded from `git rev-parse HEAD` on 2026-06-07; rerun full launch-ops proof on the final beta commit. |
| Phase 2 local chaos suite | PASS | pnpm test:chaos: 6 files / 17 tests passed |
| Phase 2 full local test suite | PASS | pnpm test: 311 files / 3317 tests passed |
| Phase 2 local launch load suite | PASS | pnpm test:load:launch: 8/8 launch load steps passed through pnpm verify:launch-ops |
| Aggregate launch ops verification | PASS LOCALLY | pnpm verify:launch-ops passed locally at commit ae30aff20aff8b205e65f57bf3ae8b5b8b553b29; evidence recorded in docs/launch-readiness/test-proof.md |
| Signup strict success proof | PASS LOCALLY | LOAD_TEST_EXPECT_SIGNUP_SUCCESS=true: 30/30 successful client signups, 0 rate limits, 0 real failures |
| Sentry release/environment config | IMPLEMENTED | lib/observability/sentryConfig.ts, sentry.server.config.ts, sentry.edge.config.ts, instrumentation-client.ts |
| Deployed Sentry intake | PASS | Synthetic event captured: e56044a034cb4fb78d1b09801fb43da5 |
| Deployed health/readiness proof | PASS / DASHBOARD LINK TODO | `/api/health/live`, `/api/health`, and `/api/health/ready` returned HTTP 200 on `https://www.tovis.app`; readiness status `ok`; Redis readiness fixed in `bc88898`. Dashboard/synthetic monitor link still TODO. |
| Live Sentry dashboard proof | TODO | Dashboard sections still need links/evidence |
| Synthetic alert routing | PASS / RUNBOOK LINK TODO | Production-safe app-generated synthetic Sentry alert routed to `#tovis-ops-alerts` on 2026-06-08 at 6:31 PM local. Event ID `f7a0d19cb4a040a3a21f4679086f166f`; alert key `launch-readiness.synthetic-sentry-alert.v2`; Slack short ID `TOVIS-APP-K`. Runbook link in Slack message and formal acknowledgement timing still TODO. |
| Slack alert routing | PASS / RUNBOOK LINK TODO | Paid Sentry plan enabled; Sentry app added to `#tovis-ops-alerts`; saved Sentry issue-alert rule delivered a test notification to Slack; production-safe app-generated synthetic alert routed to Slack on 2026-06-08. |
| Backup owner | ACCEPTED RISK (PRIVATE BETA) / BLOCKED (PUBLIC) | Solo operator; single-owner risk accepted 2026-06-09 per RISK-001; named backup required before public rollout |
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
| pnpm typecheck passes | PASS | Tori | `pnpm typecheck` passed on current repo audit HEAD. | 2026-06-10 | Required before launch-stage testing. |
| pnpm verify:privacy-phase1 passes | PASS | Tori | `pnpm verify:privacy-phase1` passed on current repo audit HEAD: canonical normalization passed, PII plaintext reads passed with 471 known baseline entries, privacy tests passed. | 2026-06-10 | Required because Phase 1 privacy is a launch blocker. |
| Phase 1 privacy proof is current | TODO | Tori | docs/privacy/phase-1-privacy-proof.md | TODO | Must reflect current launch commit. |
| Remaining Phase 1 launch-env reruns are tracked | TODO | Tori | docs/privacy/phase-1-remaining-work.md | TODO | HMAC/address backfills may be launch-env reruns, not code blockers. |
| Local branch matches intended launch commit | PASS CURRENT AUDIT / FINAL BETA COMMIT TODO | Tori | `git rev-parse HEAD` returned `57ce1ef2fbb5be1480e0d41d1126d2d08c15bcdf`. | 2026-06-10 | Current audit HEAD recorded. Re-record after untracked work is handled and before final beta decision. |
| pnpm test passes or documented focused equivalent passes | PASS | Tori | pnpm test: 311 files / 3317 tests passed | 2026-06-07 | Full local test suite passed. |
| Phase 2 local launch ops proof exists | PASS | Tori | docs/launch-readiness/test-proof.md; pnpm verify:launch-ops passed locally at commit ae30aff20aff8b205e65f57bf3ae8b5b8b553b29 | 2026-06-07 | Local smoke proof is green. This does not replace deployed staging/dashboard/alert proof. |
| Health/readiness endpoint verified in deployed environment | PASS DEPLOYED / DASHBOARD LINK TODO | Tori | docs/launch-readiness/sentry-dashboard.md; `/api/health/live`, `/api/health`, and `/api/health/ready` returned HTTP 200 on `https://www.tovis.app`; readiness status `ok`. | 2026-06-09 | Endpoint proof exists. Dashboard/synthetic monitor link and provider dashboard proof still TODO. |
| Booking lifecycle smoke proof exists | PASS LOCALLY / DEPLOYED PROOF TODO | Tori | docs/launch-readiness/test-proof.md | 2026-06-09 | Local API-assisted proof exists. Target-environment client booking + pro lifecycle proof still TODO. |
| Stripe checkout and webhook verification proof exists | PASS LOCALLY / DEPLOYED PROVIDER PROOF TODO | Tori | docs/launch-readiness/test-proof.md | 2026-06-09 | Local checkout and Stripe webhook replay/idempotency proof exists. Signed provider/deployed proof still TODO. |
| Storage policy proof exists | PASS LOCALLY / DEPLOYED POLICY PROOF TODO | Tori | docs/launch-readiness/test-proof.md; docs/launch-readiness/storage-policy-proof.md | 2026-06-09 | Local media/storage proof exists. Target-environment private-media policy proof still TODO. |
| Export/delete route authorization proof exists | PASS LOCALLY / CURRENT COMMIT RERUN TODO | Tori | `pnpm verify:privacy-phase1` passed on current audit HEAD; docs/privacy/phase-1-privacy-proof.md | 2026-06-10 | SUPER_ADMIN-gated route tests pass locally. Re-record against final beta commit. |
| Sentry release/environment tagging exists | PASS | Tori | Sentry metadata visible in deployed response baggage; Sentry event ID e56044a034cb4fb78d1b09801fb43da5 | 2026-06-07 | Deployed Sentry intake works. |
| Sentry dashboard has required launch sections | TODO LIVE PROOF | Tori | docs/launch-readiness/sentry-dashboard.md | TODO | All 10 sections must be mapped and linked. |
| Slack alert destination exists | PASS / RUNBOOK LINK TODO | Tori | docs/launch-readiness/slack-alerts.md; docs/launch-readiness/oncall.md; docs/launch-readiness/test-proof.md | 2026-06-08 | `#tovis-ops-alerts` exists, Sentry app is added, saved Sentry issue-alert rule delivered a test notification, and production-safe app-generated synthetic alert routed to Slack. Runbook link in Slack message still TODO. |
| P1/P2 alert map exists | THRESHOLDS DOCUMENTED / ROUTING PROOF TODO | Tori | docs/launch-readiness/slack-alerts.md | 2026-06-10 | Alert areas, owners, starter thresholds, runbooks, and response instructions exist. Dashboard links, launch-specific alert rules, runbook-link-in-message, acknowledgement timing, and route-specific routing verification are still TODO. |
| On-call owner is named | PASS | Tori | docs/launch-readiness/oncall.md | TODO | Tori is primary owner. |
| Backup owner status is explicit | PASS FOR PRIVATE BETA ONLY | Tori | docs/launch-readiness/oncall.md; docs/launch-readiness/risk-register.md RISK-001 | 2026-06-09 | Tori is the sole project owner; no backup exists. Single-owner risk explicitly accepted for private beta on 2026-06-09. Public rollout remains blocked until a named backup exists. |
| Synthetic alert tested | PASS / FORMAL ACK TIMING TODO | Tori | docs/launch-readiness/slack-alerts.md; docs/launch-readiness/oncall.md; docs/launch-readiness/test-proof.md | 2026-06-08 | Production-safe app-generated synthetic Sentry alert routed to `#tovis-ops-alerts`; event ID `f7a0d19cb4a040a3a21f4679086f166f`; alert key `launch-readiness.synthetic-sentry-alert.v2`; Slack short ID `TOVIS-APP-K`. Tori observed the alert in Slack; formal acknowledgement timing and runbook-link-in-message remain TODO. |
| Private beta checklist complete | TODO / SCAFFOLD READY | Tori | docs/launch-readiness/private-beta-checklist.md; docs/launch-readiness/private-beta-support-rollback.md; docs/launch-readiness/deployed-smoke-proof.md | TODO | Cohort, support path, rollback decisions, deployed smoke execution, and final risk acceptance still require Tori/external proof. Repo-owned templates are ready. |
| Risk register created and reviewed | IN PROGRESS / FINAL REVIEW TODO | Tori | docs/launch-readiness/risk-register.md | 2026-06-09 | Register exists and names private/public blockers. Final private-beta risk acceptance still TODO. |
| Private beta alerting risk accepted or resolved | PARTIAL RESOLUTION / FOLLOW-UPS TODO | Tori | This document + docs/launch-readiness/slack-alerts.md; docs/launch-readiness/oncall.md; docs/launch-readiness/test-proof.md | 2026-06-10 | Basic Sentry-to-Slack delivery and production-safe app-generated synthetic alert routing are proven; starter thresholds are documented. Remaining alerting follow-ups are runbook-link-in-message, formal acknowledgement timing, live alert-rule/routing proof, and dashboard coverage. |

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
| P1/P2 alerts link to runbooks | PARTIAL / ALERT MESSAGE VERIFICATION TODO | Tori | docs/launch-readiness/slack-alerts.md | 2026-06-07 | Alert map links P1/P2 alerts to runbooks. Real alert messages still need runbook-link verification before public rollout. |
| Provider quota/capacity confirmed | TODO | Tori | TODO | TODO | Stripe, Twilio, Postmark, storage, database, Redis, Vercel. |
| Provider dashboards linked | TODO | Tori | docs/launch-readiness/sentry-dashboard.md | TODO | Needed where Sentry is not source of truth. |
| Live Sentry dashboard proof exists | TODO LIVE PROOF | Tori | docs/launch-readiness/sentry-dashboard.md | TODO | Required before public rollout. |
| Alert routing tested | PASS FOR SYNTHETIC / P1 ESCALATION TODO | Tori | docs/launch-readiness/slack-alerts.md; docs/launch-readiness/oncall.md; docs/launch-readiness/test-proof.md | 2026-06-08 | Production-safe app-generated synthetic alert routed to `#tovis-ops-alerts`; event ID `f7a0d19cb4a040a3a21f4679086f166f`; Slack short ID `TOVIS-APP-K`. Public rollout still requires launch-critical P1/P2 alert rules, thresholds, runbook links in alert messages, acknowledgement evidence, backup owner, and tested P1 escalation. |
| Rollback path documented | TEMPLATE READY / DECISION TODO | Tori | docs/launch-readiness/private-beta-support-rollback.md; docs/launch-readiness/public-rollout-checklist.md | TODO | Support/rollback template, pause triggers, comms templates, and post-rollback smoke checklist exist. Final owner/process/last-known-good deploy decision still required. |
| High-severity risks closed or accepted | TODO | Tori | docs/launch-readiness/risk-register.md | TODO | No unowned high-severity risk. |
| Final launch sign-off completed | TODO | Tori | This document | TODO | Required before public rollout. |

---

# Automatic NO-GO conditions

Private beta is automatically NO-GO if any of these are true:

- pnpm typecheck fails.
- pnpm verify:privacy-phase1 fails.
- Health/readiness deployed proof regresses.
- Booking lifecycle deployed proof for the target environment is missing or not explicitly accepted as out of private-beta scope.
- Stripe webhook deployed/provider proof is missing when payments are enabled.
- Storage/private-media deployed policy proof is missing when media is enabled.
- Sentry intake is broken.
- Slack alert destination is missing or Sentry-to-Slack delivery to `#tovis-ops-alerts` is broken during the beta window.
- Production-safe app-generated synthetic alert routing to `#tovis-ops-alerts` is missing or broken, unless explicitly accepted as a private-beta risk.
- No owner is assigned for P1 alerts.
- Export/delete route authorization proof fails.
- A suspected PII leak, audit-redaction failure, or privacy-boundary regression is open.
- A high-severity risk in risk-register.md has no owner.

Public rollout is automatically NO-GO if any of these are true:

- Any private-beta blocker remains open.
- No named backup owner exists.
- P1 escalation path has not been tested.
- P1/P2 alerts do not link to runbooks.
- P1/P2 launch-critical alert routing has not been tested end-to-end with threshold, runbook link, destination, backup/escalation path, and acknowledgement evidence.
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

```bash
git status --short
git rev-parse HEAD
pnpm typecheck
pnpm verify:privacy-phase1
```

Run these before public rollout decision:

```bash
git status --short
git rev-parse HEAD
pnpm typecheck
pnpm test
pnpm verify:privacy-phase1
pnpm test:chaos
pnpm test:load:launch
pnpm verify:launch-ops
```

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
```

### What was verified

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
- Saved Sentry issue-alert delivery to Slack is proven, and production-safe app-generated synthetic alert routing to Slack is proven.
- Route-specific alert threshold behavior, runbook link in alert message, and formal acknowledgement timing are still TODO.
- Provider dashboard links are still TODO.
- Formal public SLO dashboard proof is still TODO.
- Backup owner is still TODO/BLOCKED.

### Launch decision

Local Phase 2 code proof is complete.  
Basic Sentry-to-Slack delivery proof is complete for a saved Sentry issue-alert rule test notification.  
Production-safe app-generated synthetic alert routing to Slack is complete.  
Private beta observability, deployed smoke proof, support/rollback proof, risk review, and dashboard proof remain incomplete.  
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

### What was not verified by this Sentry intake proof

- Slack alert routing.
- Alert threshold behavior.
- Alert acknowledgement.
- P1 escalation.
- Dashboard section completeness.
- Provider dashboard links.
- Public rollout readiness.

### Launch decision

This unblocks the “does Sentry intake work?” question.  
Separately, saved Sentry issue-alert delivery to Slack and production-safe app-generated synthetic alert routing to Slack have now been proven.  
This still does not unblock private beta dashboard proof, deployed smoke proof, support/rollback proof, risk review, or public rollout escalation proof.

---

# Current Sentry-to-Slack routing evidence

## Evidence: saved Sentry issue-alert rule to Slack

Status: PARTIAL PASS  
Owner: Tori  
Environment: Sentry issue-alert rule / no deployed app environment  
Date: 2026-06-07  
Time observed: 8:36 PM local  
Destination: Tovis Slack workspace / `#tovis-ops-alerts`  
Trigger method: Sentry alert builder test notification from saved issue-alert rule  
Alert rule saved: Yes  
Sentry page/rule name: `Notify #tovis-ops-alerts via Slack`  
Slack message title: Sentry Test Issue  
Project: `tovis-app`  
Sentry alert shown in Slack: Issue Stream  
Short ID shown in Slack: TOVIS-APP-J  
Runbook link included: No — default Sentry test issue message  
Acknowledged by: Tori observed message in Slack; formal acknowledgement workflow TODO  
Evidence record: docs/launch-readiness/slack-alerts.md and docs/launch-readiness/oncall.md

### What was verified

- Paid Sentry plan is enabled.
- Sentry app is added to `#tovis-ops-alerts`.
- Tori's Slack account is linked to Sentry as `support@tovis.app`.
- A Sentry issue-alert rule was created/saved for the `tovis-app` project.
- The saved Sentry issue-alert rule can send a test notification to the intended private-beta Slack alert channel.
- The Slack message showed project `tovis-app`, alert `Issue Stream`, and short ID `TOVIS-APP-J`.

### What was not verified by this saved-rule test

- App-generated production-safe synthetic alert routing.
- Alert threshold behavior for a launch-critical signal.
- Runbook link included in launch alert message.
- Formal acknowledgement timing.
- P1 escalation.
- Launch dashboard completeness.
- Provider dashboard links.
- Public rollout readiness.

### Launch decision

This partially unblocked private-beta alert routing by proving a saved Sentry issue-alert rule can deliver a test notification to Slack. The production-safe app-generated synthetic alert evidence below later proved deployed app-generated alert routing to `#tovis-ops-alerts`.

## Evidence: production-safe app-generated synthetic Sentry alert routed to Slack

Status: PASS  
Owner: Tori  
Environment: production  
Date: 2026-06-08  
Time observed: 6:31 PM local  
Route: `POST /api/internal/debug/sentry-test`  
Trigger method: authorized curl request with production origin header and internal job secret  
Sentry event ID: `f7a0d19cb4a040a3a21f4679086f166f`  
Alert key: `launch-readiness.synthetic-sentry-alert.v2`  
Alert message: `TOVIS production-safe synthetic Sentry alert v2`  
Slack destination: Tovis Slack workspace / `#tovis-ops-alerts`  
Slack alert rule: `Notify #tovis-ops-alerts via Slack`  
Slack short ID: `TOVIS-APP-K`  
Acknowledged by: Tori observed the alert in Slack  
Runbook link included in Slack message: No — follow-up TODO  
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
- Route-specific P1/P2 starter thresholds are documented; live alert rules and routing verification are still TODO.
- Live dashboard proof is still TODO.
- Public P1 escalation remains blocked until backup owner and escalation path exist.

### Launch decision

This clears the private-beta blocker for basic app-generated synthetic alert routing to Slack. Private beta remains NO-GO until dashboard proof, deployed smoke proof, support path, rollback path, and risk review are complete or explicitly accepted.

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
| Missing named backup owner | ACCEPTED as private-beta risk on 2026-06-09 (solo operator, recorded in RISK-001); public launch blocker | docs/launch-readiness/oncall.md, docs/launch-readiness/risk-register.md |
| Sentry-to-Slack alert routing | Saved Sentry issue-alert delivery and production-safe app-generated synthetic alert routing are proven; route-specific starter thresholds are documented. Remaining follow-ups are runbook-link-in-message, formal acknowledgement timing, live alert-rule/dashboard coverage, route-specific routing proof, and public P1 escalation | docs/launch-readiness/slack-alerts.md, docs/launch-readiness/oncall.md, docs/launch-readiness/test-proof.md |
| Deployed staging dashboard proof missing | Private beta/public rollout blocker until linked or accepted | docs/launch-readiness/sentry-dashboard.md |
| Deployed smoke proof execution | Checklist exists; execution against target environment remains TODO | docs/launch-readiness/deployed-smoke-proof.md |
| Support and rollback decisions | Decision record and templates exist; Tori decisions remain TODO | docs/launch-readiness/private-beta-support-rollback.md |
| Tenant foundation | Partial foundation exists; first private beta treats white-label as out of scope unless explicitly added | docs/launch-readiness/tenant-foundation-audit.md |

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
Commit: TODO — record final beta decision commit; current audit HEAD was 57ce1ef2fbb5be1480e0d41d1126d2d08c15bcdf
Environment: TODO
Date: TODO
Sentry event proof: e56044a034cb4fb78d1b09801fb43da5
Alert routing proof: PASS / FOLLOW-UPS TODO — production-safe app-generated synthetic alert routed to #tovis-ops-alerts; event ID f7a0d19cb4a040a3a21f4679086f166f; Slack short ID TOVIS-APP-K; runbook-link-in-message and formal acknowledgement timing TODO
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
Commit: TODO — record final public rollout decision commit
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

A local passing test proves the repo behavior. A deployed Sentry event proves intake. A saved Sentry issue-alert test notification proves basic routing. A production-safe app-generated synthetic alert proves the deployed app can generate an alert that reaches Slack. A launch gate proves humans can see, understand, respond to, and roll back real production failures.

This document should be strict. A launch gate that does not block anything is just a vibes checklist wearing a tiny hard hat.
