# TOVIS Launch Readiness Checklist

This checklist tracks the launch-hardening work required before private beta and public rollout.

Use this file as the source of truth for launch readiness. Do not mark an item DONE unless the implementation exists, tests/docs exist where appropriate, and the linked files are committed.

## Important distinction

- Implemented means the code or doc exists and is committed.
- Tested locally means focused local proof exists.
- Tested in CI means the relevant proof has run in CI.
- Verified deployed means the behavior has been verified in staging or production.
- Operationalized means monitoring, alerts, owners, escalation, runbooks, rollout, or support workflow exists.

Local proof and deployed operational proof are different things. A local passing suite proves code behavior. A deployed dashboard, alert, or provider check proves the system can be operated when real users are involved.

## Status legend

| Status | Meaning |
|---|---|
| TODO | Not started or not proven. |
| IN PROGRESS | Partially implemented or partially proven. |
| DONE | Implemented, tested/documented where appropriate, committed, and not waiting on known required proof for this scope. |
| PASS LOCALLY | Local proof passed, but deployed/operational proof may still be required. |
| PASS DEPLOYED | Verified against deployed staging or production. |
| BLOCKED | Cannot move forward until a dependency or decision is resolved. |
| DEFERRED | Intentionally postponed beyond current launch-readiness scope. |
| PARTIAL | Some proof exists, but production-grade proof is still missing. |

## Proof columns

| Column | Meaning |
|---|---|
| Implemented | Code/doc exists and is committed. |
| Tested locally | Focused local tests or local verification have passed. |
| Tested in CI | Relevant CI run has passed. |
| Verified deployed | Behavior has been verified in staging/production. |
| Operationalized | Monitoring, alerts, runbooks, owners, rollout, or support workflow exists. |

---

# Current verified baseline

| Item | Current state |
|---|---|
| Current repo audit HEAD | `57ce1ef2fbb5be1480e0d41d1126d2d08c15bcdf` |
| Latest full launch-ops proof commit | `ae30aff20aff8b205e65f57bf3ae8b5b8b553b29` |
| Earlier Phase 1 verified commit | 458a5a4bb0715c59a4198e9457c5b5a2c6cd4ef3 |
| Phase 1 privacy status | Complete for current pre-launch scope; launch-env reruns remain tracked. |
| Phase 2 repo-side status | Load suite, chaos suite, Sentry config, and launch docs are implemented. |
| Current safe local verification | PASS: `pnpm typecheck`, `pnpm verify:privacy-phase1`, and `pnpm test:chaos` passed on 2026-06-10. |
| pnpm verify:launch-ops | PASS LOCALLY against audited code commit `ae30aff20aff8b205e65f57bf3ae8b5b8b553b29`; rerun on final beta commit |
| Chaos suite | PASS LOCALLY: 6 files / 17 tests passed |
| Launch load suite | PASS LOCALLY: 8/8 launch load steps passed |
| Deployed Sentry intake | PASS DEPLOYED: synthetic event captured, event ID e56044a034cb4fb78d1b09801fb43da5 |
| Deployed health/readiness proof | PASS DEPLOYED / DASHBOARD LINK TODO: `/api/health/live`, `/api/health`, and `/api/health/ready` passed on `https://www.tovis.app`; dashboard/synthetic monitor link still TODO. |
| Sentry release/environment metadata | Visible in deployed response metadata; dashboard proof still TODO |
| Live dashboard proof | TODO |
| Slack/Sentry alert routing | PASS / RUNBOOK LINK TODO: paid Sentry plan enabled; `#tovis-ops-alerts` selected; saved Sentry issue-alert rule delivered a test notification to Slack; production-safe app-generated synthetic alert routed to Slack on 2026-06-08 at 6:31 PM local. Event ID `f7a0d19cb4a040a3a21f4679086f166f`; Slack short ID `TOVIS-APP-K`. Runbook-link-in-message and formal acknowledgement timing still TODO. |
| Backup owner | BLOCKED for public rollout |
| P1 escalation path | BLOCKED for public rollout |
| Public rollout status | NO-GO |

---

# Overall launch status

| Area | Current status |
|---|---|
| Core product flow | Mostly wired; full staging/browser proof still needed for launch confidence. |
| Booking lifecycle slice | Strong local code/test posture; deployed lifecycle proof still needed. |
| Privacy / PII readiness | Phase 1 complete for current pre-launch scope; remaining work is tracked operational/deferred privacy debt. |
| Launch operations | Repo-side Phase 2 proof is green locally; saved Sentry issue-alert delivery to Slack is proven; production-safe app-generated synthetic alert routing to Slack is proven. Live dashboards, runbook-link-in-message, formal acknowledgement timing, backup owner, support/rollback proof, and deployed/provider proof remain open. |
| Sentry observability | Release/environment config implemented; deployed Sentry intake proven; saved Sentry issue-alert delivery to Slack proven; starter alert thresholds documented; production-safe app-generated synthetic alert routing to Slack proven. Dashboard sections, live alert-rule proof, route-specific routing proof, runbook-link-in-message, and formal acknowledgement timing still TODO. |
| Load tests | Launch-critical load suite exists and passed locally; staging/rollout-commit proof still required before public rollout. |
| Chaos tests | Chaos suite exists and passed locally; evidence is recorded; rerun on rollout commit. |
| White-label SaaS readiness | Not ready; tenant foundation is partial, but white-label productization/isolation is not complete and is not required for first private beta unless explicitly scoped. |
| Private beta readiness | Still NO-GO until private-beta gates, live dashboard proof, alert path, rollback path, and core staging proof are complete or explicitly accepted. |
| Public rollout readiness | NO-GO until private beta exits cleanly, backup owner exists, P1 escalation is tested, dashboards/alerts are live, load/chaos proof is current, and final signoff is complete. |
| Current focus | Finish operational proof: dashboards, deployed staging checks, provider proof, support/rollback decisions, backup owner, go/no-go evidence, live alert-rule/routing proof, runbook-link-in-message, and formal acknowledgement timing. |

---

# Launch blocker tracker

| Item | Status | Implemented | Tested locally | Tested in CI | Verified deployed | Operationalized | Owner | Notes |
|---|---|---:|---:|---:|---:|---:|---|---|
| Phase 1 privacy/PII contract unblock | DONE | Yes | Yes | Unknown | Partial | Partial | Tori | pnpm verify:privacy-phase1 passed locally; launch-env reruns remain tracked. |
| On-call ownership doc | IN PROGRESS | Yes | N/A | N/A | N/A | Partial | Tori | Primary owner named; backup owner and public escalation still blocked. |
| Go/no-go launch gate | IN PROGRESS | Yes | N/A | N/A | N/A | Partial | Tori | Evidence fields still need final proof links. |
| Private beta checklist | IN PROGRESS | Yes | N/A | N/A | N/A | Partial | Tori | Proof still TODO; private beta remains NO-GO. |
| Public rollout checklist | IN PROGRESS | Yes | N/A | N/A | N/A | Partial | Tori | Public rollout remains blocked. |
| Risk register | IN PROGRESS | Yes | N/A | N/A | N/A | Partial | Tori | Review/update as proof lands. |
| Sentry release/environment config | DONE | Yes | Yes | Unknown | Partial | Partial | Tori | Implemented in server, edge, and client config; deployed metadata observed. |
| Deployed Sentry intake | PASS DEPLOYED | Yes | N/A | Unknown | Yes | Partial | Tori | Synthetic event captured: e56044a034cb4fb78d1b09801fb43da5. |
| Sentry dashboard proof doc | IN PROGRESS | Yes | N/A | N/A | No | Partial | Tori | Live dashboard links and section evidence still TODO. |
| Slack alert map | IN PROGRESS / SYNTHETIC ALERT ROUTING PASS | Yes | N/A | N/A | Partial | Partial | Tori | Paid Sentry plan enabled; saved Sentry issue-alert rule delivered to `#tovis-ops-alerts`; production-safe app-generated synthetic alert routed to Slack. Runbook-link-in-message and formal acknowledgement timing still TODO. |
| Load test plan | IN PROGRESS | Yes | N/A | N/A | No | Partial | Tori | Plan exists; local suite proof now exists; staging proof still TODO. |
| Chaos test plan | IN PROGRESS / LOCAL PROOF EXISTS | Yes | N/A | N/A | No | Partial | Tori | Local chaos proof is recorded; operational dashboard/alert proof still TODO. |
| Full booking lifecycle E2E | IN PROGRESS | Partial | Partial | Unknown | No | No | Tori | API-assisted proof exists; full browser/staging proof still needed. |
| Load tests for launch-critical flows | PASS LOCALLY | Yes | Yes | Unknown | No | Partial | Tori | 8/8 launch load steps passed locally; staging/rollout proof still required. |
| Chaos tests for dependency failures | PASS LOCALLY | Yes | Yes | Unknown | No | Partial | Tori | 6 chaos files / 17 tests passed locally. |
| Live dashboard panels | TODO | Partial | N/A | N/A | No | No | Tori | Sentry intake is proven; dashboard panels are not. |
| Alert routing and escalation | SYNTHETIC ALERT ROUTING PASS / P1 ESCALATION BLOCKED | Partial | N/A | No | Partial | Partial | Tori | Paid Sentry plan enabled; saved Sentry issue-alert rule delivered a test notification to `#tovis-ops-alerts`; production-safe app-generated synthetic alert routed to Slack. Starter thresholds are documented; runbook-link-in-message, formal acknowledgement timing, live alert-rule proof, route-specific routing proof, and public P1 escalation are still TODO/BLOCKED. |
| Named backup owner | BLOCKED | No | No | No | No | No | Tori | Required before public rollout. |
| Provider/deployed readiness proof | PARTIAL | Partial | Partial | Unknown | Partial | No | Tori | Domain/app/Sentry intake and deployed health/readiness proof exist; provider dashboards, quotas, storage policy, and remaining deployed flow proof still needed. |
| Rollback proof | TEMPLATE READY / DECISION TODO | Partial | N/A | N/A | No | Partial | Tori | `docs/launch-readiness/private-beta-support-rollback.md` defines pause triggers, required decisions, comms templates, and post-rollback smoke checks; final values/drill/evidence still needed. |
| Tenant data model / white-label isolation | PARTIAL FOUNDATION / NOT PRIVATE-BETA SCOPE | Partial | Partial | Unknown | No | No | Tori | Tenant model/migration/root seed/backfill, resolver, visibility helpers, discovery guard, and isolation tests exist; untracked tenant helpers must be resolved before final proof. White-label productization remains incomplete and not required for first private beta unless scoped. |
| UploadSession binding | TODO | No | No | No | No | No | Tori | Still needed if upload hardening remains public-launch scope. |
| Realtime/session refresh strategy | TODO | No | No | No | No | No | Tori | Pro session state endpoint and polling are not implemented. |

---

# Phase 1 — Privacy/PII contract unblock

## Goal

Remove the hard public-launch privacy blocker by establishing a real cryptographic privacy boundary, centralized normalization/redaction, and privacy request foundations.

## Current status

DONE for current pre-launch scope.

Earlier local verification at commit 458a5a4:

| Command | Result |
|---|---|
| pnpm typecheck | Passed |
| pnpm verify:privacy-phase1 | Passed |
| node tools/check-canonical-normalization.mjs | Passed |
| node tools/check-pii-plaintext-reads.mjs | Passed with 471 known baseline entries |
| pnpm test:privacy-phase1 | 14 files / 195 tests passed |
| pnpm test:privacy-export-delete | 6 files / 45 tests passed |

Rerun Phase 1 verification on the final private-beta/public-rollout commit before signoff.

## Items

| Item | Status | Implemented | Tested locally | Tested in CI | Verified deployed | Operationalized | Owner | Notes |
|---|---|---:|---:|---:|---:|---:|---|---|
| Canonical contact normalizer | DONE | Yes | Yes | Unknown | N/A | Partial | Tori | lib/security/contactNormalization.ts; guard passes. |
| Canonical normalization guard | DONE | Yes | Yes | Unknown | N/A | Partial | Tori | tools/check-canonical-normalization.mjs. |
| Audit payload redaction | DONE | Yes | Yes | Unknown | N/A | Partial | Tori | lib/security/auditRedaction.ts; applied to audit write paths. |
| AEAD address envelope | DONE | Yes | Yes | Unknown | Partial | Partial | Tori | Address encryption helper and backfill exist. |
| Address encryption backfill script | DONE | Yes | Yes | Unknown | Partial | Partial | Tori | Launch-env rerun if applicable. |
| PII plaintext-read guard | DONE | Yes | Yes | Unknown | N/A | Partial | Tori | Guard passes with 471 known baseline entries. |
| HMAC contact hash v2 | DONE | Yes | Yes | Unknown | Partial | Partial | Tori | HMAC helper, v2 columns, v2-only readers, and drop migration exist. |
| HMAC v2 backfill script | DONE | Yes | Yes | Unknown | Partial | Partial | Tori | Launch-env rerun if applicable. |
| Legacy SHA-256 contact hash drop migration | DONE | Yes | Yes | Unknown | Partial | Partial | Tori | 20260601000000_drop_legacy_contact_lookup_hashes. |
| Data export foundation | DONE | Yes | Yes | Unknown | Partial | Partial | Tori | lib/privacy/exportUserData.ts. |
| Data delete/anonymization foundation | DONE | Yes | Yes | Unknown | Partial | Partial | Tori | lib/privacy/deleteUserData.ts. |
| Export/delete protected routes | DONE | Yes | Yes | Unknown | Partial | Partial | Tori | Internal SUPER_ADMIN-gated routes exist and are tested. |
| Privacy request runbook | DONE | Yes | N/A | N/A | N/A | Partial | Tori | docs/runbooks/privacy-request.md. |
| Launch-env HMAC v2 rerun | TODO | Yes | Partial | No | No | No | Tori | Required if target launch env has rows needing proof. |
| Launch-env AEAD address rerun | TODO | Yes | Partial | No | No | No | Tori | Required if target launch env has rows needing proof. |
| PII plaintext-read baseline burn-down | DEFERRED | Yes | Yes | No | N/A | Partial | Tori | Accepted baseline; burn down as related files are touched. |
| Storage object byte deletion workflow | DEFERRED | Partial | Partial | No | No | Partial | Tori | Track in privacy/runbook risk register. |
| Message deletion/retention implementation | DEFERRED | Partial | Partial | No | No | Partial | Tori | Track in retention/privacy follow-up. |
| Booking-level anonymization beyond current boundary | DEFERRED | Partial | Partial | No | No | Partial | Tori | Not a Phase 1 blocker; keep visible. |

## Key files

- lib/security/contactNormalization.ts
- tools/check-canonical-normalization.mjs
- lib/security/auditRedaction.ts
- lib/security/crypto/aead.ts
- lib/security/addressEncryption.ts
- prisma/scripts/backfillAddressEncryption.ts
- tools/check-pii-plaintext-reads.mjs
- lib/security/crypto/hashLookup.ts
- lib/security/contactLookup.ts
- prisma/scripts/backfillContactHashV2.ts
- prisma/migrations/20260601000000_drop_legacy_contact_lookup_hashes/migration.sql
- lib/privacy/exportUserData.ts
- lib/privacy/deleteUserData.ts
- lib/privacy/exportSafety.ts
- docs/privacy/phase-1-privacy-proof.md
- docs/privacy/phase-1-remaining-work.md
- docs/runbooks/privacy-request.md

## Acceptance criteria

- Contact normalization is centralized.
- Audit payloads are redacted before persistence.
- Address privacy envelope uses AEAD.
- Contact lookup uses HMAC v2.
- Legacy SHA-256 contact hash columns are dropped.
- Export/delete foundations exist and are protected.
- Privacy verification commands pass on launch commit.
- Remaining operational/deferred privacy work is tracked and does not masquerade as missing implementation.

---

# Phase 2 — Launch ops proof

## Goal

Prove the system can be operated during private beta and public rollout.

This phase is about operated readiness, not just code existence. Dashboards, alerts, runbooks, load proof, chaos proof, rollback, and go/no-go evidence must all exist before public rollout.

## Current Phase 2 status

| Area | Status | Notes |
|---|---|---|
| Launch docs scaffold | DONE / IN PROGRESS | Required docs exist and are being reconciled with new proof. |
| Sentry release/environment config | DONE | Server, edge, and client config implemented. |
| Deployed Sentry intake | PASS DEPLOYED | Synthetic event captured: e56044a034cb4fb78d1b09801fb43da5. |
| Sentry dashboard proof | TODO LIVE PROOF | Dashboard sections still need links, thresholds, and evidence. |
| Slack alert routing | PASS / RUNBOOK LINK TODO | Paid Sentry plan enabled; Sentry app added to `#tovis-ops-alerts`; saved Sentry issue-alert rule delivered a test notification to Slack; production-safe app-generated synthetic alert routed to Slack on 2026-06-08 at 6:31 PM local. Event ID `f7a0d19cb4a040a3a21f4679086f166f`; Slack short ID `TOVIS-APP-K`. Runbook-link-in-message and formal acknowledgement timing still TODO. |
| Launch load suite | PASS LOCALLY | 8/8 launch load steps passed locally. |
| Chaos suite | PASS LOCALLY | 6 files / 17 tests passed locally. |
| Backup owner | BLOCKED | Required before public rollout. |
| P1 escalation | BLOCKED | Required before public rollout. |
| Provider/staging proof | PARTIAL | Deployed health/readiness proof exists. Provider dashboards, quotas, storage policy proof, and remaining deployed flow proof still needed. |

## Phase 2 docs scaffold

| Item | Status | Implemented | Tested locally | Tested in CI | Verified deployed | Operationalized | Owner | Notes |
|---|---|---:|---:|---:|---:|---:|---|---|
| On-call plan | IN PROGRESS | Yes | N/A | N/A | N/A | Partial | Tori | Backup and public escalation unresolved. |
| Go/no-go gate | IN PROGRESS | Yes | N/A | N/A | N/A | Partial | Tori | Evidence fields still TODO. |
| Private beta checklist | IN PROGRESS | Yes | N/A | N/A | N/A | Partial | Tori | Evidence still TODO. |
| Public rollout checklist | IN PROGRESS | Yes | N/A | N/A | N/A | Partial | Tori | Public rollout remains blocked. |
| Risk register | IN PROGRESS | Yes | N/A | N/A | N/A | Partial | Tori | Review/update as proof lands. |
| Sentry dashboard proof doc | IN PROGRESS | Yes | N/A | N/A | Partial | Partial | Tori | Sentry intake proven; live dashboard links still TODO. |
| Slack alert map | IN PROGRESS / SYNTHETIC ALERT ROUTING PASS | Yes | N/A | N/A | Partial | Partial | Tori | Saved Sentry issue-alert rule delivered to `#tovis-ops-alerts`; production-safe app-generated synthetic alert routed to Slack. Runbook-link-in-message and formal acknowledgement timing still TODO. |
| Load test plan | IN PROGRESS | Yes | N/A | N/A | No | Partial | Tori | Local load proof exists; staging proof TODO. |
| Chaos test plan | IN PROGRESS / LOCAL PROOF EXISTS | Yes | N/A | N/A | No | Partial | Tori | Local chaos proof is recorded; operational dashboard/alert proof still TODO. |
| Deployed smoke proof checklist | READY / EXECUTION TODO | Yes | N/A | N/A | No | Partial | Tori | `docs/launch-readiness/deployed-smoke-proof.md` defines target-environment proof steps and evidence template. |
| Private-beta support/rollback decision record | READY / HUMAN DECISIONS TODO | Yes | N/A | N/A | N/A | Partial | Tori | `docs/launch-readiness/private-beta-support-rollback.md` defines support, rollback, pause, and comms decisions. |
| Tenant foundation audit | READY / FINAL WORKTREE DECISION TODO | Yes | N/A | N/A | No | Partial | Tori | `docs/launch-readiness/tenant-foundation-audit.md` records tracked tenant foundation pieces and untracked tenant work. |

## Observability and alerting

| Item | Status | Implemented | Tested locally | Tested in CI | Verified deployed | Operationalized | Owner | Notes |
|---|---|---:|---:|---:|---:|---:|---|---|
| Sentry release/deployment tagging | DONE | Yes | Yes | Unknown | Partial | Partial | Tori | Release/dist/environment config implemented; deployed metadata observed. |
| Sentry synthetic event route/proof | PASS DEPLOYED | Yes | Yes | Unknown | Yes | Partial | Tori | Event ID e56044a034cb4fb78d1b09801fb43da5. |
| Console/log capture policy | IN PROGRESS | Yes | N/A | N/A | Partial | Partial | Tori | Disabled by default; production enablement requires redaction review. |
| Health/readiness dashboard section | TODO LIVE PROOF | Partial | Partial | Unknown | No | No | Tori | Health endpoints exist; dashboard evidence missing. |
| Booking funnel dashboard section | TODO LIVE PROOF | Partial | Yes | Unknown | No | No | Tori | Local load proof exists; live Sentry proof TODO. |
| Pro session lifecycle dashboard section | TODO LIVE PROOF | Partial | Partial | Unknown | No | No | Tori | Needs live Sentry/dashboard proof. |
| Media upload dashboard section | TODO LIVE PROOF | Partial | Yes | Unknown | No | No | Tori | Local media load/chaos proof exists; live dashboard proof TODO. |
| Payments/webhooks dashboard section | TODO LIVE PROOF | Partial | Yes | Unknown | No | No | Tori | Local checkout/webhook proof exists; live dashboard proof TODO. |
| Notifications dashboard section | TODO LIVE PROOF | Partial | Yes | Unknown | No | No | Tori | Local notification load/chaos proof exists; live dashboard proof TODO. |
| Background jobs dashboard section | TODO LIVE PROOF | Partial | Yes | Unknown | No | No | Tori | Notification processor covered locally; live dashboard proof TODO. |
| Auth/rate limits dashboard section | TODO LIVE PROOF | Partial | Yes | Unknown | No | No | Tori | Signup/rate-limit behavior covered locally; live dashboard proof TODO. |
| Infra dependencies dashboard section | TODO LIVE PROOF | Partial | Yes | Unknown | No | No | Tori | Provider dashboards/runbooks exist; live proof missing. |
| SLO/error budget dashboard section | TODO LIVE PROOF | Partial | Partial | Unknown | No | No | Tori | Starter thresholds exist; live dashboard evidence still missing. |
| Slack private-beta alert channel | DONE / SYNTHETIC ALERT ROUTING PASS | Yes | N/A | No | Partial | Partial | Tori | `#tovis-ops-alerts` selected; Sentry app added; saved Sentry issue-alert rule delivered test notification; production-safe app-generated synthetic alert routed to Slack. |
| P1/P2 Slack alert routing | SYNTHETIC ALERT ROUTING PASS / LIVE RULE PROOF TODO | Partial | N/A | No | Partial | Partial | Tori | Saved Sentry issue-alert rule delivered a test notification to `#tovis-ops-alerts`; production-safe app-generated synthetic alert routed to Slack. Starter thresholds are documented; live alert rules, runbook links in messages, acknowledgement timing, and public escalation are still TODO. |
| Synthetic staging alert test | PASS PRODUCTION-SAFE SYNTHETIC / FOLLOW-UPS TODO | Partial | No | No | Yes | Partial | Tori | Production-safe app-generated synthetic alert routed to `#tovis-ops-alerts`; event ID `f7a0d19cb4a040a3a21f4679086f166f`; Slack short ID `TOVIS-APP-K`. Runbook-link-in-message, formal acknowledgement timing, live alert-rule proof, and route-specific routing proof still TODO. |
| Public P1 escalation path | BLOCKED | No | No | No | No | No | Tori | Requires backup owner and tested escalation path. |

## Load tests

| Item | Status | Implemented | Tested locally | Tested in CI | Verified deployed | Operationalized | Owner | Notes |
|---|---|---:|---:|---:|---:|---:|---|---|
| Signup load test | PASS LOCALLY | Yes | Yes | Unknown | No | Partial | Tori | Passed with expected 201/429 mix and zero real failures. |
| Availability bootstrap load test | PASS LOCALLY | Yes | Yes | Unknown | No | Partial | Tori | 30/30 successful requests in smoke run. |
| Hold create load test | PASS LOCALLY | Yes | Yes | Unknown | No | Partial | Tori | Passed with expected conflict/rate-limit pressure. |
| Booking finalize load test | PASS LOCALLY | Yes | Yes | Unknown | No | Partial | Tori | Passed locally. |
| Media metadata load test | PASS LOCALLY | Yes | Yes | Unknown | No | Partial | Tori | 10/10 successful requests in smoke run. |
| Checkout load test | PASS LOCALLY | Yes | Yes | Unknown | No | Partial | Tori | 10/10 successful requests in smoke run. |
| Stripe webhook replay load test | PASS LOCALLY | Yes | Yes | Unknown | No | Partial | Tori | 10/10 successful requests; duplicate replay behavior visible. |
| Notification processing load test | PASS LOCALLY | Yes | Yes | Unknown | No | Partial | Tori | 10/10 successful requests in smoke run. |
| Aggregate launch load suite | PASS LOCALLY | Yes | Yes | Unknown | No | Partial | Tori | tests/load/run-launch-load-suite.ts; 8/8 steps passed. |
| test:load:launch script | DONE | Yes | Yes | Unknown | No | Partial | Tori | Exists and passed locally. |
| Staging load proof | TODO | Yes | Partial | Unknown | No | No | Tori | Required before public rollout. |

## Chaos tests

| Item | Status | Implemented | Tested locally | Tested in CI | Verified deployed | Operationalized | Owner | Notes |
|---|---|---:|---:|---:|---:|---:|---|---|
| Chaos test harness / suite | PASS LOCALLY | Yes | Yes | Unknown | No | Partial | Tori | Chaos suite exists under tests/chaos. |
| Redis outage chaos test | PASS LOCALLY | Yes | Yes | Unknown | No | Partial | Tori | Passed locally. |
| Supabase Storage outage chaos test | PASS LOCALLY | Yes | Yes | Unknown | No | Partial | Tori | Passed locally. |
| Stripe webhook storm chaos test | PASS LOCALLY | Yes | Yes | Unknown | No | Partial | Tori | Passed locally. |
| Postmark degradation chaos test | PASS LOCALLY | Yes | Yes | Unknown | No | Partial | Tori | Passed locally. |
| Twilio degradation chaos test | PASS LOCALLY | Yes | Yes | Unknown | No | Partial | Tori | Passed locally. |
| DB degradation chaos test | PASS LOCALLY | Yes | Yes | Unknown | No | Partial | Tori | Passed locally; distinct from full replica-lag proof if that remains in scope. |
| DB replica lag chaos test | TODO / PARTIAL | Partial | Partial | Unknown | No | No | Tori | Generic DB degradation is covered; explicit replica-lag/stale-read proof still needs confirmation. |
| test:chaos script | DONE | Yes | Yes | Unknown | No | Partial | Tori | Exists and passed locally. |
| verify:launch-ops script | PASS LOCALLY | Yes | Yes | Unknown | No | Partial | Tori | Passed locally against audited code commit `ae30aff20aff8b205e65f57bf3ae8b5b8b553b29`; rerun on final launch commit. |

## Phase 2 acceptance criteria

Private beta requires:

- pnpm typecheck passes on beta commit.
- pnpm verify:privacy-phase1 passes on beta commit.
- Private beta checklist is complete.
- Rollback owner/path is documented.
- Slack alert destination exists and Sentry-to-Slack delivery to `#tovis-ops-alerts` is working during the beta window.
- At least one production-safe app-generated synthetic alert routes successfully; runbook-link-in-message and formal acknowledgement timing are completed or explicitly accepted as private-beta follow-ups.
- Deployed health/readiness proof exists and dashboard/synthetic monitor follow-up is linked or accepted.
- Booking lifecycle smoke proof exists.
- Payment/webhook proof exists if payments are enabled.
- Media/private-media proof exists if media is enabled.
- Sentry intake is working.
- Useful dashboard sections exist for launch-critical flows.
- Risk register has no unowned High/Critical private-beta blockers.

Public rollout requires:

- All private beta blockers are closed.
- Named backup owner exists.
- P1 escalation path is tested.
- Live dashboard proof exists for all required sections.
- P1/P2 launch-critical alerts route, link to runbooks, have thresholds, and have acknowledgement/escalation evidence.
- Load tests pass on the rollout commit/environment.
- Chaos tests pass on the rollout commit.
- Provider quota/capacity is confirmed.
- Rollback plan is complete.
- go-no-go.md is signed with final public rollout decision.

---

# Core booking and lifecycle readiness

## Goal

Make the booking/session lifecycle impossible to complete incorrectly and prove it under real launch conditions.

| Item | Status | Implemented | Tested locally | Tested in CI | Verified deployed | Operationalized | Owner | Notes |
|---|---|---:|---:|---:|---:|---:|---|---|
| Remove direct UI-driven SessionStep.DONE transition | DONE | Yes | Yes | Unknown | No | Partial | Tori | Backend closeout rules own completion. |
| Surface backend closeout blockers in Pro flow | DONE | Yes | Yes | Unknown | No | Partial | Tori | Pro sees blockers. |
| Keep backend direct DONE transition blocked | DONE | Yes | Yes | Unknown | No | Partial | Tori | Write boundary blocks illegal transition. |
| Add booking closeout smoke coverage | DONE | Yes | Yes | Unknown | No | Partial | Tori | Smoke coverage exists. |
| Add full lifecycle action regression suite | TODO / PARTIAL | Partial | Partial | No | No | No | Tori | Needs action-by-action legal/illegal proof if not already covered. |
| Add full booking lifecycle browser E2E | IN PROGRESS | Partial | Partial | Unknown | No | No | Tori | API-assisted flow exists; full browser path pending. |
| Add staging/prod lifecycle proof | TODO | No | No | No | No | No | Tori | Record proof against commit/environment. |
| Add pro session state endpoint | TODO | No | No | No | No | No | Tori | Needed for polling/realtime MVP. |
| Add active-session polling | TODO | No | No | No | No | No | Tori | Needed for session refresh. |

## Key files

- app/pro/bookings/[id]/session/page.tsx
- lib/booking/writeBoundary.ts
- lib/booking/lifecycleContract.ts
- tests/e2e/booking-lifecycle-smoke.spec.ts
- tests/e2e/booking-lifecycle.spec.ts

---

# Token, retry, and idempotency readiness

## Goal

Use secure action-token flows and make retryable mutations safe.

| Item | Status | Implemented | Tested locally | Tested in CI | Verified deployed | Operationalized | Owner | Notes |
|---|---|---:|---:|---:|---:|---:|---|---|
| Move active aftercare/rebook paths to ClientActionToken | DONE | Yes | Yes | Unknown | No | Partial | Tori | Active flow no longer depends on publicToken. |
| Add active-path guard against aftercare.publicToken usage | DONE | Yes | Yes | Unknown | No | Partial | Tori | Guard exists. |
| Add rebook token GET/POST coverage | DONE | Yes | Yes | Unknown | No | Partial | Tori | Route coverage exists. |
| Add token-scoped rebook idempotency | DONE | Yes | Yes | Unknown | No | Partial | Tori | Idempotency coverage exists. |
| Add claim/NFC path tests and docs | DONE | Yes | Yes | Unknown | No | Partial | Tori | Claim/NFC tests exist; deployed proof still needed. |
| Keep legacy AftercareSummary.publicToken only as deprecated field | IN PROGRESS | Yes | Partial | Unknown | No | No | Tori | Contraction still pending. |
| Create idempotency route map document | TODO | No | No | No | No | No | Tori | Add docs/launch-readiness/idempotency-map.md. |
| Add idempotency ledger cleanup/reaper | TODO | No | No | No | No | No | Tori | Retention/cleanup proof missing. |
| Redact persisted idempotency response JSON | TODO | No | No | No | No | No | Tori | responseBodyJson can retain PII unless redacted. |
| Add full retry/idempotency suite | TODO / PARTIAL | Partial | Partial | Unknown | No | No | Tori | Several route tests exist; full suite/map still missing. |

---

# Security, media, and storage readiness

## Goal

Harden storage, media, rate limits, request trust boundaries, and safe logging.

| Item | Status | Implemented | Tested locally | Tested in CI | Verified deployed | Operationalized | Owner | Notes |
|---|---|---:|---:|---:|---:|---:|---|---|
| Supabase Storage bucket/policy migration as code | DONE | Yes | Yes | Unknown | No | Partial | Tori | Migration exists. |
| Media-private restrictive policy baseline | DONE | Yes | Yes | Unknown | No | Partial | Tori | Repo proof exists; deployed proof still needed. |
| Media-public policy baseline | DONE | Yes | Yes | Unknown | No | Partial | Tori | Policy baseline exists. |
| Central rate-limit policy definitions | DONE | Yes | Yes | Unknown | No | Partial | Tori | Policies exist. |
| High-risk route/wrapper rate-limit enforcement | DONE | Yes | Yes | Unknown | No | Partial | Tori | Code coverage exists. |
| Auth route rate limits | DONE | Yes | Yes | Unknown | No | Partial | Tori | Code coverage exists. |
| SMS route rate limits | DONE | Yes | Yes | Unknown | No | Partial | Tori | Code coverage exists. |
| SMS fail-closed behavior when Redis unavailable | DONE | Yes | Yes | Unknown | No | Partial | Tori | Local proof exists. |
| Token route rate limits | DONE | Yes | Yes | Unknown | No | Partial | Tori | Code coverage exists. |
| Media route rate limits | DONE | Yes | Yes | Unknown | No | Partial | Tori | Code coverage exists. |
| Origin/Referer checks | DONE | Yes | Yes | Unknown | Partial | Partial | Tori | Middleware exists; deployed invalid-origin behavior observed during Sentry debug route testing. |
| Booking route safe logging hardening | DONE | Yes | Yes | Unknown | No | Partial | Tori | Focused route proof exists. |
| Hold-create internal error logging sanitization | DONE | Yes | Yes | Yes | No | Partial | Tori | Safe logging proof exists. |
| Sentry redaction scrubber | DONE | Yes | Yes | Unknown | Partial | Partial | Tori | Config implemented; review event payload safety before broad production logging. |
| Supabase policy SQL tests | TODO | No | No | No | No | No | Tori | Still missing. |
| Live Supabase bucket policy verification | TODO | Partial | No | No | No | No | Tori | Required before public rollout. |
| No-bare-error logging CI guard | TODO | No | No | No | No | No | Tori | Add tools/check-no-bare-error-log.mjs. |
| UploadSession binding | TODO | No | No | No | No | No | Tori | Required before public launch if uploads are in scope. |
| Orphan media cleanup | TODO | No | No | No | No | No | Tori | Still missing. |
| Media scan/moderation decision | TODO | No | No | No | No | No | Tori | Decide or explicitly defer. |
| Client consent gate for publishing session media | PASS LOCALLY | Yes | Yes | Unknown | No | Partial | Tori | Pro can only make media public if it is public-bucket or review-promoted (reviewId set). Enforced in pro media portfolio + [id] PATCH routes and Looks publication. lib/media/publicShareGuard.ts; change-2026-06-13-media-consent-gate.md. Prod check: 0 rows previously mis-published. |

---

# Health endpoints, runbooks, and deployed readiness

## Goal

Make the app observable, diagnosable, and operable during production incidents.

## Health endpoints

| Item | Status | Implemented | Tested locally | Tested in CI | Verified deployed | Operationalized | Owner | Notes |
|---|---|---:|---:|---:|---:|---:|---|---|
| /api/health/live endpoint | DONE | Yes | Yes | Unknown | No | Partial | Tori | Endpoint/tests exist. |
| /api/health/ready endpoint | DONE | Yes | Yes | Unknown | No | Partial | Tori | Endpoint/tests exist. |
| /api/health readiness alias | DONE | Yes | Yes | Unknown | No | Partial | Tori | Compatibility alias exists. |
| Shared health response types | DONE | Yes | Yes | Unknown | No | Partial | Tori | Types exist. |
| Health summary/status-code logic | DONE | Yes | Yes | Unknown | No | Partial | Tori | Tests exist. |
| Postgres readiness probe | DONE | Yes | Yes | Unknown | No | Partial | Tori | Probe exists. |
| Redis readiness probe | DONE | Yes | Yes | Unknown | No | Partial | Tori | Probe exists. |
| Supabase Storage readiness probe | DONE | Yes | Yes | Unknown | No | Partial | Tori | Probe exists. |
| Stripe readiness/config probe | DONE | Yes | Yes | Unknown | No | Partial | Tori | Probe exists. |
| Postmark readiness/config probe | DONE | Yes | Yes | Unknown | No | Partial | Tori | Probe exists. |
| Twilio readiness/config probe | DONE | Yes | Yes | Unknown | No | Partial | Tori | Probe exists. |
| Health check orchestrator | DONE | Yes | Yes | Unknown | No | Partial | Tori | Orchestrator exists. |
| Health tests | DONE | Yes | Yes | Unknown | No | Partial | Tori | Unit/route tests exist. |
| Deployed health check proof | PASS DEPLOYED / DASHBOARD LINK TODO | Yes | Partial | Unknown | Yes | Partial | Tori | `/api/health/live`, `/api/health`, and `/api/health/ready` passed on `https://www.tovis.app`; dashboard/synthetic monitor link and provider-dashboard proof still TODO. |
| Provider live checks enabled in deployed env | TODO | Unknown | No | No | No | No | Tori | Verify HEALTH_CHECK_PROVIDERS_LIVE=true where intended. |
| Replica lag readiness check | TODO | No | No | No | No | No | Tori | Read-replica support exists; lag check not verified. |

## Runbooks

| Item | Status | Implemented | Tested locally | Tested in CI | Verified deployed | Operationalized | Owner | Notes |
|---|---|---:|---:|---:|---:|---:|---|---|
| Runbook directory and README | DONE | Yes | N/A | N/A | N/A | Partial | Tori | Docs exist. |
| Dependency outage/degradation runbooks | DONE | Yes | N/A | N/A | N/A | Partial | Tori | Postgres, Redis, Storage, Stripe, Postmark, Twilio docs exist. |
| Notification backlog runbook | DONE | Yes | N/A | N/A | N/A | Partial | Tori | Runbook exists. |
| Private media incident runbook | DONE | Yes | N/A | N/A | N/A | Partial | Tori | Runbook exists. |
| Privacy request runbook | DONE | Yes | N/A | N/A | N/A | Partial | Tori | Runbook exists. |
| Runbooks linked from alerts | IN PROGRESS / RUNBOOK LINK IN MESSAGE TODO | Yes | N/A | N/A | Partial | Partial | Tori | Runbooks are linked in launch alert docs; saved Sentry issue-alert delivery and production-safe app-generated synthetic alert routing work; real Slack alert messages still need runbook-link verification. |

---

# Database and performance review

## Goal

Prove hot data paths are indexed and booking overlap is impossible.

| Item | Status | Implemented | Tested locally | Tested in CI | Verified deployed | Operationalized | Owner | Notes |
|---|---|---:|---:|---:|---:|---:|---|---|
| Decide DB no-overlap constraint strategy | DONE | Yes | Yes | Unknown | No | Partial | Tori | Strategy decided and tested locally. |
| Test overlapping appointment ranges | DONE | Yes | Yes | Unknown | No | Partial | Tori | Integration coverage exists. |
| Booking concurrency integration test | DONE | Yes | Yes | Unknown | No | Partial | Tori | Overlap/concurrency proof exists. |
| Local launch load performance smoke | PASS LOCALLY | Yes | Yes | Unknown | No | Partial | Tori | Smoke load generated p50/p95/p99 summaries. |
| Review hot query indexes | IN PROGRESS | Partial | Partial | No | No | No | Tori | More EXPLAIN work needed. |
| Review notification inbox indexes | TODO | No | No | No | No | No | Tori | Missing. |
| Review booking dashboard query plans | TODO | No | No | No | No | No | Tori | Missing. |
| Review availability query plans | TODO | No | No | No | No | No | Tori | Missing. |
| Add EXPLAIN ANALYZE notes for hot paths | TODO | No | No | No | No | No | Tori | Missing. |
| Verify read-replica production config | TODO | Unknown | No | No | No | No | Tori | Code supports DATABASE_URL_READ; env must be verified. |

## Hot paths

- /api/availability/bootstrap
- /api/availability/day
- /api/holds
- /api/bookings/finalize
- /api/pro/bookings
- /api/pro/bookings/[id]
- /api/pro/bookings/[id]/media
- /api/pro/bookings/[id]/aftercare
- /api/webhooks/stripe
- Notification processor

---

# Rollout and feature flags

## Goal

Launch gradually and safely.

| Item | Status | Implemented | Tested locally | Tested in CI | Verified deployed | Operationalized | Owner | Notes |
|---|---|---:|---:|---:|---:|---:|---|---|
| Runtime flags documented | TODO | No | No | No | No | No | Tori | Missing. |
| Percentage rollout strategy | TODO | No | No | No | No | No | Tori | Missing. |
| Segment/geography rollout strategy | TODO | No | No | No | No | No | Tori | Missing. |
| Private dogfood checklist | TODO | No | No | No | No | No | Tori | Missing. |
| Private beta checklist | IN PROGRESS | Yes | N/A | N/A | N/A | Partial | Tori | docs/launch-readiness/private-beta-checklist.md. |
| Staged public rollout checklist | IN PROGRESS | Yes | N/A | N/A | N/A | Partial | Tori | docs/launch-readiness/public-rollout-checklist.md. |
| Rollback plan | IN PROGRESS | Partial | N/A | N/A | No | Partial | Tori | Rollback criteria in docs; drill/proof missing. |
| Support launch script | TODO | No | No | No | No | No | Tori | Missing. |
| Risk register | IN PROGRESS | Yes | N/A | N/A | N/A | Partial | Tori | docs/launch-readiness/risk-register.md. |
| Go/no-go review doc | IN PROGRESS | Yes | N/A | N/A | N/A | Partial | Tori | docs/launch-readiness/go-no-go.md. |

## Launch stages

1. Internal dogfood.
2. Small trusted private beta.
3. Expanded private beta.
4. Limited public rollout.
5. Broader public launch.

---

# White-label SaaS readiness

## Goal

Make TOVIS tenant-aware, partner-brandable, and enterprise-handoff ready.

White-label SaaS readiness is not required for the first private beta unless explicitly scoped into that launch.

| Item | Status | Implemented | Tested locally | Tested in CI | Verified deployed | Operationalized | Owner | Notes |
|---|---|---:|---:|---:|---:|---:|---|---|
| Tenant model decision doc | DONE | Yes | N/A | N/A | N/A | Partial | Tori | docs/architecture/tenant-model.md exists. |
| Tenant model | DONE | Yes | Yes | Unknown | No | Partial | Tori | `Tenant` model and expand-phase migration exist in Prisma schema/migrations. |
| tovis-root tenant seed | DONE | Yes | Yes | Unknown | No | Partial | Tori | Seed and backfill script create/use reserved `tovis-root`; launch-env backfill proof still needed if white-label is scoped. |
| homeTenantId columns | DONE | Yes | Yes | Unknown | No | Partial | Tori | Expand-phase columns exist for Pro/Client tenant ownership. |
| Booking tenant attribution columns | PARTIAL | Partial | Partial | Unknown | No | No | Tori | Prisma columns exist; current worktree has untracked booking attribution helpers/tests that must be committed or resolved before final proof. |
| Tenant resolver | DONE / REQUEST CONTEXT PARTIAL | Partial | Partial | Unknown | No | Partial | Tori | `lib/tenant/resolveTenant.ts` is tracked; request-context helper/tests are currently untracked and must be resolved before final proof. |
| Tenant visibility helper | DONE | Yes | Yes | Unknown | No | Partial | Tori | `lib/tenant/visibility.ts` and tests exist. |
| Tenant-aware discovery guard | DONE | Yes | Yes | Unknown | No | Partial | Tori | `tools/check-tenant-aware-discovery.mjs` exists and is wired into `check:static-guards`. |
| NFC tenant inheritance | PARTIAL | Partial | Partial | Unknown | No | No | Tori | `NfcCard.tenantId` exists; launch-env backfill/deployed proof still needed if NFC tenant behavior is in scope. |
| Tenant-specific brand resolution | TODO / PARTIAL | Partial | No | No | No | No | Tori | Brand seam exists; tenant-specific runtime productization remains incomplete. |
| Tenant-specific Postmark/Twilio identity | TODO | No | No | No | No | No | Tori | Required for white-label comms. |
| Tenant-specific Stripe/revenue attribution | TODO | No | No | No | No | No | Tori | Required for white-label monetization. |
| Partner admin/support roles | TODO | No | No | No | No | No | Tori | Required for enterprise handoff. |

---

# Proof suite and evidence

## Goal

Record proof against specific commits and environments.

| Item | Status | Implemented | Tested locally | Tested in CI | Verified deployed | Operationalized | Owner | Notes |
|---|---|---:|---:|---:|---:|---:|---|---|
| docs/launch-readiness/test-proof.md | DONE | Yes | Yes | Partial | No | Partial | Tori | Existing proof doc records prior launch proof runs. |
| Record commit SHA/date/env/command/result | IN PROGRESS | Yes | Yes | Partial | Partial | Partial | Tori | Continue adding entries as proof lands. |
| Phase 1 privacy proof | DONE | Yes | Yes | Unknown | Partial | Partial | Tori | docs/privacy/phase-1-privacy-proof.md. |
| Full lifecycle proof | TODO / PARTIAL | Partial | Partial | No | No | No | Tori | Tests exist but proof entry still needed. |
| Load proof | PASS LOCALLY | Yes | Yes | Unknown | No | Partial | Tori | Local launch load suite passed; staging proof still required. |
| Chaos proof | PASS LOCALLY | Yes | Yes | Unknown | No | Partial | Tori | Local chaos suite passed; evidence is recorded in `docs/launch-readiness/test-proof.md` and `docs/launch-readiness/chaos-test-plan.md`. |
| Deployed Sentry intake proof | PASS DEPLOYED | Yes | N/A | Unknown | Yes | Partial | Tori | Event ID e56044a034cb4fb78d1b09801fb43da5. |
| Deployed health/readiness proof | PASS DEPLOYED / DASHBOARD LINK TODO | Yes | Partial | Unknown | Yes | Partial | Tori | Production health/readiness endpoints passed; dashboard/synthetic monitor link still TODO. |
| Deployed storage policy proof | TODO | Partial | No | No | No | No | Tori | Repo proof exists; deployed proof missing. |
| Dashboard proof | TODO LIVE PROOF | Partial | N/A | N/A | No | No | Tori | Needs live Sentry/provider dashboard links. |
| Alert proof | PASS / FOLLOW-UPS TODO | Partial | N/A | No | Yes | Partial | Tori | Production-safe app-generated synthetic alert routed to `#tovis-ops-alerts`; event ID `f7a0d19cb4a040a3a21f4679086f166f`; Slack short ID `TOVIS-APP-K`. Runbook-link-in-message, formal acknowledgement timing, live alert-rule proof, and route-specific routing proof still TODO. |

---

# Final launch gate

Do not launch publicly until every required public rollout item below is true.

| Gate | Status | Notes |
|---|---|---|
| Phase 1 privacy verification passes on launch commit | TODO | Passed previously; rerun on final launch commit. |
| Core booking/session flow has E2E/staging proof | IN PROGRESS | API-assisted proof exists; staging/browser proof still needed. |
| Health live/ready endpoints are deployed and verified | PASS DEPLOYED / DASHBOARD LINK TODO | Production endpoints passed; dashboard/synthetic monitor proof still missing. |
| Production monitors watch live and ready endpoints | TODO | Not wired/proven. |
| Runbooks exist and are linked from alerts | IN PROGRESS / RUNBOOK LINK IN MESSAGE TODO | Runbooks exist and are linked; saved Sentry issue-alert delivery and production-safe app-generated synthetic alert routing work; real Slack alert messages still need runbook-link verification. |
| Sentry intake works | PASS DEPLOYED | Synthetic event captured: e56044a034cb4fb78d1b09801fb43da5. |
| Sentry dashboard exists with critical panels | TODO LIVE PROOF | Dashboard proof doc exists; live proof missing. |
| Slack/private-beta alerts are routed and tested | PASS / FOLLOW-UPS TODO | Production-safe app-generated synthetic alert routed to `#tovis-ops-alerts`; event ID `f7a0d19cb4a040a3a21f4679086f166f`; Slack short ID `TOVIS-APP-K`. Starter thresholds are documented; runbook-link-in-message, formal acknowledgement timing, live alert-rule/routing proof, and public P1 escalation still TODO. |
| P1 public escalation path is tested | BLOCKED | Requires backup owner and escalation path. |
| Storage/private-media policies are deployed and verified | TODO | Repo proof exists; deployed proof missing. |
| High-risk route rate limits are enforced in code | DONE | Code coverage exists; deployed telemetry still needed. |
| Auth/SMS routes fail safely under abuse/backing-service failure | DONE / PASS LOCALLY | Local proof exists; deployed telemetry still needed. |
| Pro readiness/onboarding gates are enforced in code | DONE | Code coverage exists; deployed proof still needed. |
| Realtime or polling strategy is implemented | TODO | Missing. |
| Payment/Stripe webhook replay is proven idempotent | PASS LOCALLY | Code/test/load/chaos proof exists; deployed/provider proof still needed. |
| Full retry/idempotency suite passes | TODO / PARTIAL | Partial route coverage only. |
| Load tests pass target thresholds | PASS LOCALLY | Launch suite passed locally; staging/public-rollout proof still required. |
| Chaos tests pass for Redis/provider outages | PASS LOCALLY | Chaos suite passed locally; rerun on rollout commit and record evidence. |
| Privacy/compliance docs exist | DONE | Phase 1 proof exists; deferred areas tracked. |
| Launch-env privacy backfill reruns are recorded if applicable | TODO | Required if target env has relevant rows. |
| Tenant data isolation is implemented if white-label launch is in scope | TODO | Missing; not required for first non-white-label beta. |
| Rollout and rollback plans exist | IN PROGRESS | Docs scaffold exists; drills/proof missing. |
| Support has launch scripts and escalation paths | TODO | Missing. |
| Backup owner exists | BLOCKED | Required before public rollout. |
| Go/no-go review is complete | TODO | Gate doc exists; final decision missing. |

---

# Current Phase 2 summary

## Completed repo-side work

- Launch readiness docs exist and are being reconciled with current proof.
- Sentry release/environment/dist config exists across server, edge, and client.
- Sentry console/log capture is disabled by default and opt-in by env.
- Sentry event scrubber/redaction path exists.
- test:load:launch exists.
- test:chaos exists.
- verify:launch-ops exists.
- Aggregate launch load runner exists.
- Launch-critical load scripts exist.
- Chaos tests exist for Redis, Supabase Storage, Stripe webhook storm, Postmark, Twilio, and DB degradation.
- Local Phase 2 verification passed.
- Deployed Sentry synthetic event route works.

## Current known proof

| Proof | Result |
|---|---|
| pnpm test:chaos | PASS LOCALLY: 6 files / 17 tests |
| pnpm test:load:launch | PASS LOCALLY: 8/8 steps |
| pnpm verify:launch-ops | PASS LOCALLY |
| Sentry synthetic event | PASS DEPLOYED: intake event `e56044a034cb4fb78d1b09801fb43da5`; app-generated Slack-routed event `f7a0d19cb4a040a3a21f4679086f166f` |
| Deployed health/readiness | PASS DEPLOYED / DASHBOARD LINK TODO |

## What this does not claim

- It does not claim private beta is ready.
- It does not claim public rollout is ready.
- It does not claim live dashboards are complete.
- It does not claim route-specific launch-critical Slack alerts are fully proven; saved Sentry issue-alert delivery and one production-safe app-generated synthetic alert route to Slack are proven.
- It does not claim P1 escalation is tested.
- It does not claim provider quotas/capacity are verified.
- It does not claim a backup owner exists.
- It does not claim staging/provider proof is complete.
- It does not claim rollback has been drilled.

## Next priorities

1. Keep local Phase 2 proof current in docs/launch-readiness/test-proof.md.
2. Update go-no-go.md with:
   - local verify:launch-ops PASS,
   - deployed Sentry event ID,
   - remaining NO-GO blockers.
3. Update sentry-dashboard.md with Sentry intake proof and keep dashboard sections TODO LIVE PROOF.
4. Add runbook-link-in-message and formal acknowledgement timing for the production-safe app-generated synthetic alert, or explicitly accept those as private-beta follow-ups in go-no-go.md.
5. Build/link live Sentry dashboard sections for launch-critical flows.
6. Name a backup owner before public rollout.
7. Link health/readiness dashboard or synthetic monitor proof.
8. Link provider dashboards or provider status pages.
9. Verify Supabase storage policies in deployed environment.
10. Define SLO thresholds from current smoke/baseline load results.
11. Rerun pnpm typecheck, pnpm test, pnpm verify:privacy-phase1, and pnpm verify:launch-ops on the final beta/rollout commit.
12. Record all evidence in go-no-go.md, test-proof.md, sentry-dashboard.md, phase-2-remaining-work.md, and the relevant checklist.

## Then run before final private beta decision

```bash
git status --short
git rev-parse HEAD
pnpm typecheck
pnpm test
pnpm verify:privacy-phase1
pnpm verify:launch-ops
```

If any command requires launch-only env values, record the exact command, environment, commit, and output in the relevant proof document.

---

# Maintenance rule

Do not mark an item DONE because the file exists. Do not mark operational proof complete because a local test passed.

A launch-readiness item is complete only when the required scope is satisfied:

- Code items need committed implementation and passing tests.
- Local proof items need command output and commit.
- Deployed proof items need staging/production evidence.
- Dashboard items need live links and useful signals.
- Alert items need thresholds, routing, runbooks, owners, verification, and acknowledgement evidence.
- Public rollout items need backup owner, tested escalation, rollout/rollback proof, and signoff.

Production-safe app-generated synthetic alert routing to Slack is proven, but route-specific P1/P2 alert thresholds, runbook-link-in-message, formal acknowledgement timing, dashboard proof, and public escalation remain open.

Local Phase 2 proof is a major milestone. Public rollout is still blocked until operational proof is real, linked, and boring. Boring is the goal. Dramatic launches are for fireworks, not booking software.
