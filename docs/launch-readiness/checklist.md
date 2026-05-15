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

---

# Overall launch status

```text
Core product flow: mostly wired
Launch readiness: in progress
Current focus: Ops readiness / health checks / runbooks / dashboards
```

## Launch blockers remaining

```text
[ ] Full lifecycle regression suite
[ ] Pro onboarding/readiness hard gate
[ ] Global rate-limit enforcement
[ ] Origin/Referer checks
[ ] Realtime/session refresh strategy
[ ] Full 12-step E2E test
[ ] Load tests for booking/availability/media
[ ] Chaos tests for Redis/provider outages
[ ] Compliance/privacy plan
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
```

## Acceptance criteria

```text
[ ] Pro cannot trigger direct DONE transition from the UI.
[ ] Pro sees blockers when aftercare/payment/checkout/after-photo requirements are missing.
[ ] Booking completion only happens through backend closeout rules.
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
[TODO] Prove aftercare send atomicity.
[TODO] Migrate raw ProClientInvite.token to tokenHash.
[TODO] Prove cancel/reschedule idempotency in route tests.
```

## Key files

```text
lib/aftercare/unclaimedAftercareAccess.ts
app/api/client/rebook/[token]/route.ts
app/client/bookings/[id]/page.tsx
app/api/pro/bookings/[id]/aftercare/route.ts
prisma/schema.prisma
```

## Acceptance criteria

```text
[ ] New active aftercare links use ClientActionToken.
[ ] Active client/pro payloads do not expose legacy publicToken.
[ ] Rebook token flows are idempotent.
[ ] Cancel/reschedule mutations are idempotent.
[ ] Invite/claim tokens are hashed at rest.
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
[TODO] Add global route/middleware/wrapper rate-limit enforcement.
[TODO] Add auth route rate limits.
[TODO] Add SMS route rate limits.
[TODO] Add SMS fail-closed behavior when Redis/rate limit backend is unavailable.
[TODO] Add token route rate limits.
[TODO] Add media route rate limits.
[TODO] Add Origin/Referer checks for state-changing cookie-authenticated requests.
[TODO] Add media upload audit write-path verification.
[TODO] Add upload-token binding proof.
[TODO] Add orphan media cleanup.
[TODO] Add media scan/moderation flow or explicit deferral.
```

## Key files

```text
supabase/migrations/20260514180000_storage_media_bucket_policies.sql
lib/rateLimit/policies.ts
middleware.ts
app/api/auth/*
app/api/pro/uploads/route.ts
app/api/pro/bookings/[id]/media/route.ts
```

## Acceptance criteria

```text
[ ] Private media cannot be anonymously listed/read.
[ ] Storage policy is committed and deployable.
[ ] Auth/SMS/token/media routes are rate limited.
[ ] SMS abuse routes fail closed when required.
[ ] State-changing cookie-auth routes validate Origin/Referer or documented CSRF strategy.
[ ] Media upload/delete/replacement has audit trail.
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
[ ] /api/health/live returns app liveness only.
[ ] /api/health/ready checks all dependencies.
[ ] Postgres failure makes readiness down.
[ ] Redis failure makes readiness degraded.
[ ] Storage failure makes readiness degraded.
[ ] Stripe config/provider failure makes readiness degraded.
[ ] Postmark config/provider failure makes readiness degraded.
[ ] Twilio config/provider failure makes readiness degraded.
[ ] Probe timeout does not crash endpoint.
[ ] Tests cover ok/degraded/down behavior.
[ ] Runbooks exist for each dependency.
[ ] Dashboard checklist exists and maps alerts to runbooks.
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
[TODO] Migrate ProClientInvite token to tokenHash.
[TODO] Add tap-code rate limiting.
[TODO] Prove NFC cannot bypass Pro readiness gates.
[TODO] Prove claim accept is idempotent.
[TODO] Add wrong-user claim behavior tests.
[TODO] Add expired/revoked claim behavior tests.
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
[ ] NFC/tap tokens are non-enumerable.
[ ] Revoked/expired links fail safely.
[ ] Wrong-user claim behavior is explicit.
[ ] Claim accept is idempotent.
[ ] NFC/tap flow cannot bypass readiness.
[ ] Public/token routes are rate limited.
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
[TODO] Add full 12-step E2E.
[TODO] Add broad retry/idempotency suite.
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
tests/e2e/full-booking-lifecycle.spec.ts
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
[ ] Full happy path passes from Pro signup to booking completion.
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
[TODO] Decide DB no-overlap constraint strategy.
[TODO] Test overlapping appointment ranges, not just identical scheduledFor values.
[TODO] Review hot query indexes.
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
[TODO] Add data classification doc.
[TODO] Add PII encryption strategy.
[TODO] Add retention policy.
[TODO] Add data export/delete plan.
[TODO] Add media deletion policy.
[TODO] Add secret rotation runbook.
[TODO] Add admin access review process.
[TODO] Add privacy incident response plan.
```

## Key docs to add later

```text
docs/security/data-classification.md
docs/security/pii-encryption-strategy.md
docs/security/retention-policy.md
docs/security/data-export-delete.md
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
[ ] Core booking/session flow passes full E2E.
[ ] Health live/ready endpoints are deployed.
[ ] Production monitors watch live and ready endpoints.
[ ] Runbooks exist and are linked from alerts.
[ ] Dashboard exists with critical panels.
[ ] Storage RLS policies are deployed and verified.
[ ] Global rate limits are enforced.
[ ] Auth/SMS routes fail safely under abuse/backing-service failure.
[ ] Pro readiness/onboarding gates are enforced.
[ ] Realtime or polling strategy is implemented.
[ ] Payment/Stripe webhook replay is proven idempotent.
[ ] Full retry/idempotency suite passes.
[ ] Load tests pass target thresholds.
[ ] Chaos tests pass for Redis/provider outages.
[ ] Privacy/compliance docs exist.
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
[TODO] Rate-limit enforcement
[TODO] Pro readiness gate
[TODO] Full E2E/load/chaos
[TODO] Privacy/compliance docs
[TODO] Rollout/go-no-go docs
```