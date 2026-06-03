# Launch Risk Register

## Status

Phase: Phase 2 — Launch ops proof  
Scope: Private beta and public rollout readiness  
Current default risk posture: Private beta NO-GO until high-severity launch risks have owners and mitigations  
Primary owner: Tori  
Backup owner: TODO — public rollout blocker  
Last reviewed: TODO

This file tracks known launch risks, owners, mitigations, and launch decisions. A risk can be accepted only when it is understood, owned, and tied to a launch-stage decision.

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
| Critical | TODO | TODO | TODO | TODO | TODO |
| High | TODO | TODO | TODO | TODO | TODO |
| Medium | TODO | TODO | TODO | TODO | TODO |
| Low | TODO | TODO | TODO | TODO | TODO |

Update this table manually when risks change.

---

# Active risks

## RISK-001 — Missing named backup owner

| Field | Value |
|---|---|
| Severity | High |
| Owner | Tori |
| Backup | TODO |
| Decision | BLOCKS PUBLIC ROLLOUT |
| Private beta impact | Can be accepted for small controlled beta if explicitly signed off. |
| Public rollout impact | Blocks public rollout. |
| Mitigation | Assign a named backup owner before public launch. |
| Verification | Update docs/launch-readiness/oncall.md with backup owner and escalation path. |
| Related docs | docs/launch-readiness/oncall.md, docs/launch-readiness/go-no-go.md |
| Last reviewed | TODO |

### Notes

Private beta may proceed with Tori as primary owner only if the cohort is small, support hours are explicit, and this risk is accepted in go-no-go.md.

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
| Last reviewed | TODO |

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
| Last reviewed | TODO |

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
| Last reviewed | TODO |

### Notes

Every alert must have owner, backup status, threshold, runbook, and destination. No mystery alarms. Mystery alarms are just panic with a timestamp.

---

## RISK-005 — Load tests missing for launch-critical flows

| Field | Value |
|---|---|
| Severity | High |
| Owner | Tori |
| Backup | TODO |
| Decision | BLOCKS PUBLIC ROLLOUT |
| Private beta impact | Can be accepted for small beta only if smoke tests and dashboard monitoring are green. |
| Public rollout impact | Blocks public rollout. |
| Mitigation | Add load tests for availability bootstrap, hold create, booking finalize, media metadata, checkout, Stripe webhook replay, and notification processing. |
| Verification | pnpm test:load:launch passes against staging with command output recorded. |
| Related docs | docs/launch-readiness/go-no-go.md, docs/launch-readiness/public-rollout-checklist.md |
| Last reviewed | TODO |

### Notes

Signup load testing alone is not enough. Booking/payment/media/notification hot paths need coverage before public rollout.

---

## RISK-006 — Chaos tests missing for dependency failure modes

| Field | Value |
|---|---|
| Severity | High |
| Owner | Tori |
| Backup | TODO |
| Decision | BLOCKS PUBLIC ROLLOUT |
| Private beta impact | Can be accepted for small beta only if runbooks and manual mitigation are ready. |
| Public rollout impact | Blocks public rollout. |
| Mitigation | Add deterministic chaos tests for Redis outage, Supabase Storage outage, Stripe webhook storm, Postmark degradation, Twilio degradation, and DB replica lag. |
| Verification | pnpm test:chaos passes and results are linked. |
| Related docs | docs/launch-readiness/go-no-go.md, docs/launch-readiness/public-rollout-checklist.md |
| Last reviewed | TODO |

### Notes

Prefer deterministic Vitest/provider-boundary tests for this phase. Do not break real staging providers just to cosplay Netflix Chaos Monkey. We are not made of incident budget.

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
| Last reviewed | TODO |

### Notes

Known runbook areas include health/readiness, Redis, Postgres, Supabase Storage, Stripe, Postmark, Twilio, private media, notifications, and privacy requests.

---

## RISK-008 — Sentry release/deployment tagging not deployed-verified

| Field | Value |
|---|---|
| Severity | Medium |
| Owner | Tori |
| Backup | TODO |
| Decision | BLOCKS PRIVATE BETA UNTIL DEPLOYED PROOF EXISTS |
| Private beta impact | Debugging beta regressions is much harder without release/environment tagging visible in real Sentry events. |
| Public rollout impact | Blocks public rollout. |
| Mitigation | Local Sentry release, dist, and environment config is implemented in server, edge, and client instrumentation. Deploy to staging and confirm Sentry events show the expected release/environment. |
| Verification | Sentry events show correct release/environment for staging deploy. |
| Related docs | docs/launch-readiness/sentry-dashboard.md, docs/launch-readiness/private-beta-checklist.md |
| Last reviewed | TODO |

### Notes

The code-level Sentry metadata work is implemented locally. This risk remains open until a staging Sentry event proves release/environment metadata is visible after deploy.

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
| Last reviewed | TODO |

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
| Last reviewed | TODO |

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
| Last reviewed | TODO |

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
| Last reviewed | TODO |

### Notes

Rollback is not optional. “Hope deploy works” is not a rollback strategy; it is a motivational poster with worse consequences.

---

## RISK-018 — Booking finalize correctness under load not proven

| Field | Value |
|---|---|
| Severity | Critical |
| Owner | Tori |
| Backup | TODO |
| Decision | BLOCKS PUBLIC ROLLOUT |
| Private beta impact | Acceptable only for capped beta if booking lifecycle smoke proof is green and support monitoring is active. |
| Public rollout impact | Blocks public rollout. |
| Mitigation | Add and run booking finalize load test; confirm no double-booking, stale hold, or lifecycle integrity failure. |
| Verification | pnpm test:load:launch output includes booking finalize proof. |
| Related docs | docs/launch-readiness/go-no-go.md, docs/launch-readiness/public-rollout-checklist.md |
| Last reviewed | TODO |

### Notes

Booking finalize is a revenue and trust path. Treat it like one.

---

## RISK-019 — Stripe webhook replay/idempotency under load not proven

| Field | Value |
|---|---|
| Severity | Critical |
| Owner | Tori |
| Backup | TODO |
| Decision | BLOCKS PUBLIC ROLLOUT |
| Private beta impact | Acceptable only if webhook smoke/idempotency proof is green and beta volume is capped. |
| Public rollout impact | Blocks public rollout. |
| Mitigation | Add Stripe webhook replay load test and chaos storm test. |
| Verification | Staging proof confirms signature verification, replay dedupe, no double mutation. |
| Related docs | docs/launch-readiness/go-no-go.md, docs/launch-readiness/public-rollout-checklist.md, docs/runbooks/stripe-degradation.md |
| Last reviewed | TODO |

### Notes

Never hand-wave webhook idempotency. Stripe will find the edge case at the most theatrical time.

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
| Last reviewed | TODO |

### Notes

Private media is privacy-sensitive. Do not beta-test a leak. That’s not a feature flag, that’s a lawsuit-shaped piñata.

---

## RISK-021 — Notification degradation handling not proven

| Field | Value |
|---|---|
| Severity | Medium |
| Owner | Tori |
| Backup | TODO |
| Decision | BLOCKS PUBLIC ROLLOUT |
| Private beta impact | Acceptable if manual follow-up path exists. |
| Public rollout impact | Blocks public rollout if retry/manual-follow-up behavior is not proven. |
| Mitigation | Prove Postmark/Twilio degradation handling and notification backlog behavior. |
| Verification | Chaos tests and runbook links pass. |
| Related docs | docs/runbooks/postmark-degradation.md, docs/runbooks/twilio-degradation.md, docs/runbooks/notification-backlog.md |
| Last reviewed | TODO |

### Notes

Notifications can fail. The launch question is whether they fail visibly and recoverably.

---

## RISK-022 — Auth/session/rate-limit behavior under provider degradation not proven

| Field | Value |
|---|---|
| Severity | High |
| Owner | Tori |
| Backup | TODO |
| Decision | BLOCKS PUBLIC ROLLOUT |
| Private beta impact | Acceptable only if rate-limit behavior and auth route alerts are active. |
| Public rollout impact | Blocks public rollout. |
| Mitigation | Add alert coverage and chaos tests for Redis/rate-limit degradation and auth failure spikes. |
| Verification | pnpm test:chaos includes Redis/rate-limit behavior; Slack alerts are mapped. |
| Related docs | docs/runbooks/redis-outage.md, docs/launch-readiness/slack-alerts.md |
| Last reviewed | TODO |

### Notes

High-risk routes must not fail open just because Redis got dramatic.

---

## RISK-023 — Public rollout checklist not created

| Field | Value |
|---|---|
| Severity | High |
| Owner | Tori |
| Backup | TODO |
| Decision | BLOCKS PUBLIC ROLLOUT |
| Private beta impact | Does not block private beta if private-beta checklist is complete. |
| Public rollout impact | Blocks public rollout. |
| Mitigation | Create docs/launch-readiness/public-rollout-checklist.md. |
| Verification | Checklist exists and includes staged rollout, rollback criteria, provider quota confirmation, and final sign-off. |
| Related docs | docs/launch-readiness/go-no-go.md, docs/launch-readiness/public-rollout-checklist.md |
| Last reviewed | TODO |

### Notes

This should be written before private beta ends, not after beta becomes public by accident. Sneaky launches are still launches.

---

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
| Last reviewed | TODO |

### Notes

Sentry release/environment metadata can still be implemented now. Live Slack alert routing is deferred until the Sentry plan or alternate alerting path is available.

# Closed or mitigated risks

Move risks here only when evidence exists.

## RISK-000 — Example closed risk

| Field | Value |
|---|---|
| Severity | Low |
| Owner | Tori |
| Decision | MITIGATED |
| Mitigation | Example only. Remove this placeholder when the first real risk is closed. |
| Verification | TODO |
| Closed date | TODO |

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

## Maintenance rule

A risk with no owner is not accepted. A risk with no mitigation is not accepted. A risk with no evidence is not closed.