# TOVIS Launch Readiness Checklist

This checklist tracks the launch-hardening work required before a serious public launch.

Use this file as the source of truth for launch readiness. Do not mark an item done unless the implementation exists, tests/docs exist where appropriate, and the linked files are committed.

## Status legend

| Status | Meaning |
|---|---|
| `TODO` | Not started or not proven. |
| `IN PROGRESS` | Partially implemented. |
| `DONE` | Implemented, tested/documented where appropriate, and committed. |
| `BLOCKED` | Cannot move forward until a dependency/decision is resolved. |
| `DEFERRED` | Intentionally postponed beyond launch-readiness scope. |
| `[~]` | Partial evidence exists, but production-grade proof is still missing. |

---

# Overall launch status

```text
Core product flow: mostly wired
Launch readiness: in progress
Current focus: Production proof / realtime refresh / load + chaos / rollout
```

## Launch blocker tracker

```text
[ ] Full lifecycle regression suite
[x] Pro onboarding/readiness hard gate
[x] High-risk booking/token/media/auth rate-limit enforcement
[x] Origin/Referer checks
[ ] Realtime/session refresh strategy
[~] Full booking lifecycle E2E exists; staging/prod execution evidence still needed
[ ] Load tests for booking/availability/media
[ ] Chaos tests for Redis/provider outages
[~] Compliance/privacy docs exist; owner review and encryption implementation still needed
[ ] Rollout/go-no-go plan
```

---

# Sprint 1 — Core workflow correctness

Goal:

```text
Make the booking/session lifecycle impossible to complete incorrectly.
```

## Items

```text
[DONE] Replace misleading "Complete session" UI with closeout-aware action.
[DONE] Remove direct UI-driven SessionStep.DONE transition.
[DONE] Surface backend closeout blockers in the Pro session flow.
[DONE] Keep backend direct DONE transition blocked.
[DONE] Add smoke coverage for booking closeout flow.
[TODO] Add full lifecycle action regression suite.
[TODO] Add staging/prod lifecycle telemetry soak.
```

## Key files

```text
app/pro/bookings/[id]/session/page.tsx
lib/booking/writeBoundary.ts
lib/booking/lifecycleContract.ts
tests/e2e/booking-lifecycle-smoke.spec.ts
tests/e2e/booking-lifecycle.spec.ts
```

## Acceptance criteria

```text
[x] Pro cannot trigger direct DONE transition from the UI.
[x] Pro sees blockers when aftercare/payment/checkout/after-photo requirements are missing.
[x] Booking completion only happens through backend closeout rules.
[ ] Every visible lifecycle action has a regression test.
```

---

# Sprint 2 — Token and retry safety

Goal:

```text
Use secure action-token flows and make retryable mutations safe.
```

## Items

```text
[DONE] Move active aftercare/rebook paths to ClientActionToken.
[DONE] Add active-path guard against aftercare.publicToken usage.
[DONE] Add rebook token GET/POST behavior coverage.
[DONE] Add token-scoped rebook idempotency.
[DONE] Add claim/NFC path tests and docs.
[IN PROGRESS] Keep legacy AftercareSummary.publicToken only as deprecated schema field.
[TODO] Create idempotency route map document.
[DONE] Prove aftercare send atomicity.
[DONE] Migrate raw ProClientInvite.token to tokenHash for new/primary lookup paths.
[DONE] Prove cancel/reschedule idempotency in route tests.
```

## Key files

```text
lib/aftercare/unclaimedAftercareAccess.ts
app/api/client/rebook/[token]/route.ts
app/client/bookings/[id]/page.tsx
app/api/pro/bookings/[id]/aftercare/route.ts
prisma/schema.prisma
lib/booking/writeBoundary.aftercareAtomicity.test.ts
lib/clients/clientClaimLinks.test.ts
app/api/bookings/[id]/cancel/route.test.ts
app/api/bookings/[id]/reschedule/route.test.ts
```

## Acceptance criteria

```text
[x] New active aftercare links use ClientActionToken.
[x] Active client/pro payloads do not expose legacy publicToken.
[x] Rebook token flows are idempotent.
[x] Cancel/reschedule mutations are idempotent.
[x] Invite/claim tokens are hashed at rest for new/primary flows.
```

---

# Sprint 3 — Security foundations

Goal:

```text
Harden storage, media, rate limits, and request trust boundaries.
```

## Items

```text
[DONE] Add Supabase Storage bucket/policy migration as code.
[DONE] Add media-private restrictive policy baseline.
[DONE] Add media-public policy baseline.
[DONE] Add central rate-limit policy definitions.
[TODO] Add Supabase policy SQL tests.
[TODO] Verify live Supabase bucket policies after deploy.
[DONE] Add high-risk route/wrapper rate-limit enforcement.
[DONE] Add auth route rate limits.
[DONE] Add SMS route rate limits.
[DONE] Add SMS fail-closed behavior when Redis/rate limit backend is unavailable.
[DONE] Add token route rate limits.
[DONE] Add media route rate limits.
[DONE] Add Origin/Referer checks for state-changing cookie-authenticated requests.
[DONE] Add before/after media upload audit write-path verification.
[TODO] Add upload-token binding proof.
[TODO] Add orphan media cleanup.
[TODO] Add media scan/moderation flow or explicit deferral.
```

## Key files

```text
supabase/migrations/20260514180000_storage_media_bucket_policies.sql
lib/rateLimit/policies.ts
lib/rateLimit/enforce.ts
middleware.ts
app/api/auth/*
app/api/pro/uploads/route.ts
app/api/pro/bookings/[id]/media/route.ts
docs/launch-readiness/rate-limit-coverage.md
```

## Acceptance criteria

```text
[x] Private media cannot be anonymously listed/read in repo policy proof.
[x] Storage policy is committed and deployable.
[x] Auth/SMS/token/media routes are rate limited.
[x] SMS abuse routes fail closed when required.
[x] State-changing cookie-auth routes validate Origin/Referer or documented CSRF strategy.
[~] Media upload has audit trail; delete/replacement proof still pending.
```

---

# Sprint 4 — Ops readiness

Goal:

```text
Make the app observable, diagnosable, and operable during production incidents.
```

## Health endpoints and probes

```text
[DONE] Add /api/health/live endpoint.
[DONE] Add /api/health/ready endpoint.
[DONE] Keep /api/health as compatibility alias for readiness.
[DONE] Add shared health response types.
[DONE] Add health summary/status-code logic.
[DONE] Add Postgres readiness probe.
[DONE] Add Redis readiness probe.
[DONE] Add Supabase Storage readiness probe.
[DONE] Add Stripe readiness/config probe.
[DONE] Add Postmark readiness/config probe.
[DONE] Add Twilio readiness/config probe.
[DONE] Add health check orchestrator.
[DONE] Add health summary tests.
[DONE] Add health orchestrator tests.
[DONE] Add /api/health/live route tests.
[DONE] Add /api/health/ready route tests.
```

## Runbooks and dashboards

```text
[DONE] Add runbook directory.
[DONE] Add runbook README.
[DONE] Add health readiness runbook.
[DONE] Add Postgres outage runbook.
[DONE] Add Redis outage runbook.
[DONE] Add Supabase Storage outage runbook.
[DONE] Add Stripe degradation runbook.
[DONE] Add Postmark degradation runbook.
[DONE] Add Twilio degradation runbook.
[DONE] Add notification backlog runbook.
[DONE] Add launch dashboard checklist.
```

## Still missing in ops readiness

```text
[TODO] Add actual dashboard panels in chosen observability tool.
[TODO] Add alert rules for health/readiness dependencies.
[TODO] Add notification backlog metric implementation if not already queryable.
[TODO] Add deployment marker integration.
[TODO] Add incident owner/escalation policy.
[TODO] Add realtime/session refresh strategy.
[TODO] Add notification version polling endpoint if choosing polling for launch.
[TODO] Add session state refresh wiring.
[TODO] Decide whether to remove, rename, or complete dead Redis publisher path.
[TODO] Decide mobile push strategy.
```

## Files added

```text
lib/health/types.ts
lib/health/summary.ts
lib/health/postgres.ts
lib/health/redis.ts
lib/health/storage.ts
lib/health/stripe.ts
lib/health/postmark.ts
lib/health/twilio.ts
lib/health/checks.ts

app/api/health/live/route.ts
app/api/health/ready/route.ts
app/api/health/route.ts

lib/health/summary.test.ts
lib/health/checks.test.ts
app/api/health/live/route.test.ts
app/api/health/ready/route.test.ts

docs/runbooks/README.md
docs/runbooks/health-readiness.md
docs/runbooks/postgres-outage.md
docs/runbooks/redis-outage.md
docs/runbooks/supabase-storage-outage.md
docs/runbooks/stripe-degradation.md
docs/runbooks/postmark-degradation.md
docs/runbooks/twilio-degradation.md
docs/runbooks/notification-backlog.md

docs/launch-readiness/dashboard-checklist.md
```

## Acceptance criteria

```text
[x] /api/health/live returns app liveness only.
[x] /api/health/ready checks all dependencies.
[x] Postgres failure makes readiness down.
[x] Redis failure makes readiness degraded.
[x] Storage failure makes readiness degraded.
[x] Stripe config/provider failure makes readiness degraded.
[x] Postmark config/provider failure makes readiness degraded.
[x] Twilio config/provider failure makes readiness degraded.
[x] Probe timeout does not crash endpoint.
[x] Tests cover ok/degraded/down behavior.
[x] Runbooks exist for each dependency.
[x] Dashboard checklist exists and maps alerts to runbooks.
[ ] Production monitor is configured to hit /api/health/live.
[ ] Production monitor is configured to hit /api/health/ready.
```

---

# Sprint 5 — Edge-flow audit

Goal:

```text
Harden token, claim, NFC, and short-code flows.
```

## Items

```text
[DONE] Add NFC tap-card tests.
[DONE] Add short-code redirect tests.
[DONE] Add NFC trust-boundary doc.
[DONE] Add claim-flow audit doc.
[DONE] Migrate ProClientInvite token to tokenHash for new/primary lookup paths.
[TODO] Add tap-code rate limiting.
[DONE] Prove NFC/short-code entry points are evaluated by Pro readiness policy.
[IN PROGRESS] Prove claim accept is idempotent.
[DONE] Add wrong-user/already-claimed claim behavior tests.
[DONE] Add revoked claim behavior tests.
```

## Key files

```text
app/t/[cardId]/page.tsx
app/c/[code]/
app/claim/[token]/page.tsx
lib/clientClaims/*
prisma/schema.prisma
```

## Acceptance criteria

```text
[~] NFC/tap tokens are non-enumerable by design; rate-limit proof still pending.
[~] Revoked links fail safely; explicit expired-state proof still pending.
[x] Wrong-user/already-claimed claim behavior is explicit.
[~] Claim accept handles already-claimed/revoked states; replay/idempotency proof still pending.
[x] NFC/tap flow cannot bypass readiness policy evaluation.
[x] Public/token routes are rate limited where listed in rate-limit coverage.
```

---

# Sprint 6 — Load, chaos, and launch rehearsal

Goal:

```text
Prove the system survives traffic, retries, provider outages, and launch operations.
```

## Items

```text
[DONE] Add lifecycle smoke test.
[DONE] Add authVersion enforcement test.
[DONE] Add booking concurrency integration test.
[IN PROGRESS] Add full booking lifecycle E2E. API-assisted flow exists; signup/search/hold/finalize browser path still pending.
[TODO] Add broad retry/idempotency suite.
[IN PROGRESS] Add load-test scaffolding. Signup load test exists; booking/availability/media load tests still pending.
[TODO] Add k6 booking finalize load test.
[TODO] Add k6 availability load test.
[TODO] Add k6 media upload load test.
[TODO] Add Stripe webhook replay storm test.
[TODO] Add Redis outage chaos test.
[TODO] Add Postmark outage chaos test.
[TODO] Add Twilio outage chaos test.
[TODO] Add Supabase Storage outage chaos test.
[TODO] Add private beta checklist.
[TODO] Add staged public rollout checklist.
[TODO] Add final risk register.
[TODO] Add launch go/no-go review doc.
```

## Key files to add later

```text
tests/e2e/booking-lifecycle.spec.ts
tests/load/booking-finalize-load-test.ts
tests/load/availability-load-test.ts
tests/load/media-upload-load-test.ts
tests/chaos/redis-outage.test.ts
tests/chaos/provider-outage.test.ts
docs/launch-readiness/private-beta-checklist.md
docs/launch-readiness/public-rollout-checklist.md
docs/launch-readiness/risk-register.md
docs/launch-readiness/go-no-go.md
```

## Acceptance criteria

```text
[~] Full happy path has API-assisted E2E coverage; Pro signup/search/hold/finalize browser path still pending.
[ ] Retry suite proves no duplicate side effects.
[ ] Load tests meet p95 targets.
[ ] Chaos tests prove graceful degradation.
[ ] Private beta checklist exists.
[ ] Public rollout checklist exists.
[ ] Go/no-go review is complete.
```

---

# Database and performance review

Goal:

```text
Prove hot data paths are indexed and booking overlap is impossible.
```

## Items

```text
[DONE] Decide DB no-overlap constraint strategy.
[DONE] Test overlapping appointment ranges, not just identical scheduledFor values.
[IN PROGRESS] Review hot query indexes.
[TODO] Review notification inbox indexes.
[TODO] Review booking dashboard query plans.
[TODO] Review availability query plans.
[TODO] Add EXPLAIN ANALYZE notes for hot paths.
[TODO] Create schema cleanup plan.
```

## Hot paths

```text
/api/availability/bootstrap
/api/holds
/api/bookings/finalize
/api/pro/bookings
/api/pro/bookings/[id]
/api/pro/bookings/[id]/media
/api/pro/bookings/[id]/aftercare
/api/webhooks/stripe
notification processor
```

---

# Compliance and privacy

Goal:

```text
Document and reduce privacy/security risk before public launch.
```

## Items

```text
[DONE] Add data classification doc.
[DONE] Add PII encryption strategy.
[IN PROGRESS] Add retention policy.
[DONE] Add data export/delete plan.
[DONE] Add media deletion policy.
[TODO] Add secret rotation runbook.
[IN PROGRESS] Add admin access review process.
[IN PROGRESS] Add privacy incident response plan.
```

## Key docs

```text
docs/security/data-classification.md
docs/security/pii-encryption-roadmap.md
docs/security/user-data-export-delete.md
docs/runbooks/private-media-incident.md
docs/security/retention-policy.md
docs/security/secret-rotation.md
docs/security/privacy-incident-response.md
```

---

# Rollout and feature flags

Goal:

```text
Launch gradually and safely.
```

## Items

```text
[TODO] Document runtime flags.
[TODO] Decide percentage rollout strategy.
[TODO] Decide segment/geography rollout strategy.
[TODO] Add private dogfood checklist.
[TODO] Add private beta checklist.
[TODO] Add staged public rollout plan.
[TODO] Add rollback plan.
[TODO] Add support launch script.
```

## Launch stages

```text
internal dogfood
private beta
limited geography/profession rollout
1% public
5% public
25% public
50% public
100% public
```

---

# Final launch gate

Do not launch publicly until every item below is true:

```text
[~] Core booking/session flow has API-assisted E2E coverage; staging/prod execution evidence still needed.
[ ] Health live/ready endpoints are deployed.
[ ] Production monitors watch live and ready endpoints.
[ ] Runbooks exist and are linked from alerts.
[ ] Dashboard exists with critical panels.
[ ] Storage RLS policies are deployed and verified.
[x] High-risk route rate limits are enforced in code.
[x] Auth/SMS routes fail safely under abuse/backing-service failure.
[x] Pro readiness/onboarding gates are enforced in code.
[ ] Realtime or polling strategy is implemented.
[ ] Payment/Stripe webhook replay is proven idempotent.
[ ] Full retry/idempotency suite passes.
[ ] Load tests pass target thresholds.
[ ] Chaos tests pass for Redis/provider outages.
[x] Privacy/compliance docs exist.
[ ] Rollout and rollback plans exist.
[ ] Support has launch scripts and escalation paths.
[ ] Go/no-go review is complete.
```

---

# Current sprint summary

## Completed in this ops-readiness sprint

```text
[DONE] /api/health/live
[DONE] /api/health/ready
[DONE] /api/health compatibility alias
[DONE] Postgres probe
[DONE] Redis probe
[DONE] Supabase Storage probe
[DONE] Stripe probe
[DONE] Postmark probe
[DONE] Twilio probe
[DONE] Health tests
[DONE] Runbooks
[DONE] Dashboard checklist
```

## Still not done after this sprint

```text
[TODO] Actual observability dashboard implementation
[TODO] Alert configuration
[TODO] Realtime/session refresh
[TODO] Production monitor wiring
[TODO] Full browser E2E/load/chaos execution
[TODO] Privacy/compliance owner review + encryption implementation
[TODO] Rollout/go-no-go docs
```
