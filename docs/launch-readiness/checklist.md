# TOVIS Launch Readiness Checklist

This checklist tracks the launch-hardening work required before a serious public launch.

Use this file as the source of truth for launch readiness. Do not mark an item fully done unless the implementation exists, tests/docs exist where appropriate, and the linked files are committed.

## Important distinction

- `Implemented` means the code or doc exists and is committed.
- `Tested locally` means focused local proof exists.
- `Tested in CI` means the relevant proof has run in CI.
- `Verified deployed` means the behavior has been verified in staging or production.
- `Operationalized` means monitoring, ownership, runbook, rollout, or support process exists where needed.

## Status legend

| Status | Meaning |
|---|---|
| `TODO` | Not started or not proven. |
| `IN PROGRESS` | Partially implemented or partially proven. |
| `DONE` | Implemented, tested/documented where appropriate, committed, and not waiting on known required proof for this scope. |
| `BLOCKED` | Cannot move forward until a dependency or decision is resolved. |
| `DEFERRED` | Intentionally postponed beyond launch-readiness scope. |
| `[~]` | Partial evidence exists, but production-grade proof is still missing. |

## Proof columns

| Column | Meaning |
|---|---|
| `Implemented` | Code/doc exists and is committed. |
| `Tested locally` | Focused local tests or local verification have passed. |
| `Tested in CI` | Relevant CI run has passed. |
| `Verified deployed` | Behavior has been verified in staging/production. |
| `Operationalized` | Monitoring, alerts, runbooks, owner, rollout, or support workflow exists. |

---

# Overall launch status

| Area | Current status |
|---|---|
| Core product flow | Mostly wired. |
| Booking lifecycle slice | Strong, approximately 95%. |
| Full launch readiness | In progress, approximately 77-80% depending on whether ops scaffolding is credited. |
| Privacy / PII readiness | In progress; address envelope is still plaintext phase. |
| White-label SaaS readiness | Not ready; Tenant model and tenant visibility are not implemented. |
| Launch operations | Strong scaffolding exists; live dashboards, pager, go/no-go, load, and chaos proof are still missing. |
| Current focus | Privacy runtime, session refresh, proof suite, load/chaos, tenant foundation, rollout operations. |

## Current verified repo baseline

| Item | Current state |
|---|---|
| HEAD | `89ce836` on `main`. |
| Local working tree | Modified docs present; not staged based on latest local check. |
| Modified docs | `docs/launch-readiness/checklist.md`, `docs/launch-readiness/sprint-1-verification-checklist.md`, `docs/launch-readiness/test-proof.md`. |
| Remote branches | Many remote branches are already merged into `main`; branch cleanup is housekeeping. |
| Type escapes | Exactly 3 production `as unknown as` sites: `lib/prisma.ts`, `app/api/pro/offerings/route.ts`, `app/api/availability/bootstrap/route.ts`. |
| Address encryption | `encryptedAddressJson` / encrypted snapshot columns exist, but the envelope algorithm is still `plaintext-json-expand-phase`. |
| Tenant model | Not implemented. |
| Session state endpoint | Not implemented. |
| UploadSession | Not implemented. |
| Load tests | Signup load test exists only. |
| Chaos tests | Not implemented. |
| Go/no-go / oncall docs | Missing. |

---

# Launch blocker tracker

| Item | Status | Implemented | Tested locally | Tested in CI | Verified deployed | Operationalized | Owner | Notes |
|---|---|---:|---:|---:|---:|---:|---|---|
| Full lifecycle regression suite | IN PROGRESS | Partial | Partial | Unknown | No | No | Tori | API-assisted E2E exists; full browser path and action matrix still need proof. |
| Pro onboarding/readiness hard gate | DONE | Yes | Yes | Unknown | No | Partial | Tori | Code/tests exist; deployed verification still needed. |
| High-risk booking/token/media/auth rate-limit enforcement | IN PROGRESS | Yes | Yes | Unknown | No | Partial | Tori | Route coverage exists; production telemetry still needed. |
| Origin/Referer checks | IN PROGRESS | Yes | Yes | Unknown | No | Partial | Tori | Middleware enforcement exists; deployed proof still needed. |
| Realtime/session refresh strategy | TODO | No | No | No | No | No | Tori | Pro session state endpoint and polling are not implemented. |
| Full booking lifecycle E2E | IN PROGRESS | Partial | Partial | Unknown | No | No | Tori | API-assisted flow exists; staging/prod execution evidence still needed. |
| Load tests for booking/availability/media | TODO | Partial | Partial | No | No | No | Tori | Signup load test exists only. |
| Chaos tests for Redis/provider outages | TODO | No | No | No | No | No | Tori | No `tests/chaos` coverage yet. |
| Compliance/privacy docs | IN PROGRESS | Yes | Partial | No | No | No | Tori | Docs exist; owner review/sign-off incomplete. |
| Privacy runtime / AEAD address encryption | TODO | Partial | Partial | No | No | No | Tori | Dual-write infrastructure exists; envelope is still plaintext phase. |
| Tenant data model / white-label isolation | TODO | No | No | No | No | No | Tori | No `Tenant`, `homeTenantId`, or tenant visibility helper. |
| UploadSession binding | TODO | No | No | No | No | No | Tori | No UploadSession model or upload-session binding. |
| Rollout/go-no-go plan | TODO | No | No | No | No | No | Tori | `go-no-go.md`, beta checklist, rollout checklist, and risk register missing. |
| Operational ownership | TODO | No | No | No | No | No | Tori | Owners/escalation paths need to be explicitly assigned. |

---

# Phase 0 — Baseline stabilization and quick wins

## Goal

Clean the current repo state, correct stale handoff facts, and close small recurring audit findings before larger architectural work begins.

## Items

| Item | Status | Implemented | Tested locally | Tested in CI | Verified deployed | Operationalized | Owner | Notes |
|---|---|---:|---:|---:|---:|---:|---|---|
| Resolve modified launch-readiness docs | TODO | Partial | No | No | No | No | Tori | `checklist.md`, `sprint-1-verification-checklist.md`, and `test-proof.md` are modified locally. Review and commit/discard intentionally. |
| Add Sentry release/deployment marker | TODO | No | No | No | No | No | Tori | Sentry server/edge config lacks `release` / `dist`. |
| Disable Sentry console logs or add scrubber | TODO | No | No | No | No | No | Tori | `enableLogs: true` and console logging integration are active; confirm scrubber before keeping logs enabled. |
| Verify `HEALTH_CHECK_PROVIDERS_LIVE=true` in prod | TODO | Unknown | No | No | No | No | Tori | Health provider live checks default false unless env enables them. |
| Remove `SUPABASE_SECRET_KEY` legacy fallback | TODO | No | No | No | No | No | Tori | `SUPABASE_SERVICE_ROLE_KEY` should be the only service-role secret after env migration. |
| Add `docs/launch-readiness/idempotency-map.md` | TODO | No | No | No | No | No | Tori | Document route, key shape, replay behavior, and retention. |
| Add SQL comments for plaintext-phase address columns | TODO | No | No | No | No | No | Tori | Prevent `encryptedAddressJson` from being misread as real encryption before AEAD cutover. |
| Fix BrandProvider host/tenant pipe | TODO | No | No | No | No | No | Tori | `BrandProvider` currently calls `getBrandConfig()` without host/tenant input. |
| Reconcile root domain drift | TODO | Partial | No | No | No | No | Tori | Middleware uses `tovis.me`; brand resolver treats `tovis.app` as canonical. Decide one source of truth. |
| Add unit-test CI workflow | TODO | No | No | No | No | No | Tori | `pnpm test` exists, but dedicated unit workflow was not found. |
| Add security scan CI workflow | TODO | No | No | No | No | No | Tori | Add `npm audit` / gitleaks or equivalent. |
| Replace 3 remaining `as unknown as` sites | TODO | Partial | No | No | No | No | Tori | Replace with `lib/typed/global.ts`, `lib/typed/json.ts`, and `lib/typed/cache.ts`. |
| Add `tools/check-no-type-escape.mjs` | TODO | No | No | No | No | No | Tori | Guard against `as any`, `as unknown as`, `@ts-ignore`, and `@ts-expect-error` outside allowed helper internals. |
| Prune merged remote branches | TODO | No | No | No | No | No | Tori | Local output shows remote branches listed under `--merged main`; prune intentionally in batches. |

## Exit criteria

- `git status --short` is clean.
- `pnpm typecheck` passes.
- `pnpm test` passes.
- Static guards pass.
- No production `as unknown as` outside approved `lib/typed` helpers.
- Launch-readiness docs reflect the corrected baseline.

---

# Sprint 1 — Core workflow correctness

## Goal

Make the booking/session lifecycle impossible to complete incorrectly.

## Items

| Item | Status | Implemented | Tested locally | Tested in CI | Verified deployed | Operationalized | Owner | Notes |
|---|---|---:|---:|---:|---:|---:|---|---|
| Replace misleading “Complete session” UI with closeout-aware action | DONE | Yes | Yes | Unknown | No | No | Tori | UI no longer implies direct completion. |
| Remove direct UI-driven `SessionStep.DONE` transition | DONE | Yes | Yes | Unknown | No | No | Tori | Backend closeout rules own completion. |
| Surface backend closeout blockers in the Pro session flow | DONE | Yes | Yes | Unknown | No | No | Tori | Blockers shown to Pro. |
| Keep backend direct DONE transition blocked | DONE | Yes | Yes | Unknown | No | No | Tori | Write boundary blocks illegal transition. |
| Add smoke coverage for booking closeout flow | DONE | Yes | Yes | Unknown | No | No | Tori | Smoke coverage exists. |
| Add full lifecycle action regression suite | TODO | Partial | Partial | No | No | No | Tori | Needs action-by-action legal/illegal coverage. |
| Add staging/prod lifecycle telemetry soak | TODO | No | No | No | No | No | Tori | Requires deployed environment and run record. |

## Key files

- `app/pro/bookings/[id]/session/page.tsx`
- `lib/booking/writeBoundary.ts`
- `lib/booking/lifecycleContract.ts`
- `tests/e2e/booking-lifecycle-smoke.spec.ts`
- `tests/e2e/booking-lifecycle.spec.ts`

## Acceptance criteria

- Pro cannot trigger direct DONE transition from the UI.
- Pro sees blockers when aftercare/payment/checkout/after-photo requirements are missing.
- Booking completion only happens through backend closeout rules.
- Every visible lifecycle action has a regression test.
- Lifecycle proof has been run and recorded against a specific commit/environment.

---

# Sprint 2 — Token and retry safety

## Goal

Use secure action-token flows and make retryable mutations safe.

## Items

| Item | Status | Implemented | Tested locally | Tested in CI | Verified deployed | Operationalized | Owner | Notes |
|---|---|---:|---:|---:|---:|---:|---|---|
| Move active aftercare/rebook paths to ClientActionToken | DONE | Yes | Yes | Unknown | No | No | Tori | Active flow no longer depends on publicToken. |
| Add active-path guard against `aftercare.publicToken` usage | DONE | Yes | Yes | Unknown | No | No | Tori | Guard exists. |
| Add rebook token GET/POST behavior coverage | DONE | Yes | Yes | Unknown | No | No | Tori | Route coverage exists. |
| Add token-scoped rebook idempotency | DONE | Yes | Yes | Unknown | No | No | Tori | Idempotency coverage exists. |
| Add claim/NFC path tests and docs | DONE | Yes | Yes | Unknown | No | Partial | Tori | Docs/tests exist; deployed proof still needed. |
| Keep legacy `AftercareSummary.publicToken` only as deprecated schema field | IN PROGRESS | Yes | Partial | Unknown | No | No | Tori | Deprecated field remains; contraction still pending. |
| Create idempotency route map document | TODO | No | No | No | No | No | Tori | Still missing. |
| Prove aftercare send atomicity | DONE | Yes | Yes | Unknown | No | No | Tori | Atomicity tests exist. |
| Migrate raw `ProClientInvite.token` to `tokenHash` for new/primary lookup paths | DONE | Yes | Yes | Unknown | No | No | Tori | New/primary paths use tokenHash. |
| Prove cancel/reschedule idempotency in route tests | DONE | Yes | Yes | Unknown | No | No | Tori | Cancel/reschedule route tests exist. |
| Add idempotency ledger cleanup/reaper | TODO | No | No | No | No | No | Tori | Ledger has `STARTED` rows and response JSON; cleanup/retention proof missing. |
| Redact persisted idempotency response JSON | TODO | No | No | No | No | No | Tori | `responseBodyJson` can retain PII unless redacted. |

## Key files

- `lib/aftercare/unclaimedAftercareAccess.ts`
- `app/api/client/rebook/[token]/route.ts`
- `app/client/bookings/[id]/page.tsx`
- `app/api/pro/bookings/[id]/aftercare/route.ts`
- `prisma/schema.prisma`
- `lib/booking/writeBoundary.aftercareAtomicity.test.ts`
- `lib/clients/clientClaimLinks.test.ts`
- `app/api/bookings/[id]/cancel/route.test.ts`
- `app/api/bookings/[id]/reschedule/route.test.ts`
- `lib/idempotency/idempotencyLedger.ts`

## Acceptance criteria

- New active aftercare links use ClientActionToken.
- Active client/pro payloads do not expose legacy publicToken.
- Rebook token flows are idempotent.
- Cancel/reschedule mutations are idempotent.
- Invite/claim tokens are hashed at rest for new/primary flows.
- Idempotency route map exists.
- Idempotency response persistence is redacted and bounded by cleanup policy.

---

# Sprint 3 — Security foundations

## Goal

Harden storage, media, rate limits, request trust boundaries, and safe logging.

## Items

| Item | Status | Implemented | Tested locally | Tested in CI | Verified deployed | Operationalized | Owner | Notes |
|---|---|---:|---:|---:|---:|---:|---|---|
| Add Supabase Storage bucket/policy migration as code | DONE | Yes | Yes | Unknown | No | No | Tori | Migration exists. |
| Add media-private restrictive policy baseline | DONE | Yes | Yes | Unknown | No | Partial | Tori | Policy proof mostly exists. |
| Add media-public policy baseline | DONE | Yes | Yes | Unknown | No | Partial | Tori | Policy baseline exists. |
| Add central rate-limit policy definitions | DONE | Yes | Yes | Unknown | No | Partial | Tori | Policies exist. |
| Add Supabase policy SQL tests | TODO | No | No | No | No | No | Tori | Still missing. |
| Verify live Supabase bucket policies after deploy | TODO | No | No | No | No | No | Tori | Needs deployed environment proof. |
| Add high-risk route/wrapper rate-limit enforcement | DONE | Yes | Yes | Unknown | No | Partial | Tori | Code coverage exists. |
| Add auth route rate limits | DONE | Yes | Yes | Unknown | No | Partial | Tori | Code coverage exists. |
| Add SMS route rate limits | DONE | Yes | Yes | Unknown | No | Partial | Tori | Code coverage exists. |
| Add SMS fail-closed behavior when Redis/rate limit backend is unavailable | DONE | Yes | Yes | Unknown | No | Partial | Tori | Local proof exists. |
| Add token route rate limits | DONE | Yes | Yes | Unknown | No | Partial | Tori | Code coverage exists. |
| Add media route rate limits | DONE | Yes | Yes | Unknown | No | Partial | Tori | Code coverage exists. |
| Add Origin/Referer checks for state-changing cookie-authenticated requests | DONE | Yes | Yes | Unknown | No | Partial | Tori | Middleware exists. |
| Add before/after media upload audit write-path verification | DONE | Yes | Yes | Unknown | No | Partial | Tori | Audit write-path verification exists. |
| Harden booking route raw error logging | DONE | Yes | Yes | No | No | Partial | Tori | Commit `8f2a424`; focused suite passed locally. |
| Sanitize hold-create internal error logging | DONE | Yes | Yes | Yes | No | Partial | Tori | PR #41 / commit `d97d83a`; safeError remains separate from sanitized meta. |
| Add no-bare-error logging CI guard | TODO | No | No | No | No | No | Tori | Add `tools/check-no-bare-error-log.mjs`. |
| Add upload-token binding proof | TODO | No | No | No | No | No | Tori | No UploadSession model or uploadSessionId binding yet. |
| Add orphan media cleanup | TODO | No | No | No | No | No | Tori | Still missing. |
| Add media scan/moderation flow or explicit deferral | TODO | No | No | No | No | No | Tori | Needs decision. |

## Key files

- `supabase/migrations/20260514180000_storage_media_bucket_policies.sql`
- `lib/rateLimit/policies.ts`
- `lib/rateLimit/enforce.ts`
- `middleware.ts`
- `app/api/auth/*`
- `app/api/pro/uploads/route.ts`
- `app/api/pro/bookings/[id]/media/route.ts`
- `docs/launch-readiness/rate-limit-coverage.md`
- `lib/security/logging.ts`
- `lib/booking/writeBoundary.ts`
- `lib/booking/writeBoundary.mobileRadius.test.ts`

## Acceptance criteria

- Private media cannot be anonymously listed/read in repo policy proof.
- Storage policy is committed and deployable.
- Auth/SMS/token/media routes are rate limited.
- SMS abuse routes fail closed when required.
- State-changing cookie-auth routes validate Origin/Referer or documented CSRF strategy.
- Booking/session hot routes use safe logging helpers instead of raw Error logging.
- Hold-create internal error logging avoids raw address payloads and keeps useful safe error diagnostics.
- Media upload has audit trail; delete/replacement proof still pending.
- Upload metadata cannot attach arbitrary uploaded objects without binding.

---

# Sprint 4 — Ops readiness

## Goal

Make the app observable, diagnosable, and operable during production incidents.

## Health endpoints and probes

| Item | Status | Implemented | Tested locally | Tested in CI | Verified deployed | Operationalized | Owner | Notes |
|---|---|---:|---:|---:|---:|---:|---|---|
| Add `/api/health/live` endpoint | DONE | Yes | Yes | Unknown | No | Partial | Tori | Endpoint and tests exist. |
| Add `/api/health/ready` endpoint | DONE | Yes | Yes | Unknown | No | Partial | Tori | Endpoint and tests exist. |
| Keep `/api/health` as compatibility alias for readiness | DONE | Yes | Yes | Unknown | No | Partial | Tori | Alias exists. |
| Add shared health response types | DONE | Yes | Yes | Unknown | No | No | Tori | Types exist. |
| Add health summary/status-code logic | DONE | Yes | Yes | Unknown | No | No | Tori | Tests exist. |
| Add Postgres readiness probe | DONE | Yes | Yes | Unknown | No | Partial | Tori | Probe exists. |
| Add Redis readiness probe | DONE | Yes | Yes | Unknown | No | Partial | Tori | Probe exists. |
| Add Supabase Storage readiness probe | DONE | Yes | Yes | Unknown | No | Partial | Tori | Probe exists. |
| Add Stripe readiness/config probe | DONE | Yes | Yes | Unknown | No | Partial | Tori | Probe exists. |
| Add Postmark readiness/config probe | DONE | Yes | Yes | Unknown | No | Partial | Tori | Probe exists. |
| Add Twilio readiness/config probe | DONE | Yes | Yes | Unknown | No | Partial | Tori | Probe exists. |
| Add health check orchestrator | DONE | Yes | Yes | Unknown | No | Partial | Tori | Orchestrator exists. |
| Add health tests | DONE | Yes | Yes | Unknown | No | No | Tori | Unit/route tests exist. |
| Verify provider live checks enabled in deployed env | TODO | No | No | No | No | No | Tori | `HEALTH_CHECK_PROVIDERS_LIVE` must be true in deployed env for real provider calls. |
| Add replica lag readiness check | TODO | No | No | No | No | No | Tori | Read-replica client code exists; lag check not verified. |

## Runbooks and dashboards

| Item | Status | Implemented | Tested locally | Tested in CI | Verified deployed | Operationalized | Owner | Notes |
|---|---|---:|---:|---:|---:|---:|---|---|
| Add runbook directory and README | DONE | Yes | N/A | N/A | N/A | Partial | Tori | Docs exist. |
| Add dependency outage/degradation runbooks | DONE | Yes | N/A | N/A | N/A | Partial | Tori | Postgres, Redis, Storage, Stripe, Postmark, Twilio docs exist. |
| Add notification backlog runbook | DONE | Yes | N/A | N/A | N/A | Partial | Tori | Runbook exists. |
| Add launch dashboard checklist | DONE | Yes | N/A | N/A | N/A | Partial | Tori | Checklist exists. |
| Add actual dashboard panels in chosen observability tool | TODO | No | No | No | No | No | Tori | Checklist only; external dashboard not verified. |
| Add alert rules for health/readiness dependencies | TODO | No | No | No | No | No | Tori | Alert rules not wired. |
| Add notification backlog metric implementation if not already queryable | TODO | Unknown | No | No | No | No | Tori | Needs verification. |
| Add deployment marker integration | TODO | No | No | No | No | No | Tori | Sentry release/deploy tagging missing. |
| Add incident owner/escalation policy | TODO | No | No | No | No | No | Tori | Missing oncall/ownership doc. |
| Add notification version polling endpoint if choosing polling for launch | TODO | No | No | No | No | No | Tori | Needs decision. |
| Decide whether to remove, rename, or complete dead Redis publisher path | TODO | Unknown | No | No | No | No | Tori | Existing cache-version bump is not a complete realtime subscriber. |
| Decide mobile push strategy | TODO | No | No | No | No | No | Tori | Needs product/ops decision. |

## Acceptance criteria

- `/api/health/live` returns app liveness only.
- `/api/health/ready` checks all dependencies.
- Postgres failure makes readiness down.
- Redis failure makes readiness degraded.
- Storage failure makes readiness degraded.
- Stripe config/provider failure makes readiness degraded.
- Postmark config/provider failure makes readiness degraded.
- Twilio config/provider failure makes readiness degraded.
- Probe timeout does not crash endpoint.
- Tests cover ok/degraded/down behavior.
- Runbooks exist for each dependency.
- Dashboard checklist exists and maps alerts to runbooks.
- Production monitor is configured to hit `/api/health/live`.
- Production monitor is configured to hit `/api/health/ready`.
- Production alerts are configured.
- Pager/oncall ownership is documented and tested.

---

# Sprint 5 — Edge-flow audit

## Goal

Harden token, claim, NFC, and short-code flows.

## Items

| Item | Status | Implemented | Tested locally | Tested in CI | Verified deployed | Operationalized | Owner | Notes |
|---|---|---:|---:|---:|---:|---:|---|---|
| Add NFC tap-card tests | DONE | Yes | Yes | Unknown | No | No | Tori | Tests exist. |
| Add short-code redirect tests | DONE | Yes | Yes | Unknown | No | No | Tori | Tests exist. |
| Add NFC trust-boundary doc | DONE | Yes | N/A | N/A | N/A | Partial | Tori | Doc exists. |
| Add claim-flow audit doc | DONE | Yes | N/A | N/A | N/A | Partial | Tori | Doc exists. |
| Migrate ProClientInvite token to tokenHash for new/primary lookup paths | DONE | Yes | Yes | Unknown | No | No | Tori | TokenHash path exists. |
| Add tap-code rate limiting | TODO | No | No | No | No | No | Tori | Still missing. |
| Prove NFC/short-code entry points are evaluated by Pro readiness policy | DONE | Yes | Yes | Unknown | No | No | Tori | Readiness policy proof exists. |
| Prove claim accept is idempotent | IN PROGRESS | Partial | Partial | Unknown | No | No | Tori | More replay proof needed. |
| Add wrong-user/already-claimed claim behavior tests | DONE | Yes | Yes | Unknown | No | No | Tori | Tests exist. |
| Add revoked claim behavior tests | DONE | Yes | Yes | Unknown | No | No | Tori | Tests exist. |
| Add NFC tenant inheritance | TODO | No | No | No | No | No | Tori | Current NFC schema has `salonSlug`, not tenant FK. |

## Acceptance criteria

- NFC/tap tokens are non-enumerable by design; rate-limit proof still pending.
- Revoked links fail safely; explicit expired-state proof still pending.
- Wrong-user/already-claimed claim behavior is explicit.
- Claim accept handles already-claimed/revoked states; replay/idempotency proof still pending.
- NFC/tap flow cannot bypass readiness policy evaluation.
- Public/token routes are rate limited where listed in rate-limit coverage.
- White-label NFC cards inherit tenant identity once WS-1 exists.

---

# Sprint 6 — Load, chaos, and launch rehearsal

## Goal

Prove the system survives traffic, retries, provider outages, and launch operations.

## Items

| Item | Status | Implemented | Tested locally | Tested in CI | Verified deployed | Operationalized | Owner | Notes |
|---|---|---:|---:|---:|---:|---:|---|---|
| Add lifecycle smoke test | DONE | Yes | Yes | Unknown | No | No | Tori | Smoke test exists. |
| Add authVersion enforcement test | DONE | Yes | Yes | Unknown | No | No | Tori | Test exists. |
| Add booking concurrency integration test | DONE | Yes | Yes | Unknown | No | No | Tori | Overlap/concurrency proof exists. |
| Add full booking lifecycle E2E | IN PROGRESS | Partial | Partial | Unknown | No | No | Tori | API-assisted flow exists; signup/search/hold/finalize browser path pending. |
| Add broad retry/idempotency suite | TODO | Partial | Partial | Unknown | No | No | Tori | Several route tests exist; full suite missing. |
| Add load-test scaffolding | IN PROGRESS | Partial | Partial | No | No | No | Tori | Signup load test exists only. |
| Add booking finalize load test | TODO | No | No | No | No | No | Tori | Missing. |
| Add availability load test | TODO | No | No | No | No | No | Tori | Missing. |
| Add media upload load test | TODO | No | No | No | No | No | Tori | Missing. |
| Add Stripe webhook replay storm test | TODO | No | No | No | No | No | Tori | Missing. |
| Add Redis outage chaos test | TODO | No | No | No | No | No | Tori | Missing. |
| Add Postmark outage chaos test | TODO | No | No | No | No | No | Tori | Missing. |
| Add Twilio outage chaos test | TODO | No | No | No | No | No | Tori | Missing. |
| Add Supabase Storage outage chaos test | TODO | No | No | No | No | No | Tori | Missing. |
| Add private beta checklist | TODO | No | No | No | No | No | Tori | Missing. |
| Add staged public rollout checklist | TODO | No | No | No | No | No | Tori | Missing. |
| Add final risk register | TODO | No | No | No | No | No | Tori | Missing. |
| Add launch go/no-go review doc | TODO | No | No | No | No | No | Tori | Missing. |

## Key files to add later

- `tests/load/booking-finalize-load-test.ts`
- `tests/load/availability-load-test.ts`
- `tests/load/media-upload-load-test.ts`
- `tests/load/stripe-webhook-replay-load-test.ts`
- `tests/chaos/redis-outage.test.ts`
- `tests/chaos/provider-outage.test.ts`
- `docs/launch-readiness/private-beta-checklist.md`
- `docs/launch-readiness/public-rollout-checklist.md`
- `docs/launch-readiness/risk-register.md`
- `docs/launch-readiness/go-no-go.md`

## Acceptance criteria

- Full happy path has API-assisted E2E coverage; Pro signup/search/hold/finalize browser path still pending.
- Retry suite proves no duplicate side effects.
- Load tests meet p95 targets.
- Chaos tests prove graceful degradation.
- Private beta checklist exists.
- Public rollout checklist exists.
- Go/no-go review is complete.

---

# Database and performance review

## Goal

Prove hot data paths are indexed and booking overlap is impossible.

## Items

| Item | Status | Implemented | Tested locally | Tested in CI | Verified deployed | Operationalized | Owner | Notes |
|---|---|---:|---:|---:|---:|---:|---|---|
| Decide DB no-overlap constraint strategy | DONE | Yes | Yes | Unknown | No | Partial | Tori | Strategy decided and tested locally. |
| Test overlapping appointment ranges, not just identical `scheduledFor` values | DONE | Yes | Yes | Unknown | No | No | Tori | Integration coverage exists. |
| Review hot query indexes | IN PROGRESS | Partial | No | No | No | No | Tori | More EXPLAIN work needed. |
| Review notification inbox indexes | TODO | No | No | No | No | No | Tori | Missing. |
| Review booking dashboard query plans | TODO | No | No | No | No | No | Tori | Missing. |
| Review availability query plans | TODO | No | No | No | No | No | Tori | Missing. |
| Add EXPLAIN ANALYZE notes for hot paths | TODO | No | No | No | No | No | Tori | Missing. |
| Create schema cleanup plan | TODO | No | No | No | No | No | Tori | Missing. |
| Verify read-replica production config | TODO | Unknown | No | No | No | No | Tori | Code supports `DATABASE_URL_READ`; env must be verified. |

## Hot paths

- `/api/availability/bootstrap`
- `/api/holds`
- `/api/bookings/finalize`
- `/api/pro/bookings`
- `/api/pro/bookings/[id]`
- `/api/pro/bookings/[id]/media`
- `/api/pro/bookings/[id]/aftercare`
- `/api/webhooks/stripe`
- notification processor

---

# Compliance and privacy

## Goal

Document and reduce privacy/security risk before public launch.

## Items

| Item | Status | Implemented | Tested locally | Tested in CI | Verified deployed | Operationalized | Owner | Notes |
|---|---|---:|---:|---:|---:|---:|---|---|
| Add data classification doc | DONE | Yes | N/A | N/A | N/A | Partial | Tori | Doc exists; review/sign-off still needed. |
| Add PII encryption strategy | DONE | Yes | N/A | N/A | N/A | Partial | Tori | Roadmap exists; runtime implementation incomplete. |
| Add retention policy | IN PROGRESS | Partial | N/A | N/A | N/A | No | Tori | Needs review. |
| Add data export/delete plan | DONE | Yes | N/A | N/A | N/A | Partial | Tori | Doc exists; implementation not verified. |
| Implement data export/delete code | TODO | No | No | No | No | No | Tori | Need `lib/privacy/exportUserData.ts` and `deleteUserData.ts` or equivalent. |
| Add media deletion policy | DONE | Yes | N/A | N/A | N/A | Partial | Tori | Policy exists; storage update/delete proof caveat remains. |
| Add secret rotation runbook | IN PROGRESS | Partial | N/A | N/A | N/A | No | Tori | Verify current doc state before marking done. |
| Add admin access review process | IN PROGRESS | Partial | Partial | Unknown | No | No | Tori | Scoped permission checks exist; policy review still needed. |
| Add privacy incident response plan | IN PROGRESS | Partial | N/A | N/A | N/A | No | Tori | Private media incident runbook exists; full privacy incident process needs review. |
| Document SHA-256 vs HMAC contact hash decision | IN PROGRESS | Yes | N/A | N/A | N/A | No | Tori | Threat model doc exists; code still uses SHA-256; HMAC is future migration. |
| Create canonical contact normalizer | TODO | No | No | No | No | No | Tori | Needed before HMAC migration. |
| Add audit payload redaction | TODO | No | No | No | No | No | Tori | `oldValue`/`newValue` JSON can carry PII. |
| Wire ClientAddress encrypted address writes | DONE | Yes | Yes | Unknown | No | No | Tori | Create/update paths use address privacy write data. |
| Wire ProfessionalLocation encrypted address writes | DONE | Yes | Yes | Unknown | No | No | Tori | Create/update/onboarding/offerings paths wired. |
| Wire BookingHold/Booking dedicated encrypted snapshot columns | DONE | Yes | Yes | Yes | No | No | Tori | PR #40 + PR #41 merged; local lib/booking suite passed 41 files / 371 tests. |
| Prevent legacy plaintext snapshots from entering dedicated encrypted columns | DONE | Yes | Yes | Yes | No | No | Tori | PR #41 validates envelope shape and writes `Prisma.JsonNull` for plaintext-only legacy snapshots. |
| Coarsen BookingHold/Booking approximate coordinates | DONE | Yes | Yes | Yes | No | No | Tori | PR #41 routes approx fields through shared coarsening helper. |
| Add centralized address read/decrypt helpers | TODO | Partial | No | No | No | No | Tori | Write helper exists; decrypt/read seam missing. |
| Swap address envelope to real AEAD | TODO | No | No | No | No | No | Tori | `algorithm` still `plaintext-json-expand-phase`. |
| Backfill historical BookingHold/Booking dedicated encrypted snapshot fields | TODO | No | No | No | No | No | Tori | Needed before reader cut-over / contraction. |
| Cut readers over to dedicated encrypted snapshot columns | TODO | No | No | No | No | No | Tori | Requires backfill and burn-in window. |
| Drop legacy snapshot columns after burn-in | TODO | No | No | No | No | No | Tori | Future contraction task. |
| HMAC contact hash v2 migration | TODO | No | No | No | No | No | Tori | Needed before public launch. |
| Encrypt Tier-2 identity fields | TODO | No | No | No | No | No | Tori | Name, DOB, bio still in future Phase 12 work. |

## Key docs

- `docs/security/data-classification.md`
- `docs/security/pii-encryption-roadmap.md`
- `docs/security/user-data-export-delete.md`
- `docs/runbooks/private-media-incident.md`
- `docs/security/retention-policy.md`
- `docs/security/secret-rotation.md`
- `docs/security/privacy-incident-response.md`
- `docs/security/contact-lookup-hash-threat-model.md`
- `docs/launch-readiness/test-proof.md`

---

# Storage and media proof

## Goal

Prove media-private storage cannot be directly accessed, updated, or deleted outside intended server-mediated paths.

## Items

| Item | Status | Implemented | Tested locally | Tested in CI | Verified deployed | Operationalized | Owner | Notes |
|---|---|---:|---:|---:|---:|---:|---|---|
| Storage policy proof doc exists | DONE | Yes | Yes | N/A | No | Partial | Tori | `docs/launch-readiness/storage-policy-proof.md` exists. |
| Anonymous direct read/list media-private denied | DONE | Yes | Yes | N/A | No | Partial | Tori | Proof documented. |
| Authenticated direct read/list media-private denied unless intentionally allowed | DONE | Yes | Yes | N/A | No | Partial | Tori | Proof documented. |
| Anonymous direct update/delete media-private denied | TODO | No | No | No | No | No | Tori | Caveat still open. |
| Authenticated direct update/delete media-private denied unless intentionally allowed | TODO | No | No | No | No | No | Tori | Caveat still open. |
| Add media write boundary | TODO | No | No | No | No | No | Tori | Needed for single source of truth. |
| Consolidate signed URL TTL constants | TODO | Unknown | No | No | No | No | Tori | Verify drift and centralize. |
| Add UploadSession binding | TODO | No | No | No | No | No | Tori | Required before public launch if uploads are in scope. |

---

# Session refresh / realtime MVP

## Goal

The Pro session screen updates when client/session/payment state changes without manual refresh.

## Items

| Item | Status | Implemented | Tested locally | Tested in CI | Verified deployed | Operationalized | Owner | Notes |
|---|---|---:|---:|---:|---:|---:|---|---|
| Add Pro session state endpoint | TODO | No | No | No | No | No | Tori | `app/api/pro/bookings/[id]/session/state/route.ts` does not exist. |
| Add active-session polling to Pro session UI | TODO | No | No | No | No | No | Tori | No polling/SWR refresh pattern found. |
| Pause/slow polling when tab hidden | TODO | No | No | No | No | No | Tori | Depends on polling implementation. |
| Stop polling on completed/cancelled terminal state | TODO | No | No | No | No | No | Tori | Depends on polling implementation. |
| Decide Redis publisher strategy | TODO | Partial | No | No | No | No | Tori | Existing cache-version bump is not session realtime. |

---

# White-label SaaS readiness

## Goal

Make TOVIS tenant-aware, partner-brandable, and enterprise-handoff ready.

## Items

| Item | Status | Implemented | Tested locally | Tested in CI | Verified deployed | Operationalized | Owner | Notes |
|---|---|---:|---:|---:|---:|---:|---|---|
| Create tenant model decision doc | TODO | No | No | No | No | No | Tori | Add `docs/product/tenant-model.md`. |
| Add `Tenant` model | TODO | No | No | No | No | No | Tori | Not implemented. |
| Add `tovis-root` tenant seed | TODO | No | No | No | No | No | Tori | Required for migration/backfill. |
| Add `homeTenantId` columns | TODO | No | No | No | No | No | Tori | Required for Pro/Client tenant ownership. |
| Add `Booking.proTenantId` and `Booking.clientHomeTenantId` | TODO | No | No | No | No | No | Tori | Required for revenue and analytics attribution. |
| Add tenant resolver | TODO | No | No | No | No | No | Tori | Add `lib/tenant/resolveTenant.ts`. |
| Add tenant visibility helper | TODO | No | No | No | No | No | Tori | Add `lib/tenant/visibilityFilter.ts`. |
| Add tenant-aware discovery CI guard | TODO | No | No | No | No | No | Tori | Add `tools/check-tenant-aware-discovery.mjs`. |
| Replace NFC `salonSlug` with tenant reference | TODO | Partial | No | No | No | No | Tori | Current schema has `salonSlug`; no tenant FK. |
| Add NFC tenant inheritance | TODO | No | No | No | No | No | Tori | NFC cards should inherit issuing pro tenant. |
| Add tenant-specific brand resolution | TODO | Partial | No | No | No | No | Tori | Brand module has seam, but only Tovis is registered. |
| Add hardcoded brand string guard | TODO | No | No | No | No | No | Tori | At least `BRAND_PREFIX = 'TOVIS'` remains. |
| Add custom-domain tenant resolution | TODO | Partial | No | No | No | No | Tori | Middleware has subdomain rewrite but no tenant model/resolution. |
| Add tenant-specific Postmark/Twilio sender identity | TODO | No | No | No | No | No | Tori | Required for white-label comms. |
| Add A2P 10DLC per-tenant plan | TODO | No | No | No | No | No | Tori | External carrier approval can take weeks. |
| Add tenant-specific Stripe/revenue attribution | TODO | No | No | No | No | No | Tori | Add `Tenant.stripeMode` and payment write boundary. |
| Add partner admin/support roles | TODO | No | No | No | No | No | Tori | Required for enterprise handoff. |
| Add partner onboarding workflow | TODO | No | No | No | No | No | Tori | Required before white-label beta. |

---

# Rollout and feature flags

## Goal

Launch gradually and safely.

## Items

| Item | Status | Implemented | Tested locally | Tested in CI | Verified deployed | Operationalized | Owner | Notes |
|---|---|---:|---:|---:|---:|---:|---|---|
| Document runtime flags | TODO | No | No | No | No | No | Tori | Missing. |
| Decide percentage rollout strategy | TODO | No | No | No | No | No | Tori | Missing. |
| Decide segment/geography rollout strategy | TODO | No | No | No | No | No | Tori | Missing. |
| Add private dogfood checklist | TODO | No | No | No | No | No | Tori | Missing. |
| Add private beta checklist | TODO | No | No | No | No | No | Tori | Missing. |
| Add staged public rollout plan | TODO | No | No | No | No | No | Tori | Missing. |
| Add rollback plan | IN PROGRESS | Yes | N/A | N/A | No | Partial | Tori | Rollback template exists; drilled rollback plan missing. |
| Add support launch script | TODO | No | No | No | No | No | Tori | Missing. |
| Add risk register | TODO | No | No | No | No | No | Tori | Missing. |
| Add go/no-go review doc | TODO | No | No | No | No | No | Tori | Missing. |

## Launch stages

1. Internal dogfood.
2. 5 trusted Pros.
3. 25 Pros in one region.
4. 100 Pros controlled beta.
5. Public waitlist.
6. Broader public launch.

---

# Proof suite and evidence

## Goal

Record proof against specific commits and environments.

## Items

| Item | Status | Implemented | Tested locally | Tested in CI | Verified deployed | Operationalized | Owner | Notes |
|---|---|---:|---:|---:|---:|---:|---|---|
| Create `test-proof.md` | DONE | Yes | Yes | No | No | No | Tori | `docs/launch-readiness/test-proof.md` exists and records launch proof runs. |
| Record commit SHA, date, environment, command, result, known skips | IN PROGRESS | Yes | Yes | Partial | No | No | Tori | More areas need proof entries. |
| Record focused safe-logging route proof | DONE | Yes | Yes | No | No | No | Tori | Commit `8f2a424`; local route suite passed 11 files / 153 tests. |
| Record contact hash decision proof | DONE | Yes | N/A | N/A | N/A | No | Tori | Threat model doc exists; HMAC migration deferred. |
| Record BookingHold/Booking encrypted snapshot proof | DONE | Yes | Yes | Yes | No | No | Tori | PR #40 + PR #41; merge commit `89ce836`; local lib/booking suite passed 41 files / 371 tests. |
| Record full lifecycle proof | TODO | Partial | Partial | No | No | No | Tori | Tests exist but proof entry still missing. |
| Record load/chaos proof | TODO | No | No | No | No | No | Tori | Missing. |
| Record deployed health/readiness proof | TODO | No | No | No | No | No | Tori | Needs staging/production proof. |
| Record deployed storage policy proof | TODO | Partial | No | No | No | No | Tori | Repo proof exists; deployed proof missing. |

---

# Final launch gate

Do not launch publicly until every item below is true.

| Gate | Status | Notes |
|---|---|---|
| Core booking/session flow has API-assisted E2E coverage | IN PROGRESS | Staging/prod execution evidence still needed. |
| Health live/ready endpoints are deployed | TODO | Code exists; deployed verification needed. |
| Production monitors watch live and ready endpoints | TODO | Not wired. |
| Runbooks exist and are linked from alerts | IN PROGRESS | Runbooks exist; alert linking missing. |
| Dashboard exists with critical panels | TODO | Checklist only. |
| Storage RLS policies are deployed and verified | TODO | Repo proof exists; deployed proof missing. |
| High-risk route rate limits are enforced in code | DONE | Code coverage exists. |
| Auth/SMS routes fail safely under abuse/backing-service failure | DONE | Local proof exists. |
| Pro readiness/onboarding gates are enforced in code | DONE | Code coverage exists. |
| Realtime or polling strategy is implemented | TODO | Missing. |
| Payment/Stripe webhook replay is proven idempotent | IN PROGRESS | Code/test proof exists; replay storm/load proof missing. |
| Full retry/idempotency suite passes | TODO | Partial route coverage only. |
| Load tests pass target thresholds | TODO | Signup-only load exists; hot-path suite missing. |
| Chaos tests pass for Redis/provider outages | TODO | Missing. |
| Privacy/compliance docs exist | DONE | Review/sign-off incomplete. |
| Privacy runtime writes are complete | IN PROGRESS | Client/pro location writes and BookingHold/Booking snapshot writes are done; AEAD/backfill/read cut-over/contraction remain. |
| Tenant data isolation is implemented | TODO | Missing. |
| White-label tenant branding/comms/payments are implemented | TODO | Missing. |
| Rollout and rollback plans exist | IN PROGRESS | Rollback template exists; rollout/go-no-go/risk docs missing. |
| Support has launch scripts and escalation paths | TODO | Missing. |
| Go/no-go review is complete | TODO | Missing. |

---

# Current sprint summary

## Completed recently

- Harden booking route error logging.
- Remove raw `console.error(..., error)` matches in booking/session route scope.
- Add/adjust focused route tests for safe logging.
- Run focused booking route suite locally: 11 files, 153 tests passed.
- Run typecheck locally.
- Commit safe logging hardening: `8f2a424`.
- Document SHA-256 vs HMAC contact hash decision.
- Complete contact lookup hash threat model: `docs/security/contact-lookup-hash-threat-model.md`.
- Wire BookingHold/Booking dedicated encrypted snapshot columns in PR #40.
- Correct BookingHold/Booking encrypted snapshot write contract in PR #41.
- Prevent legacy plaintext snapshots from being copied into dedicated encrypted columns.
- Coarsen BookingHold/Booking approximate coordinates.
- Sanitize hold-create internal error logging without double-sanitizing `safeError(error)`.
- Run focused write-boundary suite locally: 3 files, 31 tests passed.
- Run `pnpm vitest run lib/booking` locally: 41 files, 371 tests passed.
- Run `pnpm typecheck` locally.
- Record safe-logging, contact-hash, and encrypted snapshot proof in `docs/launch-readiness/test-proof.md`.
- Merge PR #41 into main: merge commit `89ce836`.

## Next priority

1. Resolve current modified docs.
2. Add Sentry release marker and decide Sentry console log strategy.
3. Verify provider live checks in deployed env.
4. Create `idempotency-map.md`.
5. Replace the 3 remaining `as unknown as` sites with typed helpers.
6. Add `check-no-type-escape.mjs`.
7. Add centralized contact normalizer.
8. Add audit payload redaction.
9. Add centralized address read/decrypt helpers.
10. Add AEAD address envelope and backfill plan.
11. Add Pro session state endpoint.
12. Add active-session polling.
13. Finish storage media-private update/delete proof.
14. Record full lifecycle proof in `docs/launch-readiness/test-proof.md`.
15. Add load/chaos proof entries when those tests exist.

## Then run

```bash
git diff --check
pnpm typecheck
pnpm test
git status
git diff --stat