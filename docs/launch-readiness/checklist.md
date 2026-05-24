# TOVIS Launch Readiness Checklist
This checklist tracks the launch-hardening work required before a serious public launch.
Use this file as the source of truth for launch readiness. Do not mark an item fully done unless the implementation exists, tests/docs exist where appropriate, and the linked files are committed.
Important distinction:
- `Implemented` means the code/doc exists.
- `Tested locally` means focused local proof exists.
- `Tested in CI` means the proof has run in CI.
- `Verified deployed` means the behavior has been verified in a deployed environment.
- `Operationalized` means monitoring, ownership, runbook, rollout, or support process exists where needed.
## Status legend
| Status | Meaning |
|---|---|
| `TODO` | Not started or not proven. |
| `IN PROGRESS` | Partially implemented or partially proven. |
| `DONE` | Implemented, tested/documented where appropriate, and committed. |
| `BLOCKED` | Cannot move forward until a dependency/decision is resolved. |
| `DEFERRED` | Intentionally postponed beyond launch-readiness scope. |
| `[~]` | Partial evidence exists, but production-grade proof is still missing. |
## Proof columns
| Column | Meaning |
|---|---|
| `Implemented` | Code/doc exists and is committed. |
| `Tested locally` | Focused local tests or local verification have passed. |
| `Tested in CI` | Relevant CI run has passed. |
| `Verified deployed` | Behavior has been verified in staging/production. |
| `Operationalized` | Monitoring, alerts, runbooks, owner, or support workflow exists. |
---
# Overall launch status
```text
Core product flow: mostly wired
Launch readiness: in progress
Current focus: privacy runtime / session refresh / proof suite / load + chaos / rollout

Launch blocker tracker

Item	Status	Implemented	Tested locally	Tested in CI	Verified deployed	Operationalized	Owner	Notes
Full lifecycle regression suite	TODO	Partial	Partial	No	No	No	Tori	API-assisted E2E exists; full browser path and action matrix still needed.
Pro onboarding/readiness hard gate	DONE	Yes	Yes	Unknown	No	Partial	Tori	Code/tests exist; deployed verification still needed.
High-risk booking/token/media/auth rate-limit enforcement	DONE	Yes	Yes	Unknown	No	Partial	Tori	Route coverage exists; production telemetry still needed.
Origin/Referer checks	DONE	Yes	Yes	Unknown	No	Partial	Tori	Middleware enforcement exists.
Realtime/session refresh strategy	TODO	No	No	No	No	No	Tori	Pro session state endpoint and polling are not implemented.
Full booking lifecycle E2E	IN PROGRESS	Partial	Partial	Unknown	No	No	Tori	API-assisted flow exists; staging/prod execution evidence still needed.
Load tests for booking/availability/media	TODO	Partial	Partial	No	No	No	Tori	Signup load test exists only.
Chaos tests for Redis/provider outages	TODO	No	No	No	No	No	Tori	No tests/chaos/ coverage yet.
Compliance/privacy docs	IN PROGRESS	Yes	Partial	No	No	No	Tori	Docs exist; owner review/sign-off incomplete.
Rollout/go-no-go plan	TODO	No	No	No	No	No	Tori	go-no-go.md, beta checklist, rollout checklist, and risk register missing.

⸻

Sprint 1 — Core workflow correctness

Goal:

Make the booking/session lifecycle impossible to complete incorrectly.

Items

Item	Status	Implemented	Tested locally	Tested in CI	Verified deployed	Operationalized	Owner	Notes
Replace misleading “Complete session” UI with closeout-aware action	DONE	Yes	Yes	Unknown	No	No	Tori	UI no longer implies direct completion.
Remove direct UI-driven SessionStep.DONE transition	DONE	Yes	Yes	Unknown	No	No	Tori	Backend closeout rules own completion.
Surface backend closeout blockers in the Pro session flow	DONE	Yes	Yes	Unknown	No	No	Tori	Blockers shown to Pro.
Keep backend direct DONE transition blocked	DONE	Yes	Yes	Unknown	No	No	Tori	Write boundary blocks illegal transition.
Add smoke coverage for booking closeout flow	DONE	Yes	Yes	Unknown	No	No	Tori	Smoke coverage exists.
Add full lifecycle action regression suite	TODO	Partial	Partial	No	No	No	Tori	Needs action-by-action legal/illegal coverage.
Add staging/prod lifecycle telemetry soak	TODO	No	No	No	No	No	Tori	Requires deployed environment and run record.

Key files

app/pro/bookings/[id]/session/page.tsx
lib/booking/writeBoundary.ts
lib/booking/lifecycleContract.ts
tests/e2e/booking-lifecycle-smoke.spec.ts
tests/e2e/booking-lifecycle.spec.ts

Acceptance criteria

[x] Pro cannot trigger direct DONE transition from the UI.
[x] Pro sees blockers when aftercare/payment/checkout/after-photo requirements are missing.
[x] Booking completion only happens through backend closeout rules.
[ ] Every visible lifecycle action has a regression test.
[ ] Lifecycle proof has been run and recorded against a specific commit/environment.

⸻

Sprint 2 — Token and retry safety

Goal:

Use secure action-token flows and make retryable mutations safe.

Items

Item	Status	Implemented	Tested locally	Tested in CI	Verified deployed	Operationalized	Owner	Notes
Move active aftercare/rebook paths to ClientActionToken	DONE	Yes	Yes	Unknown	No	No	Tori	Active flow no longer depends on publicToken.
Add active-path guard against aftercare.publicToken usage	DONE	Yes	Yes	Unknown	No	No	Tori	Guard exists.
Add rebook token GET/POST behavior coverage	DONE	Yes	Yes	Unknown	No	No	Tori	Route coverage exists.
Add token-scoped rebook idempotency	DONE	Yes	Yes	Unknown	No	No	Tori	Idempotency coverage exists.
Add claim/NFC path tests and docs	DONE	Yes	Yes	Unknown	No	Partial	Tori	Docs/tests exist; deployed proof still needed.
Keep legacy AftercareSummary.publicToken only as deprecated schema field	IN PROGRESS	Yes	Partial	Unknown	No	No	Tori	Deprecated field remains.
Create idempotency route map document	TODO	No	No	No	No	No	Tori	Still missing.
Prove aftercare send atomicity	DONE	Yes	Yes	Unknown	No	No	Tori	Atomicity tests exist.
Migrate raw ProClientInvite.token to tokenHash for new/primary lookup paths	DONE	Yes	Yes	Unknown	No	No	Tori	New/primary paths use tokenHash.
Prove cancel/reschedule idempotency in route tests	DONE	Yes	Yes	Unknown	No	No	Tori	Cancel/reschedule route tests exist.

Key files

lib/aftercare/unclaimedAftercareAccess.ts
app/api/client/rebook/[token]/route.ts
app/client/bookings/[id]/page.tsx
app/api/pro/bookings/[id]/aftercare/route.ts
prisma/schema.prisma
lib/booking/writeBoundary.aftercareAtomicity.test.ts
lib/clients/clientClaimLinks.test.ts
app/api/bookings/[id]/cancel/route.test.ts
app/api/bookings/[id]/reschedule/route.test.ts

Acceptance criteria

[x] New active aftercare links use ClientActionToken.
[x] Active client/pro payloads do not expose legacy publicToken.
[x] Rebook token flows are idempotent.
[x] Cancel/reschedule mutations are idempotent.
[x] Invite/claim tokens are hashed at rest for new/primary flows.
[ ] Idempotency route map exists.

⸻

Sprint 3 — Security foundations

Goal:

Harden storage, media, rate limits, request trust boundaries, and safe logging.

Items

Item	Status	Implemented	Tested locally	Tested in CI	Verified deployed	Operationalized	Owner	Notes
Add Supabase Storage bucket/policy migration as code	DONE	Yes	Yes	Unknown	No	No	Tori	Migration exists.
Add media-private restrictive policy baseline	DONE	Yes	Yes	Unknown	No	No	Tori	Policy proof mostly exists.
Add media-public policy baseline	DONE	Yes	Yes	Unknown	No	No	Tori	Policy baseline exists.
Add central rate-limit policy definitions	DONE	Yes	Yes	Unknown	No	Partial	Tori	Policies exist.
Add Supabase policy SQL tests	TODO	No	No	No	No	No	Tori	Still missing.
Verify live Supabase bucket policies after deploy	TODO	No	No	No	No	No	Tori	Needs deployed environment proof.
Add high-risk route/wrapper rate-limit enforcement	DONE	Yes	Yes	Unknown	No	Partial	Tori	Code coverage exists.
Add auth route rate limits	DONE	Yes	Yes	Unknown	No	Partial	Tori	Code coverage exists.
Add SMS route rate limits	DONE	Yes	Yes	Unknown	No	Partial	Tori	Code coverage exists.
Add SMS fail-closed behavior when Redis/rate limit backend is unavailable	DONE	Yes	Yes	Unknown	No	Partial	Tori	Local proof exists.
Add token route rate limits	DONE	Yes	Yes	Unknown	No	Partial	Tori	Code coverage exists.
Add media route rate limits	DONE	Yes	Yes	Unknown	No	Partial	Tori	Code coverage exists.
Add Origin/Referer checks for state-changing cookie-authenticated requests	DONE	Yes	Yes	Unknown	No	Partial	Tori	Middleware exists.
Add before/after media upload audit write-path verification	DONE	Yes	Yes	Unknown	No	Partial	Tori	Audit write-path verification exists.
Harden booking route raw error logging	DONE	Yes	Yes	No	No	Partial	Tori	Commit 8f2a424; focused suite passed locally.
Add upload-token binding proof	TODO	No	No	No	No	No	Tori	No UploadSession model or uploadSessionId binding yet.
Add orphan media cleanup	TODO	No	No	No	No	No	Tori	Still missing.
Add media scan/moderation flow or explicit deferral	TODO	No	No	No	No	No	Tori	Needs decision.

Key files

supabase/migrations/20260514180000_storage_media_bucket_policies.sql
lib/rateLimit/policies.ts
lib/rateLimit/enforce.ts
middleware.ts
app/api/auth/*
app/api/pro/uploads/route.ts
app/api/pro/bookings/[id]/media/route.ts
docs/launch-readiness/rate-limit-coverage.md
lib/security/logging.ts

Acceptance criteria

[x] Private media cannot be anonymously listed/read in repo policy proof.
[x] Storage policy is committed and deployable.
[x] Auth/SMS/token/media routes are rate limited.
[x] SMS abuse routes fail closed when required.
[x] State-changing cookie-auth routes validate Origin/Referer or documented CSRF strategy.
[x] Booking/session hot routes use safe logging helpers instead of raw Error logging.
[~] Media upload has audit trail; delete/replacement proof still pending.
[ ] Upload metadata cannot attach arbitrary uploaded objects without binding.

⸻

Sprint 4 — Ops readiness

Goal:

Make the app observable, diagnosable, and operable during production incidents.

Health endpoints and probes

Item	Status	Implemented	Tested locally	Tested in CI	Verified deployed	Operationalized	Owner	Notes
Add /api/health/live endpoint	DONE	Yes	Yes	Unknown	No	Partial	Tori	Endpoint and tests exist.
Add /api/health/ready endpoint	DONE	Yes	Yes	Unknown	No	Partial	Tori	Endpoint and tests exist.
Keep /api/health as compatibility alias for readiness	DONE	Yes	Yes	Unknown	No	Partial	Tori	Alias exists.
Add shared health response types	DONE	Yes	Yes	Unknown	No	No	Tori	Types exist.
Add health summary/status-code logic	DONE	Yes	Yes	Unknown	No	No	Tori	Tests exist.
Add Postgres readiness probe	DONE	Yes	Yes	Unknown	No	Partial	Tori	Probe exists.
Add Redis readiness probe	DONE	Yes	Yes	Unknown	No	Partial	Tori	Probe exists.
Add Supabase Storage readiness probe	DONE	Yes	Yes	Unknown	No	Partial	Tori	Probe exists.
Add Stripe readiness/config probe	DONE	Yes	Yes	Unknown	No	Partial	Tori	Probe exists.
Add Postmark readiness/config probe	DONE	Yes	Yes	Unknown	No	Partial	Tori	Probe exists.
Add Twilio readiness/config probe	DONE	Yes	Yes	Unknown	No	Partial	Tori	Probe exists.
Add health check orchestrator	DONE	Yes	Yes	Unknown	No	Partial	Tori	Orchestrator exists.
Add health tests	DONE	Yes	Yes	Unknown	No	No	Tori	Unit/route tests exist.

Runbooks and dashboards

Item	Status	Implemented	Tested locally	Tested in CI	Verified deployed	Operationalized	Owner	Notes
Add runbook directory and README	DONE	Yes	N/A	N/A	N/A	Partial	Tori	Docs exist.
Add dependency outage/degradation runbooks	DONE	Yes	N/A	N/A	N/A	Partial	Tori	Postgres, Redis, Storage, Stripe, Postmark, Twilio exist.
Add notification backlog runbook	DONE	Yes	N/A	N/A	N/A	Partial	Tori	Runbook exists.
Add launch dashboard checklist	DONE	Yes	N/A	N/A	N/A	Partial	Tori	Checklist exists.
Add actual dashboard panels in chosen observability tool	TODO	No	No	No	No	No	Tori	Checklist only.
Add alert rules for health/readiness dependencies	TODO	No	No	No	No	No	Tori	Alert rules not wired.
Add notification backlog metric implementation if not already queryable	TODO	Unknown	No	No	No	No	Tori	Needs verification.
Add deployment marker integration	TODO	No	No	No	No	No	Tori	Still missing.
Add incident owner/escalation policy	TODO	No	No	No	No	No	Tori	Still missing.
Add realtime/session refresh strategy	TODO	No	No	No	No	No	Tori	Session state endpoint and polling missing.
Add notification version polling endpoint if choosing polling for launch	TODO	No	No	No	No	No	Tori	Needs decision.
Add session state refresh wiring	TODO	No	No	No	No	No	Tori	Missing.
Decide whether to remove, rename, or complete dead Redis publisher path	TODO	No	No	No	No	No	Tori	Existing cache-version bump is not realtime subscriber.
Decide mobile push strategy	TODO	No	No	No	No	No	Tori	Needs decision.

Acceptance criteria

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
[ ] Production alerts are configured.

⸻

Sprint 5 — Edge-flow audit

Goal:

Harden token, claim, NFC, and short-code flows.

Items

Item	Status	Implemented	Tested locally	Tested in CI	Verified deployed	Operationalized	Owner	Notes
Add NFC tap-card tests	DONE	Yes	Yes	Unknown	No	No	Tori	Tests exist.
Add short-code redirect tests	DONE	Yes	Yes	Unknown	No	No	Tori	Tests exist.
Add NFC trust-boundary doc	DONE	Yes	N/A	N/A	N/A	Partial	Tori	Doc exists.
Add claim-flow audit doc	DONE	Yes	N/A	N/A	N/A	Partial	Tori	Doc exists.
Migrate ProClientInvite token to tokenHash for new/primary lookup paths	DONE	Yes	Yes	Unknown	No	No	Tori	TokenHash path exists.
Add tap-code rate limiting	TODO	No	No	No	No	No	Tori	Still missing.
Prove NFC/short-code entry points are evaluated by Pro readiness policy	DONE	Yes	Yes	Unknown	No	No	Tori	Readiness policy proof exists.
Prove claim accept is idempotent	IN PROGRESS	Partial	Partial	Unknown	No	No	Tori	More replay proof needed.
Add wrong-user/already-claimed claim behavior tests	DONE	Yes	Yes	Unknown	No	No	Tori	Tests exist.
Add revoked claim behavior tests	DONE	Yes	Yes	Unknown	No	No	Tori	Tests exist.

Acceptance criteria

[~] NFC/tap tokens are non-enumerable by design; rate-limit proof still pending.
[~] Revoked links fail safely; explicit expired-state proof still pending.
[x] Wrong-user/already-claimed claim behavior is explicit.
[~] Claim accept handles already-claimed/revoked states; replay/idempotency proof still pending.
[x] NFC/tap flow cannot bypass readiness policy evaluation.
[x] Public/token routes are rate limited where listed in rate-limit coverage.

⸻

Sprint 6 — Load, chaos, and launch rehearsal

Goal:

Prove the system survives traffic, retries, provider outages, and launch operations.

Items

Item	Status	Implemented	Tested locally	Tested in CI	Verified deployed	Operationalized	Owner	Notes
Add lifecycle smoke test	DONE	Yes	Yes	Unknown	No	No	Tori	Smoke test exists.
Add authVersion enforcement test	DONE	Yes	Yes	Unknown	No	No	Tori	Test exists.
Add booking concurrency integration test	DONE	Yes	Yes	Unknown	No	No	Tori	Overlap/concurrency proof exists.
Add full booking lifecycle E2E	IN PROGRESS	Partial	Partial	Unknown	No	No	Tori	API-assisted flow exists; signup/search/hold/finalize browser path pending.
Add broad retry/idempotency suite	TODO	Partial	Partial	Unknown	No	No	Tori	Several route tests exist; full suite missing.
Add load-test scaffolding	IN PROGRESS	Partial	Partial	No	No	No	Tori	Signup load test exists only.
Add booking finalize load test	TODO	No	No	No	No	No	Tori	Missing.
Add availability load test	TODO	No	No	No	No	No	Tori	Missing.
Add media upload load test	TODO	No	No	No	No	No	Tori	Missing.
Add Stripe webhook replay storm test	TODO	No	No	No	No	No	Tori	Missing.
Add Redis outage chaos test	TODO	No	No	No	No	No	Tori	Missing.
Add Postmark outage chaos test	TODO	No	No	No	No	No	Tori	Missing.
Add Twilio outage chaos test	TODO	No	No	No	No	No	Tori	Missing.
Add Supabase Storage outage chaos test	TODO	No	No	No	No	No	Tori	Missing.
Add private beta checklist	TODO	No	No	No	No	No	Tori	Missing.
Add staged public rollout checklist	TODO	No	No	No	No	No	Tori	Missing.
Add final risk register	TODO	No	No	No	No	No	Tori	Missing.
Add launch go/no-go review doc	TODO	No	No	No	No	No	Tori	Missing.

Key files to add later

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

Acceptance criteria

[~] Full happy path has API-assisted E2E coverage; Pro signup/search/hold/finalize browser path still pending.
[ ] Retry suite proves no duplicate side effects.
[ ] Load tests meet p95 targets.
[ ] Chaos tests prove graceful degradation.
[ ] Private beta checklist exists.
[ ] Public rollout checklist exists.
[ ] Go/no-go review is complete.

⸻

Database and performance review

Goal:

Prove hot data paths are indexed and booking overlap is impossible.

Items

Item	Status	Implemented	Tested locally	Tested in CI	Verified deployed	Operationalized	Owner	Notes
Decide DB no-overlap constraint strategy	DONE	Yes	Yes	Unknown	No	Partial	Tori	Strategy decided and tested locally.
Test overlapping appointment ranges, not just identical scheduledFor values	DONE	Yes	Yes	Unknown	No	No	Tori	Integration coverage exists.
Review hot query indexes	IN PROGRESS	Partial	No	No	No	No	Tori	More EXPLAIN work needed.
Review notification inbox indexes	TODO	No	No	No	No	No	Tori	Missing.
Review booking dashboard query plans	TODO	No	No	No	No	No	Tori	Missing.
Review availability query plans	TODO	No	No	No	No	No	Tori	Missing.
Add EXPLAIN ANALYZE notes for hot paths	TODO	No	No	No	No	No	Tori	Missing.
Create schema cleanup plan	TODO	No	No	No	No	No	Tori	Missing.

Hot paths

/api/availability/bootstrap
/api/holds
/api/bookings/finalize
/api/pro/bookings
/api/pro/bookings/[id]
/api/pro/bookings/[id]/media
/api/pro/bookings/[id]/aftercare
/api/webhooks/stripe
notification processor

⸻

Compliance and privacy

Goal:

Document and reduce privacy/security risk before public launch.

Items

Item	Status	Implemented	Tested locally	Tested in CI	Verified deployed	Operationalized	Owner	Notes
Add data classification doc	DONE	Yes	N/A	N/A	N/A	Partial	Tori	Doc exists; review/sign-off still needed.
Add PII encryption strategy	DONE	Yes	N/A	N/A	N/A	Partial	Tori	Roadmap exists; runtime implementation incomplete.
Add retention policy	IN PROGRESS	Partial	N/A	N/A	N/A	No	Tori	Needs review.
Add data export/delete plan	DONE	Yes	N/A	N/A	N/A	Partial	Tori	Doc exists; review/sign-off still needed.
Add media deletion policy	DONE	Yes	N/A	N/A	N/A	Partial	Tori	Policy exists; storage update/delete proof caveat remains.
Add secret rotation runbook	TODO	Partial	N/A	N/A	N/A	No	Tori	Verify current doc state before marking done.
Add admin access review process	IN PROGRESS	Partial	Partial	Unknown	No	No	Tori	Scoped permission checks exist; policy review still needed.
Add privacy incident response plan	IN PROGRESS	Partial	N/A	N/A	N/A	No	Tori	Private media incident runbook exists; full privacy incident process needs review.
Document SHA-256 vs HMAC contact hash decision	TODO	No	No	No	No	No	Tori	hashLookup.ts uses SHA-256; no threat-model decision doc exists.
Wire ClientAddress encrypted address writes	DONE	Yes	Yes	Unknown	No	No	Tori	Create/update paths use address privacy write data.
Wire ProfessionalLocation encrypted address writes	DONE	Yes	Yes	Unknown	No	No	Tori	Create/update/onboarding/offerings paths wired.
Wire BookingHold/Booking dedicated encrypted snapshot columns	IN PROGRESS	Partial	Partial	Unknown	No	No	Tori	Snapshot envelope is written into legacy JSON columns; dedicated encrypted snapshot columns are not written.
Add centralized address read/decrypt helpers	TODO	Partial	No	No	No	No	Tori	Write helper exists; decrypt/read seam missing.

Key docs

docs/security/data-classification.md
docs/security/pii-encryption-roadmap.md
docs/security/user-data-export-delete.md
docs/runbooks/private-media-incident.md
docs/security/retention-policy.md
docs/security/secret-rotation.md
docs/security/privacy-incident-response.md
docs/security/contact-lookup-hash-threat-model.md

⸻

Storage and media proof

Goal:

Prove media-private storage cannot be directly accessed, updated, or deleted outside intended server-mediated paths.

Items

Item	Status	Implemented	Tested locally	Tested in CI	Verified deployed	Operationalized	Owner	Notes
Storage policy proof doc exists	DONE	Yes	Yes	N/A	No	Partial	Tori	docs/launch-readiness/storage-policy-proof.md exists.
Anonymous direct read/list media-private denied	DONE	Yes	Yes	N/A	No	Partial	Tori	Proof documented.
Authenticated direct read/list media-private denied unless intentionally allowed	DONE	Yes	Yes	N/A	No	Partial	Tori	Proof documented.
Anonymous direct update/delete media-private denied	TODO	No	No	No	No	No	Tori	Caveat still open.
Authenticated direct update/delete media-private denied unless intentionally allowed	TODO	No	No	No	No	No	Tori	Caveat still open.

⸻

Session refresh / realtime MVP

Goal:

The Pro session screen updates when client/session/payment state changes without manual refresh.

Items

Item	Status	Implemented	Tested locally	Tested in CI	Verified deployed	Operationalized	Owner	Notes
Add Pro session state endpoint	TODO	No	No	No	No	No	Tori	app/api/pro/bookings/[id]/session/state/route.ts does not exist.
Add active-session polling to Pro session UI	TODO	No	No	No	No	No	Tori	No polling/SWR refresh pattern found.
Pause/slow polling when tab hidden	TODO	No	No	No	No	No	Tori	Depends on polling implementation.
Stop polling on completed/cancelled terminal state	TODO	No	No	No	No	No	Tori	Depends on polling implementation.
Decide Redis publisher strategy	TODO	Partial	No	No	No	No	Tori	Existing cache-version bump is not session realtime.

⸻

Rollout and feature flags

Goal:

Launch gradually and safely.

Items

Item	Status	Implemented	Tested locally	Tested in CI	Verified deployed	Operationalized	Owner	Notes
Document runtime flags	TODO	No	No	No	No	No	Tori	Missing.
Decide percentage rollout strategy	TODO	No	No	No	No	No	Tori	Missing.
Decide segment/geography rollout strategy	TODO	No	No	No	No	No	Tori	Missing.
Add private dogfood checklist	TODO	No	No	No	No	No	Tori	Missing.
Add private beta checklist	TODO	No	No	No	No	No	Tori	Missing.
Add staged public rollout plan	TODO	No	No	No	No	No	Tori	Missing.
Add rollback plan	TODO	No	No	No	No	No	Tori	Missing.
Add support launch script	TODO	No	No	No	No	No	Tori	Missing.
Add risk register	TODO	No	No	No	No	No	Tori	Missing.
Add go/no-go review doc	TODO	No	No	No	No	No	Tori	Missing.

Launch stages

internal dogfood
5 trusted Pros
25 Pros in one region
100 Pros controlled beta
public waitlist
broader public launch

⸻

Proof suite and evidence

Goal:

Record proof against specific commits and environments.

Items

Item	Status	Implemented	Tested locally	Tested in CI	Verified deployed	Operationalized	Owner	Notes
Create test-proof.md	TODO	No	No	No	No	No	Tori	Missing.
Record commit SHA, date, environment, command, result, known skips	TODO	No	No	No	No	No	Tori	Needed for launch proof.
Record focused safe-logging route proof	IN PROGRESS	Yes	Yes	No	No	No	Tori	Commit 8f2a424; local route suite passed. Needs test-proof entry.
Record full lifecycle proof	TODO	Partial	Partial	No	No	No	Tori	Tests exist but proof doc missing.
Record load/chaos proof	TODO	No	No	No	No	No	Tori	Missing.

⸻

Final launch gate

Do not launch publicly until every item below is true:

Gate	Status	Notes
Core booking/session flow has API-assisted E2E coverage	IN PROGRESS	Staging/prod execution evidence still needed.
Health live/ready endpoints are deployed	TODO	Code exists; deployed verification needed.
Production monitors watch live and ready endpoints	TODO	Not wired.
Runbooks exist and are linked from alerts	IN PROGRESS	Runbooks exist; alert linking missing.
Dashboard exists with critical panels	TODO	Checklist only.
Storage RLS policies are deployed and verified	TODO	Repo proof exists; deployed proof missing.
High-risk route rate limits are enforced in code	DONE	Code coverage exists.
Auth/SMS routes fail safely under abuse/backing-service failure	DONE	Local proof exists.
Pro readiness/onboarding gates are enforced in code	DONE	Code coverage exists.
Realtime or polling strategy is implemented	TODO	Missing.
Payment/Stripe webhook replay is proven idempotent	IN PROGRESS	Code/test proof exists; replay storm/load proof missing.
Full retry/idempotency suite passes	TODO	Partial route coverage only.
Load tests pass target thresholds	TODO	Missing.
Chaos tests pass for Redis/provider outages	TODO	Missing.
Privacy/compliance docs exist	DONE	Review/sign-off incomplete.
Privacy runtime writes are complete	IN PROGRESS	Client/pro location writes done; BookingHold/Booking dedicated snapshot columns not wired.
Rollout and rollback plans exist	TODO	Missing.
Support has launch scripts and escalation paths	TODO	Missing.
Go/no-go review is complete	TODO	Missing.

⸻

Current sprint summary

Completed recently

[DONE] Harden booking route error logging.
[DONE] Remove raw console.error(..., error) matches in booking/session route scope.
[DONE] Add/adjust focused route tests for safe logging.
[DONE] Run focused booking route suite locally: 11 files, 153 tests passed.
[DONE] Run typecheck locally.
[DONE] Commit safe logging hardening: 8f2a424.

Next priority

[TODO] Update Sprint 1 owner/sign-off fields.
[TODO] Document SHA-256 vs HMAC contact hash decision.
[TODO] Wire BookingHold/Booking dedicated encrypted snapshot columns.
[TODO] Add centralized address read/decrypt helpers.
[TODO] Add Pro session state endpoint.
[TODO] Add active-session polling.
[TODO] Finish storage media-private update/delete proof.
[TODO] Create test-proof.md and record proof suite.
