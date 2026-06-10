# Launch Risk Register

## Status

Phase: Phase 2 — Launch ops proof  
Scope: Private beta and public rollout readiness  
Current default risk posture: Private beta NO-GO until live dashboard, alert routing, rollback, and launch-critical staging evidence are linked  
Primary owner: Tori  
Backup owner: NONE — solo operator; accepted private-beta risk (2026-06-09, RISK-001); public rollout blocker  
Last reviewed: 2026-06-09

This file tracks known launch risks, owners, mitigations, and launch decisions. A risk can be accepted only when it is understood, owned, and tied to a launch-stage decision.

## Current Phase 2 proof baseline

| Item | Current state |
|---|---|
| Latest audited Phase 2 code commit | `ae30aff20aff8b205e65f57bf3ae8b5b8b553b29` |
| Local proof-recording commit | `5dc37c1` — `Record Phase 2 launch ops local proof` |
| Load-plan update commit | `f41b203` — `Update load test plan with current Phase 2 proof` |
| Date reviewed | 2026-06-07 |
| Local chaos proof | PASS LOCALLY — `pnpm test:chaos`: 6 files / 17 tests passed |
| Local load proof | PASS LOCALLY — `pnpm verify:launch-ops`: 8/8 launch load steps passed |
| Signup strict success proof | PASS LOCALLY — 30/30 successful client signups, 0 rate limits, 0 real failures |
| Privacy proof | PASS — `pnpm verify:privacy-phase1` passed |
| Remaining private-beta blockers | Live dashboard proof, alert routing proof, rollback path, risk acceptance/signoff |
| Remaining public-rollout blockers | Deployed staging proof, provider capacity proof, backup owner, tested P1 escalation, dashboard/alert proof, final signoff |

## Risk decision values

| Decision | Meaning |
|---|---|
| OPEN | Risk is known but not yet mitigated or accepted. |
| MITIGATED | Mitigation exists and evidence is linked. |
| ACCEPTED FOR PRIVATE BETA | Risk is allowed only for controlled private beta. |
| ACCEPTED FOR PUBLIC ROLLOUT | Risk is allowed for public rollout. Use sparingly. |
| BLOCKS PRIVATE BETA | Private beta cannot start until resolved. |
| BLOCKS PUBLIC ROLLOUT | Public rollout cannot start until resolved. |
| DEFERRED | Explicitly outside current launch scope, with owner and follow-up. |

## Severity values

| Severity | Meaning |
|---|---|
| Critical | Privacy, payment correctness, data integrity, or broad outage risk. |
| High | Blocks launch readiness or could cause serious user/provider impact. |
| Medium | Manageable during private beta with owner and mitigation. |
| Low | Known issue with limited blast radius. |

## Risk acceptance rules

A risk cannot be accepted unless it has:

- Owner
- Severity
- Launch-stage decision
- Mitigation
- Verification or follow-up
- Review date

The following risks cannot be casually accepted:

- Known PII leak or privacy-boundary failure
- Known private media access leak
- Known payment double-charge or webhook dedupe failure
- Known export/delete authorization failure
- Known booking finalize data-integrity failure
- No rollback path for public rollout
- No owner for P1/P2 incidents

## Summary

| Severity | Open | Mitigated | Accepted private beta | Blocks private beta | Blocks public rollout |
|---|---:|---:|---:|---:|---:|
| Critical | 2 | 0 | 0 | 1 | 2 |
| High | 5 | 2 | 1 | 2 | 6 |
| Medium | 5 | 1 | 4 | 1 | 3 |
| Low | 0 | 0 | 0 | 0 | 0 |

This table is a reviewed snapshot, not an automatically generated source of truth. The individual risk entries are canonical.

---

# Active risks

## RISK-001 — Missing named backup owner

| Field | Value |
|---|---|
| Severity | High |
| Owner | Tori |
| Backup | NONE — Tori is the sole project owner; no second person exists to name. |
| Decision | ACCEPTED FOR PRIVATE BETA (2026-06-09); BLOCKS PUBLIC ROLLOUT |
| Private beta impact | Accepted for small controlled beta on 2026-06-09; acceptance recorded in go-no-go.md. |
| Public rollout impact | Blocks public rollout. |
| Mitigation | Solo-operator beta constraints: small cohort, explicit support hours, documented rollback procedure. Recruit or contract a named backup owner before public launch. |
| Verification | Update docs/launch-readiness/oncall.md with backup owner and escalation path when one exists. |
| Related docs | docs/launch-readiness/oncall.md, docs/launch-readiness/go-no-go.md |
| Last reviewed | 2026-06-09 |

### Notes

Tori is the only owner of the project; there is currently no second person who could serve as backup. The single-owner risk is explicitly accepted for private beta as of 2026-06-09 (recorded in go-no-go.md), conditional on a small cohort and explicit support hours. Public rollout remains blocked until a named backup owner exists.

---

## RISK-002 — Slack-first alerting is not enough for public launch

| Field | Value |
|---|---|
| Severity | High |
| Owner | Tori |
| Backup | TODO |
| Decision | BLOCKS PUBLIC ROLLOUT |
| Private beta impact | Acceptable only if Slack alerting is tested and actively watched during beta support hours. |
| Public rollout impact | Blocks public rollout unless P1 escalation is tested. |
| Mitigation | Add PagerDuty/Opsgenie or equivalent tested escalation path before public launch, or explicitly waive with rationale. |
| Verification | Synthetic P1 alert routes and is acknowledged through chosen escalation path. |
| Related docs | docs/launch-readiness/oncall.md, docs/launch-readiness/slack-alerts.md, docs/launch-readiness/go-no-go.md |
| Last reviewed | 2026-06-07 |

### Notes

Slack-first is acceptable for private beta only. Public launch needs a stronger escalation path or explicit signed acceptance.

---

## RISK-003 — Launch dashboard not yet proven with live staging data

| Field | Value |
|---|---|
| Severity | High |
| Owner | Tori |
| Backup | TODO |
| Decision | BLOCKS PRIVATE BETA |
| Private beta impact | Beta should not start blind. |
| Public rollout impact | Blocks public rollout. |
| Mitigation | Build and verify Sentry-first dashboard sections for health, booking, pro lifecycle, media, payments, notifications, jobs, auth/rate limits, dependencies, and SLO/error budget. |
| Verification | Link dashboard evidence in docs/launch-readiness/sentry-dashboard.md. |
| Related docs | docs/launch-readiness/sentry-dashboard.md, docs/launch-readiness/checklist.md |
| Last reviewed | 2026-06-07 |

### Notes

Private beta does not need perfect observability, but it does need enough visibility to detect launch-critical failures.

---

## RISK-004 — P1/P2 alerts not yet mapped and tested

| Field | Value |
|---|---|
| Severity | High |
| Owner | Tori |
| Backup | TODO |
| Decision | BLOCKS PRIVATE BETA ALERT PROOF |
| Private beta impact | Beta should not begin without alert routing for critical failures. |
| Public rollout impact | Blocks public rollout. |
| Mitigation | Alert map exists in docs/launch-readiness/slack-alerts.md. Finish thresholds/runbooks, then upgrade Sentry or choose an alternate alert path so a synthetic staging alert can be tested. |
| Verification | Trigger at least one synthetic staging alert and record result after the Sentry plan or alternate alert path is available. |
| Related docs | docs/launch-readiness/oncall.md, docs/launch-readiness/slack-alerts.md, docs/launch-readiness/go-no-go.md |
| Last reviewed | 2026-06-07 |

### Notes

Every alert must have owner, backup status, threshold, runbook, and destination. No mystery alarms. Mystery alarms are just panic with a timestamp.

---

## RISK-005 — Deployed staging load proof missing for launch-critical flows

| Field | Value |
|---|---|
| Severity | High |
| Owner | Tori |
| Backup | TODO |
| Decision | BLOCKS PUBLIC ROLLOUT |
| Private beta impact | Local smoke proof exists; private beta can proceed only if dashboard/alert/rollback gaps are resolved or accepted. |
| Public rollout impact | Blocks public rollout until deployed staging proof is recorded. |
| Mitigation | Launch-critical load scripts exist and passed locally through `pnpm verify:launch-ops`. Run the same suite against deployed staging with safe seeded data and dashboard evidence. |
| Verification | Local proof recorded in `docs/launch-readiness/test-proof.md`; deployed staging proof still TODO. |
| Related docs | docs/launch-readiness/test-proof.md, docs/launch-readiness/load-test-plan.md, docs/launch-readiness/go-no-go.md, docs/launch-readiness/public-rollout-checklist.md |
| Last reviewed | 2026-06-07 |

### Notes

Signup alone is no longer the only coverage. Availability bootstrap, hold create, booking finalize, media metadata, checkout, Stripe webhook replay, notification processing, and signup all passed locally through the launch suite. The remaining gap is deployed staging proof with dashboards and cleanup evidence.

---

## RISK-006 — Deployed operational chaos proof and DB replica-lag scope unresolved

| Field | Value |
|---|---|
| Severity | High |
| Owner | Tori |
| Backup | TODO |
| Decision | BLOCKS PUBLIC ROLLOUT |
| Private beta impact | Local deterministic chaos proof exists; private beta can proceed only if runbooks/alerts/rollback gaps are resolved or accepted. |
| Public rollout impact | Blocks public rollout until operational alert/runbook proof is linked and DB replica-lag scope is resolved. |
| Mitigation | Deterministic chaos tests exist and pass locally for Redis outage, Supabase Storage outage, Stripe webhook storm, Postmark degradation, Twilio degradation, and DB degradation. Resolve whether explicit DB replica-lag/stale-read proof is applicable for launch. |
| Verification | `pnpm test:chaos` passed locally: 6 files / 17 tests. Evidence recorded in `docs/launch-readiness/test-proof.md` and `docs/launch-readiness/chaos-test-plan.md`. |
| Related docs | docs/launch-readiness/test-proof.md, docs/launch-readiness/chaos-test-plan.md, docs/launch-readiness/go-no-go.md, docs/launch-readiness/public-rollout-checklist.md |
| Last reviewed | 2026-06-07 |

### Notes

The previous Redis chaos blocker is fixed and local chaos proof is green. The remaining chaos gap is operational proof: alerts, runbooks, dashboards, and DB replica-lag/stale-read scope if read replicas are used for launch.

---

## RISK-007 — Provider runbooks must be linked from alerts

| Field | Value |
|---|---|
| Severity | Medium |
| Owner | Tori |
| Backup | TODO |
| Decision | BLOCKS PUBLIC ROLLOUT |
| Private beta impact | Acceptable only if the relevant runbooks exist and the owner knows where they are. |
| Public rollout impact | Blocks public rollout if P1/P2 alerts lack runbooks. |
| Mitigation | Link every critical alert to an existing or newly created runbook. |
| Verification | docs/launch-readiness/slack-alerts.md has no P1/P2 alert without a runbook. |
| Related docs | docs/launch-readiness/slack-alerts.md, docs/launch-readiness/oncall.md |
| Last reviewed | 2026-06-07 |

### Notes

Known runbook areas include health/readiness, Redis, Postgres, Supabase Storage, Stripe, Postmark, Twilio, private media, notifications, booking funnel, auth/session, pro session lifecycle, SLO/error budget, and privacy requests.

---

## RISK-008 — Sentry intake proven; dashboard coverage still incomplete

| Field | Value |
|---|---|
| Severity | Medium |
| Owner | Tori |
| Backup | TODO |
| Decision | MITIGATED FOR INTAKE / DASHBOARD PROOF STILL OPEN |
| Private beta impact | Sentry intake is proven, but beta still needs usable dashboard sections or an accepted observability gap. |
| Public rollout impact | Blocks public rollout until dashboard coverage is complete. |
| Mitigation | Sentry release/environment config is implemented. Deployed synthetic Sentry event was captured. Build and verify the 10 required dashboard sections. |
| Verification | Synthetic event captured: `e56044a034cb4fb78d1b09801fb43da5`; dashboard links still TODO in `docs/launch-readiness/sentry-dashboard.md`. |
| Related docs | docs/launch-readiness/sentry-dashboard.md, docs/launch-readiness/test-proof.md, docs/launch-readiness/private-beta-checklist.md |
| Last reviewed | 2026-06-07 |

### Notes

This risk is no longer “Sentry intake unknown.” Intake works. The remaining risk is whether humans have the live dashboards needed to detect and triage launch failures.

---

## RISK-009 — Console/log capture policy needs deployed confirmation

| Field | Value |
|---|---|
| Severity | Medium |
| Owner | Tori |
| Backup | TODO |
| Decision | BLOCKS PRIVATE BETA UNTIL REVIEWED |
| Private beta impact | Logs can accidentally retain sensitive values if capture policy is unclear or enabled without review. |
| Public rollout impact | Blocks public rollout. |
| Mitigation | Sentry console/log capture is disabled by default and only enabled through SENTRY_ENABLE_LOGS or NEXT_PUBLIC_SENTRY_ENABLE_LOGS. Server/edge Sentry events are scrubbed through lib/observability/sentryConfig.ts and redactAuditPayload(). |
| Verification | Confirm deployed env does not enable log capture unless explicitly reviewed, and record policy in docs/launch-readiness/sentry-dashboard.md. |
| Related docs | docs/privacy/phase-1-privacy-proof.md, docs/launch-readiness/sentry-dashboard.md |
| Last reviewed | 2026-06-07 |

### Notes

The default is now safer than before. Do not enable Sentry console/log capture in staging or production until the log safety policy is reviewed.

---

## RISK-010 — PII plaintext-read baseline remains at 471 entries

| Field | Value |
|---|---|
| Severity | Medium |
| Owner | Tori |
| Backup | TODO |
| Decision | ACCEPTED FOR PRIVATE BETA |
| Private beta impact | Accepted as Phase 1 baseline if no new entries are added. |
| Public rollout impact | Can be accepted if guard still passes and baseline is formally reviewed. |
| Mitigation | Keep tools/check-pii-plaintext-reads.mjs passing; burn down baseline when touching related code. |
| Verification | pnpm check:pii-plaintext-reads passes and reports known baseline count. |
| Related docs | docs/privacy/phase-1-privacy-proof.md, tools/baselines/pii-plaintext-reads.txt |
| Last reviewed | 2026-06-07 |

### Notes

This is accepted Phase 1 debt, not a reason to reopen Phase 1. New baseline growth should be treated as privacy debt requiring review.

---

## RISK-011 — Launch-environment HMAC v2 backfill rerun required if launch env has rows

| Field | Value |
|---|---|
| Severity | Medium |
| Owner | Tori |
| Backup | TODO |
| Decision | BLOCKS PUBLIC ROLLOUT IF APPLICABLE |
| Private beta impact | Low if launch/beta env has no relevant rows or rerun is documented. |
| Public rollout impact | Blocks public rollout if launch env has existing User or ClientProfile rows requiring backfill and proof is missing. |
| Mitigation | Re-run pnpm backfill:contact-hash-v2 against target launch env if applicable. |
| Verification | Record dry-run/write output with row counts and failures. |
| Related docs | docs/privacy/phase-1-remaining-work.md, docs/privacy/phase-1-privacy-proof.md |
| Last reviewed | TODO |

### Notes

The script exists. This risk is operational proof in the target environment, not missing implementation.

---

## RISK-012 — Launch-environment AEAD address backfill rerun required if launch env has rows

| Field | Value |
|---|---|
| Severity | Medium |
| Owner | Tori |
| Backup | TODO |
| Decision | BLOCKS PUBLIC ROLLOUT IF APPLICABLE |
| Private beta impact | Low if launch/beta env has no relevant address/snapshot rows or rerun is documented. |
| Public rollout impact | Blocks public rollout if launch env has existing address/snapshot rows requiring backfill and proof is missing. |
| Mitigation | Re-run pnpm backfill:address-encryption against target launch env if applicable. |
| Verification | Record dry-run/write output with row counts and failures. |
| Related docs | docs/privacy/phase-1-remaining-work.md, docs/privacy/phase-1-privacy-proof.md |
| Last reviewed | TODO |

### Notes

The AEAD implementation exists. This risk is launch-env proof and data migration hygiene.

---

## RISK-013 — Storage object byte deletion workflow deferred

| Field | Value |
|---|---|
| Severity | Medium |
| Owner | Tori |
| Backup | TODO |
| Decision | ACCEPTED FOR PRIVATE BETA |
| Private beta impact | Acceptable only if privacy request handling documents manual follow-up. |
| Public rollout impact | Needs explicit acceptance or implementation decision before public launch. |
| Mitigation | Track manual follow-up in privacy request runbook; implement storage byte deletion workflow later. |
| Verification | docs/runbooks/privacy-request.md documents limitation and manual process. |
| Related docs | docs/privacy/phase-1-remaining-work.md, docs/runbooks/privacy-request.md |
| Last reviewed | TODO |

### Notes

This is deferred Phase 1+ privacy operations work. It should remain visible.

---

## RISK-014 — Message deletion/retention implementation deferred

| Field | Value |
|---|---|
| Severity | Medium |
| Owner | Tori |
| Backup | TODO |
| Decision | ACCEPTED FOR PRIVATE BETA |
| Private beta impact | Acceptable only if retention limitations are documented and support process is clear. |
| Public rollout impact | Needs explicit acceptance or implementation decision before public launch. |
| Mitigation | Finalize retention policy and implement message deletion/anonymization workflow when policy is converted into code. |
| Verification | Retention policy and privacy request runbook describe current behavior. |
| Related docs | docs/privacy/retention-policy.md, docs/privacy/phase-1-remaining-work.md, docs/runbooks/privacy-request.md |
| Last reviewed | TODO |

### Notes

Do not hide this one. Messaging data always becomes support/legal glitter if ignored.

---

## RISK-015 — Booking-level anonymization beyond Phase 1 conservative boundary deferred

| Field | Value |
|---|---|
| Severity | Medium |
| Owner | Tori |
| Backup | TODO |
| Decision | ACCEPTED FOR PRIVATE BETA |
| Private beta impact | Acceptable if current export/delete behavior and limitations are documented. |
| Public rollout impact | Needs explicit acceptance or implementation decision before public launch. |
| Mitigation | Track deferred anonymization scope and avoid overpromising full deletion behavior. |
| Verification | Privacy proof, retention policy, and privacy runbook remain consistent. |
| Related docs | docs/privacy/phase-1-privacy-proof.md, docs/privacy/retention-policy.md, docs/runbooks/privacy-request.md |
| Last reviewed | TODO |

### Notes

This is not a Phase 1 blocker anymore, but it must not disappear.

---

## RISK-016 — Provider quota/capacity unknown

| Field | Value |
|---|---|
| Severity | High |
| Owner | Tori |
| Backup | TODO |
| Decision | BLOCKS PUBLIC ROLLOUT |
| Private beta impact | Acceptable only if beta cohort is capped below known provider limits. |
| Public rollout impact | Blocks public rollout. |
| Mitigation | Confirm limits/quotas for Vercel, database, Redis, Supabase Storage, Stripe, Postmark, Twilio, and Sentry. |
| Verification | Record provider quota/capacity notes in docs/launch-readiness/public-rollout-checklist.md. |
| Related docs | docs/launch-readiness/private-beta-checklist.md, docs/launch-readiness/public-rollout-checklist.md |
| Last reviewed | 2026-06-07 |

### Notes

A tiny beta can survive fuzzy quotas. Public launch cannot.

---

## RISK-017 — Rollback path not documented

| Field | Value |
|---|---|
| Severity | High |
| Owner | Tori |
| Backup | TODO |
| Decision | BLOCKS PRIVATE BETA |
| Private beta impact | Blocks beta until rollback owner/path is documented. |
| Public rollout impact | Blocks public rollout. |
| Mitigation | Document rollback owner, last known good commit, deploy rollback process, feature-disable strategy, payment/webhook rollback notes, and user communication path. |
| Verification | docs/launch-readiness/private-beta-checklist.md and docs/launch-readiness/public-rollout-checklist.md contain rollback criteria. |
| Related docs | docs/launch-readiness/private-beta-checklist.md, docs/launch-readiness/public-rollout-checklist.md |
| Last reviewed | 2026-06-07 |

### Notes

Rollback is not optional. “Hope deploy works” is not a rollback strategy; it is a motivational poster with worse consequences.

---

## RISK-018 — Booking finalize deployed staging correctness under load not proven

| Field | Value |
|---|---|
| Severity | Critical |
| Owner | Tori |
| Backup | TODO |
| Decision | BLOCKS PUBLIC ROLLOUT |
| Private beta impact | Local proof exists; beta still needs booking lifecycle smoke/staging monitoring or accepted risk. |
| Public rollout impact | Blocks public rollout until deployed staging proof is recorded. |
| Mitigation | Booking finalize load test exists and passed locally through `pnpm verify:launch-ops`. Run against deployed staging with stronger seeded slot capacity and dashboard evidence. |
| Verification | Local proof recorded in `docs/launch-readiness/test-proof.md`; deployed staging proof still TODO. |
| Related docs | docs/launch-readiness/test-proof.md, docs/launch-readiness/load-test-plan.md, docs/launch-readiness/go-no-go.md, docs/launch-readiness/public-rollout-checklist.md |
| Last reviewed | 2026-06-07 |

### Notes

Booking finalize is locally covered now, including expected conflict behavior from slot reuse. Public rollout still needs deployed staging proof with safe seeded capacity and no data-integrity failures.

---

## RISK-019 — Stripe webhook replay/idempotency deployed staging proof missing

| Field | Value |
|---|---|
| Severity | Critical |
| Owner | Tori |
| Backup | TODO |
| Decision | BLOCKS PUBLIC ROLLOUT |
| Private beta impact | Local webhook replay load and chaos proof exist; beta still needs Stripe/webhook monitoring or accepted risk. |
| Public rollout impact | Blocks public rollout until deployed staging/provider dashboard proof is recorded. |
| Mitigation | Stripe webhook replay load test and webhook storm chaos test exist and passed locally. Run against deployed staging/test-mode configuration and link Stripe/Sentry dashboard evidence. |
| Verification | Local proof recorded in `docs/launch-readiness/test-proof.md`; deployed staging/provider proof still TODO. |
| Related docs | docs/launch-readiness/test-proof.md, docs/launch-readiness/load-test-plan.md, docs/launch-readiness/chaos-test-plan.md, docs/launch-readiness/go-no-go.md, docs/launch-readiness/public-rollout-checklist.md, docs/runbooks/stripe-degradation.md |
| Last reviewed | 2026-06-07 |

### Notes

Local replay and storm behavior are covered. Public rollout still needs deployed staging/test-mode proof and provider dashboard visibility.

---

## RISK-020 — Private media access policy regression

| Field | Value |
|---|---|
| Severity | Critical |
| Owner | Tori |
| Backup | TODO |
| Decision | BLOCKS PRIVATE BETA IF UNPROVEN |
| Private beta impact | Blocks private beta if storage/private-media proof is missing. |
| Public rollout impact | Blocks public rollout. |
| Mitigation | Verify storage policies and private media access behavior in staging. |
| Verification | Storage/private-media proof linked from go-no-go.md. |
| Related docs | docs/runbooks/private-media-incident.md, docs/runbooks/supabase-storage-outage.md, docs/launch-readiness/go-no-go.md |
| Last reviewed | 2026-06-07 |

### Notes

Private media is privacy-sensitive. Do not beta-test a leak. That’s not a feature flag, that’s a lawsuit-shaped piñata.

---

## RISK-021 — Notification degradation operational proof incomplete

| Field | Value |
|---|---|
| Severity | Medium |
| Owner | Tori |
| Backup | TODO |
| Decision | BLOCKS PUBLIC ROLLOUT |
| Private beta impact | Local notification load and provider degradation chaos proof exist; manual follow-up and alert routing still need to be accepted or proven. |
| Public rollout impact | Blocks public rollout if retry/manual-follow-up behavior, provider alerts, and backlog visibility are not proven operationally. |
| Mitigation | Postmark/Twilio degradation chaos tests and notification processing load test exist and pass locally. Link alert routing, notification backlog dashboard, and provider runbooks before public rollout. |
| Verification | Local proof recorded in `docs/launch-readiness/test-proof.md`; alert/backlog/provider proof still TODO. |
| Related docs | docs/launch-readiness/test-proof.md, docs/launch-readiness/chaos-test-plan.md, docs/launch-readiness/load-test-plan.md, docs/runbooks/postmark-degradation.md, docs/runbooks/twilio-degradation.md, docs/runbooks/notification-backlog.md |
| Last reviewed | 2026-06-07 |

### Notes

The code-path proof is local green. The remaining launch risk is operational: can Tori see notification failures, know who is affected, and recover or manually follow up?

---

## RISK-022 — Auth/session/rate-limit operational alert proof incomplete

| Field | Value |
|---|---|
| Severity | High |
| Owner | Tori |
| Backup | TODO |
| Decision | BLOCKS PUBLIC ROLLOUT |
| Private beta impact | Local Redis/rate-limit chaos proof and signup load proof exist; private beta still needs alert routing or accepted alerting risk. |
| Public rollout impact | Blocks public rollout until auth/rate-limit alerts route to an approved destination and runbooks are linked. |
| Mitigation | Redis outage chaos test passes locally, and signup strict success/rate-limit behavior has been separated in the load script. Finish auth/session/rate-limit alert routing and runbook coverage. |
| Verification | Local proof recorded in `docs/launch-readiness/test-proof.md`; alert routing proof still TODO. |
| Related docs | docs/launch-readiness/test-proof.md, docs/launch-readiness/chaos-test-plan.md, docs/launch-readiness/load-test-plan.md, docs/runbooks/redis-outage.md, docs/runbooks/auth-session.md, docs/launch-readiness/slack-alerts.md |
| Last reviewed | 2026-06-07 |

### Notes

The previous Redis chaos failure is fixed. The remaining risk is not local test coverage; it is operational alerting and auth/session runbook completeness.

---

## RISK-023 — Public rollout checklist not yet complete/signed off

| Field | Value |
|---|---|
| Severity | High |
| Owner | Tori |
| Backup | TODO |
| Decision | BLOCKS PUBLIC ROLLOUT |
| Private beta impact | Does not block private beta if private-beta checklist is complete. |
| Public rollout impact | Blocks public rollout until checklist is complete and signed. |
| Mitigation | Public rollout checklist exists. Complete staged rollout, rollback criteria, provider quota confirmation, escalation proof, and final sign-off fields. |
| Verification | `docs/launch-readiness/public-rollout-checklist.md` exists and is completed with evidence. |
| Related docs | docs/launch-readiness/go-no-go.md, docs/launch-readiness/public-rollout-checklist.md |
| Last reviewed | 2026-06-07 |

### Notes

The file exists. The remaining risk is incomplete evidence/signoff, not missing scaffolding.

---

## RISK-024 — Paid Sentry plan required for Slack alert routing

| Field | Value |
|---|---|
| Severity | Medium |
| Owner | Tori |
| Backup | TODO |
| Decision | BLOCKS PRIVATE BETA ALERT PROOF |
| Private beta impact | Blocks Sentry-to-Slack alert verification until the required Sentry plan is available or an alternate alert path is chosen. |
| Public rollout impact | Blocks public rollout if no tested alert routing exists. |
| Mitigation | Upgrade Sentry or choose an alternate private-beta alert path before launch proof. |
| Verification | Sentry alert routes to #tovis-ops-alerts, or alternate alert path is documented and tested. |
| Related docs | docs/launch-readiness/oncall.md, docs/launch-readiness/slack-alerts.md, docs/launch-readiness/go-no-go.md |
| Last reviewed | 2026-06-07 |

### Notes

Sentry release/environment metadata can still be implemented now. Live Slack alert routing is deferred until the Sentry plan or alternate alerting path is available.

---

# Closed or mitigated risks

Move risks here only when full launch-stage evidence exists and no remaining blocker is attached.

---

# Review cadence

During private beta:

- Review this file daily.
- Add every P1/P2 incident as a risk or linked follow-up.
- Update launch decision impact after each incident.
- Do not delete risks just because they are annoying.
- Move mitigated risks to the closed section with evidence.

Before public rollout:

- Review every High and Critical risk.
- Confirm no unowned High or Critical risks remain.
- Confirm every accepted risk is listed in go-no-go.md.
- Confirm launch sign-off explicitly accepts remaining risks.

## Related documents

- docs/launch-readiness/oncall.md
- docs/launch-readiness/go-no-go.md
- docs/launch-readiness/private-beta-checklist.md
- docs/launch-readiness/public-rollout-checklist.md
- docs/launch-readiness/sentry-dashboard.md
- docs/launch-readiness/slack-alerts.md
- docs/launch-readiness/checklist.md
- docs/privacy/phase-1-privacy-proof.md
- docs/privacy/phase-1-remaining-work.md
- docs/privacy/retention-policy.md
- docs/runbooks/privacy-request.md
- docs/launch-readiness/load-test-plan.md
- docs/launch-readiness/chaos-test-plan.md
- docs/launch-readiness/test-proof.md
- docs/runbooks/redis-outage.md
- docs/runbooks/postgres-outage.md
- docs/runbooks/supabase-storage-outage.md
- docs/runbooks/stripe-degradation.md
- docs/runbooks/postmark-degradation.md
- docs/runbooks/twilio-degradation.md
- docs/runbooks/notification-backlog.md
- docs/runbooks/slo-error-budget.md
- docs/runbooks/pro-session-lifecycle.md
- docs/runbooks/auth-session.md
- docs/runbooks/booking-funnel.md

## Maintenance rule

A risk with no owner is not accepted. A risk with no mitigation is not accepted. A risk with no evidence is not closed.