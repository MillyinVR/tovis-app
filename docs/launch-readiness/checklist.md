# TOVIS Launch Readiness Checklist

This checklist tracks the launch-hardening work required before private beta and public rollout.

Use this file as the source of truth for launch readiness. Do not mark an item DONE unless the implementation exists, tests/docs exist where appropriate, and the linked files are committed.

## Important distinction

- Implemented means the code or doc exists and is committed.
- Tested locally means focused local proof exists.
- Tested in CI means the relevant proof has run in CI.
- Verified deployed means the behavior has been verified in staging or production.
- Operationalized means monitoring, alerts, ownership, runbooks, rollout, or support workflow exists.

## Status legend

| Status | Meaning |
|---|---|
| TODO | Not started or not proven. |
| IN PROGRESS | Partially implemented or partially proven. |
| DONE | Implemented, tested/documented where appropriate, committed, and not waiting on known required proof for this scope. |
| BLOCKED | Cannot move forward until a dependency or decision is resolved. |
| DEFERRED | Intentionally postponed beyond current launch-readiness scope. |
| [~] | Partial evidence exists, but production-grade proof is still missing. |

## Proof columns

| Column | Meaning |
|---|---|
| Implemented | Code/doc exists and is committed. |
| Tested locally | Focused local tests or local verification have passed. |
| Tested in CI | Relevant CI run has passed. |
| Verified deployed | Behavior has been verified in staging/production. |
| Operationalized | Monitoring, alerts, runbooks, owners, rollout, or support workflow exists. |

---

# Current verified repo baseline

| Item | Current state |
|---|---|
| Verified commit | 458a5a4bb0715c59a4198e9457c5b5a2c6cd4ef3 on main. |
| Local vs origin | Local matched origin/main at verification time. |
| pnpm typecheck | Passed locally. |
| pnpm verify:privacy-phase1 | Passed locally. |
| Privacy phase 1 tests | 20 files / 240 tests passed locally. |
| Canonical normalization guard | Passed. |
| PII plaintext-read guard | Passed with 471 known baseline entries. |
| Phase 1 privacy status | Complete for current pre-launch scope. |
| Launch operations status | PR 1 docs scaffold in progress; live dashboard, alerts, load proof, chaos proof, and deployed proof still open. |
| Load tests | Signup load test exists; launch-critical load suite still missing. |
| Chaos tests | Not implemented yet. |
| On-call/launch docs | PR 1 docs scaffold being added. |
| Public rollout status | Blocked until Phase 2 launch-ops proof is complete. |

---

# Overall launch status

| Area | Current status |
|---|---|
| Core product flow | Mostly wired; staging/browser proof still needed for launch confidence. |
| Booking lifecycle slice | Strong; additional lifecycle/action matrix and deployed proof still needed. |
| Privacy / PII readiness | Phase 1 complete for current pre-launch scope; remaining work is tracked operational/deferred privacy debt. |
| Launch operations | In progress; docs scaffold is being created, but live dashboards, alert routing, load proof, and chaos proof remain open. |
| White-label SaaS readiness | Not ready; tenant model and tenant visibility are not implemented. |
| Private beta readiness | Not ready until private-beta gates, dashboard proof, alert path, rollback path, and core staging proof are complete. |
| Public rollout readiness | Not ready until private beta exits cleanly, backup owner exists, P1 escalation is tested, load tests pass, and chaos tests pass. |
| Current focus | Phase 2 launch ops proof: docs, Sentry dashboard, Slack alerts, load tests, chaos tests, go/no-go evidence. |

---

# Launch blocker tracker

| Item | Status | Implemented | Tested locally | Tested in CI | Verified deployed | Operationalized | Owner | Notes |
|---|---|---:|---:|---:|---:|---:|---|---|
| Phase 1 privacy/PII contract unblock | DONE | Yes | Yes | Unknown | Partial | Partial | Tori | pnpm verify:privacy-phase1 passed locally; launch-env reruns remain tracked. |
| On-call ownership doc | IN PROGRESS | Yes | N/A | N/A | N/A | Partial | Tori | docs/launch-readiness/oncall.md; backup owner and public escalation still blocked. |
| Go/no-go launch gate | IN PROGRESS | Yes | N/A | N/A | N/A | Partial | Tori | docs/launch-readiness/go-no-go.md; evidence fields still TODO. |
| Private beta checklist | IN PROGRESS | Yes | N/A | N/A | N/A | Partial | Tori | docs/launch-readiness/private-beta-checklist.md; proof still TODO. |
| Public rollout checklist | IN PROGRESS | Yes | N/A | N/A | N/A | Partial | Tori | docs/launch-readiness/public-rollout-checklist.md; public rollout remains blocked. |
| Risk register | IN PROGRESS | Yes | N/A | N/A | N/A | Partial | Tori | docs/launch-readiness/risk-register.md; risks need review as proof lands. |
| Sentry dashboard proof doc | IN PROGRESS | Yes | N/A | N/A | No | Partial | Tori | docs/launch-readiness/sentry-dashboard.md; live dashboard evidence still TODO. |
| Slack alert map | IN PROGRESS | Yes | N/A | N/A | No | Partial | Tori | docs/launch-readiness/slack-alerts.md; routing/thresholds/testing still TODO. |
| Load test plan | IN PROGRESS | Yes | N/A | N/A | No | Partial | Tori | docs/launch-readiness/load-test-plan.md; scripts/proof still TODO. |
| Chaos test plan | IN PROGRESS | Yes | N/A | N/A | No | Partial | Tori | docs/launch-readiness/chaos-test-plan.md; tests/proof still TODO. |
| Full booking lifecycle E2E | IN PROGRESS | Partial | Partial | Unknown | No | No | Tori | API-assisted proof exists; full browser/staging proof still needed. |
| Load tests for launch-critical flows | TODO | Partial | Partial | No | No | No | Tori | Signup load test exists only. |
| Chaos tests for dependency failures | TODO | No | No | No | No | No | Tori | No tests/chaos coverage yet. |
| Live dashboard panels | TODO | No | No | No | No | No | Tori | Sentry/dashboard sections planned but not proven live. |
| Alert routing and escalation | TODO | No | No | No | No | No | Tori | Slack-first private beta path planned; public P1 escalation blocked. |
| Named backup owner | BLOCKED | No | No | No | No | No | Tori | Required before public rollout. |
| Provider/deployed readiness proof | TODO | Partial | Partial | Unknown | No | No | Tori | Health endpoints exist; staging/provider-live proof still needed. |
| Rollback proof | IN PROGRESS | Partial | N/A | N/A | No | Partial | Tori | Rollback criteria in docs; actual drill/evidence still needed. |
| Tenant data model / white-label isolation | TODO | No | No | No | No | No | Tori | Not required for first private beta unless white-label is in scope. |
| UploadSession binding | TODO | No | No | No | No | No | Tori | Still needed if upload hardening remains public-launch scope. |
| Realtime/session refresh strategy | TODO | No | No | No | No | No | Tori | Pro session state endpoint and polling are not implemented. |

---

# Phase 1 — Privacy/PII contract unblock

## Goal

Remove the hard public-launch privacy blocker by establishing a real cryptographic privacy boundary, centralized normalization/redaction, and privacy request foundations.

## Current status

DONE for current pre-launch scope.

Local verification at commit 458a5a4:

| Command | Result |
|---|---|
| pnpm typecheck | Passed |
| pnpm verify:privacy-phase1 | Passed |
| node tools/check-canonical-normalization.mjs | Passed |
| node tools/check-pii-plaintext-reads.mjs | Passed with 471 known baseline entries |
| pnpm test:privacy-phase1 | 14 files / 195 tests passed |
| pnpm test:privacy-export-delete | 6 files / 45 tests passed |

## Items

| Item | Status | Implemented | Tested locally | Tested in CI | Verified deployed | Operationalized | Owner | Notes |
|---|---|---:|---:|---:|---:|---:|---|---|
| Canonical contact normalizer | DONE | Yes | Yes | Unknown | N/A | Partial | Tori | lib/security/contactNormalization.ts; guard passes. |
| Canonical normalization guard | DONE | Yes | Yes | Unknown | N/A | Partial | Tori | tools/check-canonical-normalization.mjs. |
| Audit payload redaction | DONE | Yes | Yes | Unknown | N/A | Partial | Tori | lib/security/auditRedaction.ts; applied to audit write paths. |
| AEAD address envelope | DONE | Yes | Yes | Unknown | Partial | Partial | Tori | lib/security/crypto/aead.ts; address encryption helper and backfill exist. |
| Address encryption backfill script | DONE | Yes | Yes | Unknown | Partial | Partial | Tori | prisma/scripts/backfillAddressEncryption.ts; launch-env rerun if applicable. |
| PII plaintext-read guard | DONE | Yes | Yes | Unknown | N/A | Partial | Tori | Guard passes with 471 known baseline entries. |
| HMAC contact hash v2 | DONE | Yes | Yes | Unknown | Partial | Partial | Tori | HMAC helper, v2 columns, v2-only readers, and drop migration exist. |
| HMAC v2 backfill script | DONE | Yes | Yes | Unknown | Partial | Partial | Tori | prisma/scripts/backfillContactHashV2.ts; launch-env rerun if applicable. |
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
- Privacy verification commands pass.
- Remaining operational/deferred privacy work is tracked and does not masquerade as missing implementation.

---

# Phase 2 — Launch ops proof

## Goal

Prove the system can be operated during private beta and public rollout.

This phase is about operated readiness, not just code existence. Dashboards, alerts, runbooks, load proof, chaos proof, rollback, and go/no-go evidence must all exist before public rollout.

## Phase 2 docs scaffold

| Item | Status | Implemented | Tested locally | Tested in CI | Verified deployed | Operationalized | Owner | Notes |
|---|---|---:|---:|---:|---:|---:|---|---|
| On-call plan | IN PROGRESS | Yes | N/A | N/A | N/A | Partial | Tori | docs/launch-readiness/oncall.md; backup and public escalation unresolved. |
| Go/no-go gate | IN PROGRESS | Yes | N/A | N/A | N/A | Partial | Tori | docs/launch-readiness/go-no-go.md; evidence still TODO. |
| Private beta checklist | IN PROGRESS | Yes | N/A | N/A | N/A | Partial | Tori | docs/launch-readiness/private-beta-checklist.md; evidence still TODO. |
| Public rollout checklist | IN PROGRESS | Yes | N/A | N/A | N/A | Partial | Tori | docs/launch-readiness/public-rollout-checklist.md; evidence still TODO. |
| Risk register | IN PROGRESS | Yes | N/A | N/A | N/A | Partial | Tori | docs/launch-readiness/risk-register.md; review/update as proof lands. |
| Sentry dashboard proof doc | IN PROGRESS | Yes | N/A | N/A | No | Partial | Tori | docs/launch-readiness/sentry-dashboard.md; live links still TODO. |
| Slack alert map | IN PROGRESS | Yes | N/A | N/A | No | Partial | Tori | docs/launch-readiness/slack-alerts.md; routing/testing still TODO. |
| Load test plan | IN PROGRESS | Yes | N/A | N/A | No | Partial | Tori | docs/launch-readiness/load-test-plan.md; scripts/proof still TODO. |
| Chaos test plan | IN PROGRESS | Yes | N/A | N/A | No | Partial | Tori | docs/launch-readiness/chaos-test-plan.md; tests/proof still TODO. |

## Observability and alerting

| Item | Status | Implemented | Tested locally | Tested in CI | Verified deployed | Operationalized | Owner | Notes |
|---|---|---:|---:|---:|---:|---:|---|---|
| Sentry release/deployment tagging | TODO | No | No | No | No | No | Tori | Add release/dist/environment in server, edge, and client config. |
| Console/log capture policy | TODO | No | No | No | No | No | Tori | Decide whether logs stay enabled and document redaction policy. |
| Health/readiness dashboard section | TODO | Partial | Partial | Unknown | No | No | Tori | Health endpoints exist; dashboard evidence missing. |
| Booking funnel dashboard section | TODO | No | No | No | No | No | Tori | Needs live Sentry/dashboard proof. |
| Pro session lifecycle dashboard section | TODO | No | No | No | No | No | Tori | Needs live Sentry/dashboard proof. |
| Media upload dashboard section | TODO | No | No | No | No | No | Tori | Needs live Sentry/dashboard proof. |
| Payments/webhooks dashboard section | TODO | No | No | No | No | No | Tori | Needs live Sentry/dashboard proof. |
| Notifications dashboard section | TODO | No | No | No | No | No | Tori | Needs live Sentry/dashboard proof. |
| Background jobs dashboard section | TODO | Unknown | No | No | No | No | Tori | Identify launch-critical jobs first. |
| Auth/rate limits dashboard section | TODO | No | No | No | No | No | Tori | Needs live Sentry/dashboard proof. |
| Infra dependencies dashboard section | TODO | Partial | Partial | Unknown | No | No | Tori | Provider dashboards/runbooks exist; live dashboard proof missing. |
| SLO/error budget dashboard section | TODO | No | No | No | No | No | Tori | Define thresholds and evidence. |
| Slack private-beta alert channel | TODO | No | No | No | No | No | Tori | Required before private beta. |
| P1/P2 Slack alert routing | TODO | No | No | No | No | No | Tori | Must link owner, threshold, dashboard, runbook. |
| Synthetic staging alert test | TODO | No | No | No | No | No | Tori | Required before private beta. |
| Public P1 escalation path | BLOCKED | No | No | No | No | No | Tori | Requires backup owner and tested escalation path. |

## Load tests

| Item | Status | Implemented | Tested locally | Tested in CI | Verified deployed | Operationalized | Owner | Notes |
|---|---|---:|---:|---:|---:|---:|---|---|
| Signup load test | DONE | Yes | Partial | No | No | Partial | Tori | Existing tests/load/signup-load-test.ts; useful baseline only. |
| Availability bootstrap load test | TODO | No | No | No | No | No | Tori | Add tests/load/availability-bootstrap-load-test.ts. |
| Hold create load test | TODO | No | No | No | No | No | Tori | Add tests/load/hold-create-load-test.ts. |
| Booking finalize load test | TODO | No | No | No | No | No | Tori | Critical public-rollout proof. |
| Media metadata load test | TODO | No | No | No | No | No | Tori | Required if media in launch scope. |
| Checkout load test | TODO | No | No | No | No | No | Tori | Required if payments in launch scope. |
| Stripe webhook replay load test | TODO | No | No | No | No | No | Tori | Must prove replay/idempotency under pressure. |
| Notification processing load test | TODO | No | No | No | No | No | Tori | Required if notifications enabled. |
| Aggregate launch load suite | TODO | No | No | No | No | No | Tori | Add tests/load/run-launch-load-suite.ts. |
| test:load:launch script | TODO | No | No | No | No | No | Tori | Add after scenario scripts exist. |
| Staging load proof | TODO | No | No | No | No | No | Tori | Required before public rollout. |

## Chaos tests

| Item | Status | Implemented | Tested locally | Tested in CI | Verified deployed | Operationalized | Owner | Notes |
|---|---|---:|---:|---:|---:|---:|---|---|
| Chaos test harness | TODO | No | No | No | No | No | Tori | Add tests/chaos/chaosTestHarness.ts. |
| Redis outage chaos test | TODO | No | No | No | No | No | Tori | Must prove high-risk paths fail safely. |
| Supabase Storage outage chaos test | TODO | No | No | No | No | No | Tori | Must avoid unsafe media state. |
| Stripe webhook storm chaos test | TODO | No | No | No | No | No | Tori | Must prove dedupe/idempotency. |
| Postmark degradation chaos test | TODO | No | No | No | No | No | Tori | Required if email enabled. |
| Twilio degradation chaos test | TODO | No | No | No | No | No | Tori | Required if SMS enabled. |
| DB replica lag chaos test | TODO | No | No | No | No | No | Tori | Must protect critical write/read paths. |
| test:chaos script | TODO | No | No | No | No | No | Tori | Add after tests exist. |
| verify:launch-ops script | TODO | No | No | No | No | No | Tori | Should aggregate chaos + launch load proof. |

## Phase 2 acceptance criteria

Private beta requires:

- pnpm typecheck passes.
- pnpm verify:privacy-phase1 passes.
- Private beta checklist is complete.
- Rollback owner/path is documented.
- Slack alert destination exists.
- At least one synthetic staging alert routes successfully.
- Health/readiness proof exists.
- Booking lifecycle smoke proof exists.
- Payment/webhook proof exists if payments are enabled.
- Media/private-media proof exists if media is enabled.
- Risk register has no unowned High/Critical private-beta blockers.

Public rollout requires:

- All private beta blockers are closed.
- Named backup owner exists.
- P1 escalation path is tested.
- Live dashboard proof exists for all required sections.
- P1/P2 alerts route and link to runbooks.
- Load tests pass against staging.
- Chaos tests pass.
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
| Add full lifecycle action regression suite | TODO | Partial | Partial | No | No | No | Tori | Needs action-by-action legal/illegal proof. |
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
| Add claim/NFC path tests and docs | DONE | Yes | Yes | Unknown | No | Partial | Tori | Docs/tests exist; deployed proof still needed. |
| Keep legacy AftercareSummary.publicToken only as deprecated field | IN PROGRESS | Yes | Partial | Unknown | No | No | Tori | Contraction still pending. |
| Create idempotency route map document | TODO | No | No | No | No | No | Tori | Add docs/launch-readiness/idempotency-map.md. |
| Add idempotency ledger cleanup/reaper | TODO | No | No | No | No | No | Tori | Retention/cleanup proof missing. |
| Redact persisted idempotency response JSON | TODO | No | No | No | No | No | Tori | responseBodyJson can retain PII unless redacted. |
| Add full retry/idempotency suite | TODO | Partial | Partial | Unknown | No | No | Tori | Several route tests exist; full suite missing. |

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
| Origin/Referer checks | DONE | Yes | Yes | Unknown | No | Partial | Tori | Middleware exists. |
| Booking route safe logging hardening | DONE | Yes | Yes | Unknown | No | Partial | Tori | Focused route proof exists. |
| Hold-create internal error logging sanitization | DONE | Yes | Yes | Yes | No | Partial | Tori | Safe logging proof exists. |
| Supabase policy SQL tests | TODO | No | No | No | No | No | Tori | Still missing. |
| Live Supabase bucket policy verification | TODO | Partial | No | No | No | No | Tori | Required before public rollout. |
| No-bare-error logging CI guard | TODO | No | No | No | No | No | Tori | Add tools/check-no-bare-error-log.mjs. |
| UploadSession binding | TODO | No | No | No | No | No | Tori | Required before public launch if uploads are in scope. |
| Orphan media cleanup | TODO | No | No | No | No | No | Tori | Still missing. |
| Media scan/moderation decision | TODO | No | No | No | No | No | Tori | Decide or explicitly defer. |

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
| Runbooks linked from alerts | TODO | Partial | N/A | N/A | No | Partial | Tori | Planned in slack-alerts.md; actual alert links still TODO. |

---

# Database and performance review

## Goal

Prove hot data paths are indexed and booking overlap is impossible.

| Item | Status | Implemented | Tested locally | Tested in CI | Verified deployed | Operationalized | Owner | Notes |
|---|---|---:|---:|---:|---:|---:|---|---|
| Decide DB no-overlap constraint strategy | DONE | Yes | Yes | Unknown | No | Partial | Tori | Strategy decided and tested locally. |
| Test overlapping appointment ranges | DONE | Yes | Yes | Unknown | No | Partial | Tori | Integration coverage exists. |
| Booking concurrency integration test | DONE | Yes | Yes | Unknown | No | Partial | Tori | Overlap/concurrency proof exists. |
| Review hot query indexes | IN PROGRESS | Partial | No | No | No | No | Tori | More EXPLAIN work needed. |
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
| Tenant model decision doc | TODO | No | No | No | No | No | Tori | Add docs/product/tenant-model.md. |
| Tenant model | TODO | No | No | No | No | No | Tori | Not implemented. |
| tovis-root tenant seed | TODO | No | No | No | No | No | Tori | Required for migration/backfill. |
| homeTenantId columns | TODO | No | No | No | No | No | Tori | Required for Pro/Client tenant ownership. |
| Booking tenant attribution columns | TODO | No | No | No | No | No | Tori | Required for revenue/analytics attribution. |
| Tenant resolver | TODO | No | No | No | No | No | Tori | Add lib/tenant/resolveTenant.ts. |
| Tenant visibility helper | TODO | No | No | No | No | No | Tori | Add lib/tenant/visibilityFilter.ts. |
| Tenant-aware discovery guard | TODO | No | No | No | No | No | Tori | Add static guard after tenant model exists. |
| NFC tenant inheritance | TODO | No | No | No | No | No | Tori | Current NFC schema is not tenant-backed. |
| Tenant-specific brand resolution | TODO | Partial | No | No | No | No | Tori | Brand seam exists; tenant model missing. |
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
| Record commit SHA/date/env/command/result | IN PROGRESS | Yes | Yes | Partial | No | Partial | Tori | Continue adding entries as proof lands. |
| Phase 1 privacy proof | DONE | Yes | Yes | Unknown | Partial | Partial | Tori | docs/privacy/phase-1-privacy-proof.md. |
| Full lifecycle proof | TODO | Partial | Partial | No | No | No | Tori | Tests exist but proof entry still needed. |
| Load proof | TODO | No | No | No | No | No | Tori | Missing. |
| Chaos proof | TODO | No | No | No | No | No | Tori | Missing. |
| Deployed health/readiness proof | TODO | No | No | No | No | No | Tori | Needs staging/production proof. |
| Deployed storage policy proof | TODO | Partial | No | No | No | No | Tori | Repo proof exists; deployed proof missing. |
| Dashboard proof | TODO | No | No | No | No | No | Tori | Needs live Sentry/provider dashboard links. |
| Alert proof | TODO | No | No | No | No | No | Tori | Needs synthetic alert test. |

---

# Final launch gate

Do not launch publicly until every required public rollout item below is true.

| Gate | Status | Notes |
|---|---|---|
| Phase 1 privacy verification passes on launch commit | DONE | Passed locally at verified commit; rerun on final launch commit. |
| Core booking/session flow has E2E/staging proof | IN PROGRESS | API-assisted proof exists; staging/browser proof still needed. |
| Health live/ready endpoints are deployed and verified | TODO | Code exists; deployed proof missing. |
| Production monitors watch live and ready endpoints | TODO | Not wired/proven. |
| Runbooks exist and are linked from alerts | IN PROGRESS | Runbooks exist; alert linking/testing missing. |
| Sentry dashboard exists with critical panels | TODO | Dashboard proof doc exists; live proof missing. |
| Slack/private-beta alerts are routed and tested | TODO | Alert map exists; routing/testing missing. |
| P1 public escalation path is tested | BLOCKED | Requires backup owner and escalation path. |
| Storage/private-media policies are deployed and verified | TODO | Repo proof exists; deployed proof missing. |
| High-risk route rate limits are enforced in code | DONE | Code coverage exists; deployed telemetry still needed. |
| Auth/SMS routes fail safely under abuse/backing-service failure | DONE | Local proof exists; chaos/deployed proof still needed. |
| Pro readiness/onboarding gates are enforced in code | DONE | Code coverage exists; deployed proof still needed. |
| Realtime or polling strategy is implemented | TODO | Missing. |
| Payment/Stripe webhook replay is proven idempotent | IN PROGRESS | Code/test proof exists; replay storm/load proof missing. |
| Full retry/idempotency suite passes | TODO | Partial route coverage only. |
| Load tests pass target thresholds | TODO | Signup-only load exists; hot-path suite missing. |
| Chaos tests pass for Redis/provider outages | TODO | Missing. |
| Privacy/compliance docs exist | DONE | Phase 1 proof exists; deferred areas tracked. |
| Launch-env privacy backfill reruns are recorded if applicable | TODO | Required if target env has relevant rows. |
| Tenant data isolation is implemented if white-label launch is in scope | TODO | Missing; not required for first non-white-label beta. |
| Rollout and rollback plans exist | IN PROGRESS | Docs scaffold exists; drills/proof missing. |
| Support has launch scripts and escalation paths | TODO | Missing. |
| Go/no-go review is complete | TODO | Gate doc exists; final decision missing. |

---

# Current PR 1 summary

## Completed or being added in PR 1

- docs/launch-readiness/oncall.md
- docs/launch-readiness/go-no-go.md
- docs/launch-readiness/private-beta-checklist.md
- docs/launch-readiness/public-rollout-checklist.md
- docs/launch-readiness/risk-register.md
- docs/launch-readiness/sentry-dashboard.md
- docs/launch-readiness/slack-alerts.md
- docs/launch-readiness/load-test-plan.md
- docs/launch-readiness/chaos-test-plan.md
- Updated docs/launch-readiness/checklist.md

## What PR 1 does

- Corrects stale Phase 1 privacy status.
- Adds explicit Phase 2 launch-ops docs.
- Converts vague launch readiness into named gates, risks, owners, and proof requirements.
- Keeps dashboards, alert routing, load tests, chaos tests, and deployed proof open until real evidence exists.

## What PR 1 does not claim

- It does not claim live dashboards exist.
- It does not claim Slack alerts are wired.
- It does not claim load tests pass.
- It does not claim chaos tests pass.
- It does not claim public rollout is ready.

## Next priority after PR 1

1. Add Sentry release/deployment markers.
2. Decide and document Sentry console/log capture policy.
3. Wire or document the Sentry dashboard sections.
4. Choose Slack alert channel and test one synthetic staging alert.
5. Add tests/load/availability-bootstrap-load-test.ts.
6. Add the remaining launch-critical load tests.
7. Add tests/chaos/chaosTestHarness.ts.
8. Add first chaos tests for Redis, Storage, and Stripe webhook storm.
9. Add test:load:launch, test:chaos, and verify:launch-ops.
10. Record staging proof in go-no-go.md, test-proof.md, and related docs.

## Then run

bash git diff --check pnpm typecheck pnpm verify:privacy-phase1 git status --short git diff --stat