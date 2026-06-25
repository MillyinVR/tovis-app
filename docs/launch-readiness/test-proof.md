# TOVIS Launch Readiness Test Proof

This file records concrete test/proof runs for launch-readiness work.

Do not mark a launch-readiness item fully proven unless the relevant command, environment, commit SHA, result, and known limitations are recorded here.

---

# Current Proof Index

Last reconciled: 2026-06-10
Current repo audit HEAD: `57ce1ef2fbb5be1480e0d41d1126d2d08c15bcdf`
Private beta decision: NO-GO
Public rollout decision: NO-GO

| Proof area | Current status | Evidence location | Caveat |
|---|---|---|---|
| Current safe local verification | PASS | `docs/launch-readiness/phase-2-remaining-work.md` | `pnpm typecheck`, `pnpm verify:privacy-phase1`, and `pnpm test:chaos` passed on 2026-06-10. Full launch-ops/load proof was not rerun at current HEAD. |
| Focused tenant/search verification | PASS LOCALLY | `docs/launch-readiness/tenant-foundation-audit.md` | `pnpm exec vitest run --config vitest.config.mts lib/tenant/resolveTenant.test.ts lib/tenant/visibility.test.ts lib/tenant/requestContext.test.ts lib/tenant/bookingAttribution.test.ts app/api/search/route.test.ts`: 5 files / 27 tests passed. Some covered helper files remain untracked. |
| Full local launch-ops/load proof | PASS LOCALLY / STALE COMMIT | This file; `go-no-go.md`; `checklist.md` | Last full `pnpm verify:launch-ops` proof is tied to `ae30aff20aff8b205e65f57bf3ae8b5b8b553b29`. Rerun on final beta commit when env/data-impact profile is acceptable. |
| Deployed Sentry intake | PASS DEPLOYED | Synthetic event `e56044a034cb4fb78d1b09801fb43da5` | Does not prove dashboard completeness or route-specific alerts. |
| App-generated synthetic Slack alert | PASS / FOLLOW-UPS TODO | Event `f7a0d19cb4a040a3a21f4679086f166f`; `slack-alerts.md`; `oncall.md` | Runbook-link-in-message and formal acknowledgement timing remain open. |
| Deployed health/readiness | PASS DEPLOYED / DASHBOARD LINK TODO | Proof run below; `sentry-dashboard.md` | Dashboard/synthetic monitor link and provider-live dashboard proof remain open. |
| Local booking/media/checkout smoke | PASS LOCALLY | Proof run below | Target-environment booking/media/payment proof remains open. |
| Local notification/Stripe replay smoke | PASS LOCALLY | Proof run below | Provider/deployed notification and Stripe proof remain open. |
| Deployed smoke-proof checklist | TEMPLATE READY / EXECUTION TODO | `docs/launch-readiness/deployed-smoke-proof.md` | Execution against target environment still required. |
| Support/rollback proof | TEMPLATE READY / HUMAN DECISIONS TODO | `docs/launch-readiness/private-beta-support-rollback.md` | Tori still must choose support hours/channel, rollback process, pause path, and comms path. |
| Tenant foundation audit | READY / FINAL WORKTREE DECISION TODO | `docs/launch-readiness/tenant-foundation-audit.md` | Untracked tenant files must be committed, moved out of scope, or explicitly excluded before final proof. |

---

## Proof run — local booking lifecycle, media, and checkout smoke proof

- Checklist item: Local booking lifecycle, media/private-storage metadata, and checkout smoke proof.
- Owner: Tori Morales
- Date: 2026-06-09
- Status: PASS locally
- Environment:
  - Local: yes
  - Base URL: http://localhost:3000
  - Local database: tovis_test
  - CI: not recorded
  - Deployed staging: not used
  - Production: not used
- Launch decision impact:
  - Local booking lifecycle smoke: PASS
  - Local media/private-storage metadata smoke: PASS
  - Local checkout mark-paid smoke: PASS
  - Deployed booking lifecycle proof: still TODO
  - Deployed media/private-storage proof: still TODO
  - Deployed payment/webhook proof: still TODO
  - Private beta decision: still NO-GO until deployed/private-beta gates are complete or explicitly accepted
  - Public rollout: NO-GO

### Test summary

This proof verifies that the local booking smoke flow can exercise the key Phase 2 booking path against a seeded local test database and a locally running app.

The proof covered:

- Availability bootstrap
- Hold creation
- Booking finalization
- Booking session start
- Booking session/media guards
- Media metadata creation for media-private
- Checkout mark-paid route

The local app was run against the seeded tovis_test database. Client and pro authenticated browser cookies were used locally and were not recorded in this file.

### Local target and IDs

| Field | Value |
|---|---|
| Base URL | http://localhost:3000 |
| Professional ID | cmpytirwf0002potkyjl2du5p |
| Service ID | cmpytis0g000wpotkjydw3wrb |
| Offering ID | cmpytis0t001opotkvocy3qhd |
| Location ID | cmpytis06000epotkdzdyzl5w |
| Booking ID used for media/checkout | cmq68ejz40005pob6zytpiw4v |
| Media phase | AFTER |
| Media visibility | PRO_CLIENT |
| Storage bucket | media-private |

### Availability bootstrap

Command:

bash pnpm test:load:availability 

Result: PASS.

Observed run summary:

json {   "runId": "20260609055948899",   "baseUrl": "http://localhost:3000",   "route": "GET /api/availability/bootstrap",   "profile": "smoke",   "totals": {     "requests": 30,     "success200": 30,     "expected429": 0,     "realFailures": 0,     "realFailureRateExcluding429Pct": 0   },   "statusCounts": {     "200": 30   } } 

### Hold creation

Command:

bash LOAD_TEST_ALLOW_SLOT_REUSE=true pnpm test:load:holds 

Result: PASS.

Observed run summary:

json {   "runId": "20260609060140928",   "baseUrl": "http://localhost:3000",   "route": "POST /api/holds",   "profile": "smoke",   "totals": {     "requests": 10,     "success": 7,     "expected409": 0,     "expected429": 3,     "realFailures": 0,     "realFailureRateExcludingExpectedPct": 0   },   "statusCounts": {     "201": 7,     "429": 3   },   "codeCounts": {     "RATE_LIMITED": 3   } } 

The three 429 RATE_LIMITED responses were expected by the load script and did not count as real failures.

### Booking finalize

Command:

bash pnpm test:load:booking-finalize 

Result: PASS.

Observed run summary:

json {   "runId": "20260609060102519",   "baseUrl": "http://localhost:3000",   "routes": {     "hold": "POST /api/holds",     "finalize": "POST /api/bookings/finalize"   },   "profile": "smoke",   "totals": {     "flowsAttempted": 5,     "hold": {       "success": 1,       "expected409": 4,       "expected429": 0,       "realFailures": 0     },     "finalize": {       "success": 1,       "expected409": 0,       "expected429": 0,       "realFailures": 0     },     "allSteps": {       "success": 2,       "expected409": 4,       "expected429": 0,       "realFailures": 0,       "realFailureRateExcludingExpectedPct": 0     }   },   "statusCounts": {     "201": 2,     "409": 4   },   "codeCounts": {     "TIME_BOOKED": 4   } } 

The 409 TIME_BOOKED responses were expected slot-conflict behavior and did not count as real failures.

### Booking session and media guards

The media route correctly blocked invalid states before successful media proof:

- PENDING booking blocked media upload with 403 FORBIDDEN.
- ACCEPTED booking with no started session blocked AFTER media with 400 STEP_MISMATCH.
- IN_PROGRESS booking at CONSULTATION blocked AFTER media with 400 STEP_MISMATCH.
- Session start route returned 200 OK after the local test booking was moved into the appointment start window.
- For local smoke only, the test booking was manually advanced to SessionStep.AFTER_PHOTOS to prove the media metadata route.

Session start route result:

json {   "ok": true,   "booking": {     "id": "cmq68ejz40005pob6zytpiw4v",     "status": "IN_PROGRESS",     "sessionStep": "CONSULTATION",     "startedAt": "2026-06-09T06:12:39.706Z",     "finishedAt": null   },   "meta": {     "mutated": true,     "noOp": false   },   "nextHref": "/pro/bookings/cmq68ejz40005pob6zytpiw4v/session" } 

Manual local-only session state used for media smoke:

json {   "id": "cmq68ejz40005pob6zytpiw4v",   "status": "IN_PROGRESS",   "sessionStep": "AFTER_PHOTOS",   "startedAt": "2026-06-09T06:17:08.045Z",   "finishedAt": null } 

### Media/private-storage metadata

Command:

bash pnpm test:load:media-metadata 

Result: PASS.

Observed run summary:

json {   "runId": "20260609061731667",   "baseUrl": "http://localhost:3000",   "route": "POST /api/pro/bookings/:bookingId/media",   "profile": "smoke",   "config": {     "bookingId": "cmq68ejz40005pob6zytpiw4v",     "professionalId": "cmpytirwf0002potkyjl2du5p",     "mediaType": "IMAGE",     "phase": "AFTER",     "visibility": "PRO_CLIENT",     "storageBucket": "media-private",     "storagePathPrefix": "bookings/cmq68ejz40005pob6zytpiw4v/after",     "hasProCookie": true   },   "totals": {     "requests": 10,     "success": 10,     "expected409": 0,     "expected429": 0,     "realFailures": 0,     "realFailureRateExcludingExpectedPct": 0   },   "statusCounts": {     "200": 10   },   "latencyMs": {     "all": {       "p50": 729.16,       "p95": 1336.26,       "p99": 1336.26     }   } } 

### Checkout mark-paid

Command:

bash pnpm test:load:checkout 

Result: PASS.

Observed run summary:

json {   "runId": "20260609061811227",   "baseUrl": "http://localhost:3000",   "route": "POST /api/pro/bookings/:bookingId/checkout/mark-paid",   "profile": "smoke",   "config": {     "bookingId": "cmq68ejz40005pob6zytpiw4v",     "action": "mark-paid",     "routeTemplate": "/api/pro/bookings/:bookingId/checkout/mark-paid",     "hasProCookie": true   },   "totals": {     "requests": 10,     "success": 10,     "expected409": 0,     "expected429": 0,     "realFailures": 0,     "realFailureRateExcludingExpectedPct": 0   },   "statusCounts": {     "200": 10   },   "latencyMs": {     "all": {       "p50": 81.72,       "p95": 749.53,       "p99": 749.53     }   } } 

### What was verified

- Availability bootstrap route returned successful responses locally.
- Hold creation route worked locally with expected rate-limit behavior.
- Booking finalize flow successfully created a finalized booking locally.
- Booking conflict behavior returned expected 409 TIME_BOOKED responses.
- Media route blocked invalid booking/session states before allowing media metadata creation.
- Booking session start route worked locally after the booking was inside the allowed start window.
- Media metadata route returned 10/10 successful responses after the booking was in an allowed AFTER_PHOTOS state.
- Media metadata proof used media-private with PRO_CLIENT visibility.
- Checkout mark-paid route returned 10/10 successful responses locally.
- No real failures were reported by the successful load-script runs.

### What was not verified

- Deployed production booking lifecycle proof.
- Deployed production media/private-storage proof.
- Deployed production checkout/payment proof.
- Stripe live checkout or live webhook behavior.
- Client consultation approval workflow end-to-end.
- Actual binary upload to Supabase Storage.
- Production beta cookies or production beta seeded accounts.
- CI execution for these exact proof runs.
- Public rollout capacity.

### Known limitations

- This was local-only proof against http://localhost:3000.
- The load scripts reported "environment": "staging" because of script naming/config, but the actual target was local.
- Auth cookies were used locally but intentionally not recorded.
- One local booking was manually advanced to SessionStep.AFTER_PHOTOS to isolate and prove media metadata route behavior.
- Manual local DB updates must not be used as production proof.
- LOAD_TEST_ALLOW_SLOT_REUSE=true was used for hold testing due to limited local smoke slot pools.
- Expected 429 RATE_LIMITED and 409 TIME_BOOKED responses were treated as expected by the load scripts and did not count as real failures.
- This proof supports confidence in private beta but does not close the deployed private-beta proof blockers.

### Launch decision

Local booking lifecycle, media metadata, and checkout smoke proof is complete.

Private beta remains NO-GO until deployed booking lifecycle, deployed media/private-storage, deployed payment/webhook, notification/provider proof, support path, rollback path, risk review, dashboard proof, and remaining alert/runbook follow-ups are complete or explicitly accepted.

Public rollout remains NO-GO.

---

## Proof run — local notification processing and Stripe webhook replay smoke proof

- Checklist item: Local notification/provider job and Stripe webhook replay smoke proof.
- Owner: Tori Morales
- Date: 2026-06-09
- Status: PASS locally
- Environment:
  - Local: yes
  - Base URL: http://localhost:3000
  - CI: not recorded
  - Deployed staging: not used
  - Production: not used
- Launch decision impact:
  - Local notification processing smoke: PASS
  - Local Stripe webhook replay smoke: PASS
  - Deployed notification/provider proof: still TODO
  - Deployed payment/webhook proof: still TODO
  - Private beta decision: still NO-GO until deployed/private-beta gates are complete or explicitly accepted
  - Public rollout: NO-GO

### Notification processing

Command:

bash pnpm test:load:notifications 

Result: PASS.

Observed run summary:

json {   "runId": "20260609063454102",   "baseUrl": "http://localhost:3000",   "route": "POST /api/internal/jobs/notifications/process",   "profile": "smoke",   "config": {     "route": "/api/internal/jobs/notifications/process",     "method": "POST",     "take": 100,     "authMode": "bearer",     "hasJobSecret": true   },   "totals": {     "requests": 10,     "success": 10,     "expected401": 0,     "expected429": 0,     "realFailures": 0,     "realFailureRateExcludingExpectedPct": 0   },   "statusCounts": {     "200": 10   },   "latencyMs": {     "all": {       "p50": 20.35,       "p95": 1457.93,       "p99": 1457.93     }   } } 

### Stripe webhook replay

Command:

bash pnpm test:load:stripe-webhook-replay 

Result: PASS.

Observed run summary:

json {   "runId": "20260609063521648",   "baseUrl": "http://localhost:3000",   "route": "POST /api/webhooks/stripe",   "profile": "smoke",   "config": {     "route": "/api/webhooks/stripe",     "method": "POST",     "eventType": "charge.succeeded",     "replayMode": true,     "livemode": false,     "hasWebhookSecret": true,     "bookingId": "cmq68ejz40005pob6zytpiw4v"   },   "totals": {     "totalRequests": 10,     "success": 10,     "expected400": 0,     "expected429": 0,     "realFailures": 0,     "realFailureRateExcludingExpectedPct": 0,     "duplicates": 9,     "handled": 0,     "unhandled": 1   },   "statusCounts": {     "200": 10   },   "latencyMs": {     "all": {       "p50": 22.5,       "p95": 120.13,       "p99": 120.13     }   } } 

### What was verified

- Notification processing job route accepted authorized local smoke requests.
- Notification processing returned 10/10 successful responses.
- Stripe webhook route accepted signed local replay-mode webhook smoke requests.
- Stripe webhook replay returned 10/10 successful responses.
- Stripe webhook idempotency/duplicate handling was visible: 9 duplicate replay responses after the initial event.
- No real failures were reported by either load script.

### What was not verified

- Deployed production notification/provider behavior.
- Live Postmark provider delivery.
- Live Twilio provider delivery.
- Live Stripe checkout behavior.
- Live Stripe webhook delivery from Stripe.
- Deployed payment/webhook proof.
- Deployed provider dashboard proof.
- Public rollout capacity.

### Known limitations

- This was local-only proof against http://localhost:3000.
- The load scripts reported "environment": "staging" because of script naming/config, but the actual target was local.
- Secrets and cookies were used locally but intentionally not recorded.
- Stripe replay mode used synthetic local webhook events, not real Stripe-delivered production events.
- Notification processing proof verified route/job behavior, not live provider delivery.
- This proof supports confidence in private beta but does not close deployed private-beta proof blockers.

### Launch decision

Local notification processing and Stripe webhook replay smoke proof is complete.

Private beta remains NO-GO until deployed notification/provider proof, deployed payment/webhook proof, deployed booking/media proof, support path, rollback path, risk review, dashboard proof, and remaining alert/runbook follow-ups are complete or explicitly accepted.

Public rollout remains NO-GO.

---

## Proof run — production-safe app-generated synthetic Sentry alert routed to Slack

- Checklist item: Production-safe app-generated synthetic alert routing proof.
- Owner: Tori Morales
- Date: 2026-06-08
- Related commits:
  - e9a93fb — Document partial Sentry Slack alert routing proof
  - 92f2d63 — Add stable synthetic Sentry alert tags
- Status: PASS
- Environment:
  - Local: no
  - CI: not applicable
  - Deployed staging: not used
  - Production: yes
- Launch decision impact:
  - Deployed Sentry intake: PASS
  - Sentry-to-Slack routing: PASS
  - Production-safe app-generated synthetic alert routing: PASS
  - Runbook link in Slack message: TODO
  - Formal acknowledgement timing: TODO
  - Live dashboard proof: TODO
  - Private beta decision: still NO-GO until remaining private-beta gates are complete or explicitly accepted
  - Public rollout proof: still NO-GO

### Test summary

This proof verifies that the deployed production app can generate a production-safe synthetic Sentry alert and that Sentry can route that app-generated alert to the selected private-beta Slack alert channel, `#tovis-ops-alerts`.

This proof is stronger than the earlier saved Sentry issue-alert rule test notification because it used the deployed application route instead of only Sentry's alert-builder test notification.

### Command run

```bash
curl -i -X POST "https://www.tovis.app/api/internal/debug/sentry-test" \
  -H "Origin: https://www.tovis.app" \
  -H "Authorization: Bearer $INTERNAL_JOB_SECRET"
```

Result: passed.

HTTP result:

```text
HTTP/2 200
```

Response body:

```json
{
  "ok": true,
  "eventId": "f7a0d19cb4a040a3a21f4679086f166f",
  "message": "Synthetic Sentry event captured.",
  "alertKey": "launch-readiness.synthetic-sentry-alert.v2",
  "alertMessage": "TOVIS production-safe synthetic Sentry alert v2",
  "alertSource": "sentry-debug-route",
  "expectedSlackDestination": "#tovis-ops-alerts"
}
```

### Evidence details

| Field | Value |
|---|---|
| Route | `POST /api/internal/debug/sentry-test` |
| Environment | production |
| Base URL | `https://www.tovis.app` |
| Date tested | 2026-06-08 |
| Time observed | 6:31 PM local |
| Trigger method | Authorized curl request with production origin header and internal job secret |
| Sentry event ID | `f7a0d19cb4a040a3a21f4679086f166f` |
| Alert key | `launch-readiness.synthetic-sentry-alert.v2` |
| Alert message | `TOVIS production-safe synthetic Sentry alert v2` |
| Alert source | `sentry-debug-route` |
| Slack workspace | Tovis |
| Slack channel | `#tovis-ops-alerts` |
| Slack alert rule | `Notify #tovis-ops-alerts via Slack` |
| Slack short ID | `TOVIS-APP-K` |
| Message observed by | Tori |
| Runbook link included in Slack message | No — follow-up TODO |
| Formal acknowledgement timing | TODO |
| Result | PASS |

### What was verified

- Production route accepted a same-origin authorized request.
- Internal job secret authorization worked.
- The deployed app generated a Sentry event.
- The event included stable alert metadata: `launch-readiness.synthetic-sentry-alert.v2`.
- The event used a stable synthetic fingerprint for alert-rule targeting.
- Sentry routed the app-generated alert to `#tovis-ops-alerts`.
- Tori observed the Slack alert.
- The selected private-beta Slack alert channel can receive app-generated Sentry alerts.

### What was not verified

- Runbook link included directly in the Slack alert message.
- Formal acknowledgement timing.
- Route-specific P1/P2 launch-critical alert thresholds.
- Live Sentry dashboard completeness.
- Provider dashboard coverage.
- Public P1 escalation.
- Backup owner.
- Deployed smoke proof for booking, payments, media, notifications, privacy/export/delete, or rollback.

### Known limitations

- This was a production-safe synthetic alert, not a real launch-critical failure.
- This proves the alert pipeline, not every individual P1/P2 alert category.
- The Slack message did not include a runbook link.
- Tori observed the message in Slack, but a formal acknowledgement workflow and timing were not recorded.
- This does not replace live dashboard proof.
- This does not replace support path proof.
- This does not replace rollback proof.
- This does not unblock public rollout.

### Launch decision

This clears the private-beta blocker for basic app-generated synthetic alert routing to Slack.

Private beta remains NO-GO until live dashboard proof, deployed smoke proof, support path, rollback path, risk review, and runbook-link/acknowledgement follow-ups are complete or explicitly accepted in `docs/launch-readiness/go-no-go.md`.

Public rollout remains NO-GO until every private-beta blocker is closed, a named backup owner exists, and a tested P1 escalation path exists.

---

## Proof run — deployed health/readiness endpoints

- Checklist item: Deployed health/readiness proof.
- Owner: Tori Morales
- Date: 2026-06-09
- Related commit:
  - bc88898 — Use unique Redis readiness health keys
- Status: PASS
- Environment:
  - Local: yes, focused health tests only
  - CI: not yet recorded
  - Deployed staging: not used
  - Production: yes
  - Base URL: https://www.tovis.app
- Launch decision impact:
  - /api/health/live: PASS
  - /api/health: PASS
  - /api/health/ready: PASS
  - Redis readiness: PASS after unique health key fix
  - Private beta decision: deployed health/readiness proof is complete
  - Public rollout proof: supports rollout, but public rollout still requires remaining Phase 2 gates

### Test summary

This proof verifies that the deployed production health endpoints are reachable and return controlled JSON responses.

The live endpoint and health alias returned HTTP 200 with status ok.

The readiness endpoint returned HTTP 200 with readiness status ok after Redis readiness was fixed to use unique health-check keys instead of one shared key.

The earlier Redis degraded result was caused by the Redis health check using one shared key, health:ready:redis, which could be overwritten by overlapping readiness checks. Commit bc88898 changed the Redis health check to use unique keys with the prefix health:ready:redis.

### Commands run

bash curl -i "https://www.tovis.app/api/health/live" 

Result: PASS.

Observed summary:

text HTTP/2 200 endpoint: live status: ok x-matched-path: /api/health/live 

bash curl -i "https://www.tovis.app/api/health" 

Result: PASS.

Observed summary:

text HTTP/2 200 endpoint: live status: ok x-matched-path: /api/health 

bash curl -i "https://www.tovis.app/api/health/ready" 

Result: PASS.

Observed summary:

text HTTP/2 200 endpoint: ready status: ok postgres: ok redis: ok storage: ok stripe: ok — configuration present; live provider check disabled postmark: ok — configuration present; live provider check disabled twilio: ok — configuration present; live provider check disabled 

Redis details:

text redis: ok message: Redis is reachable. keyPrefix: health:ready:redis timeoutMs: 2000 

### Focused local health tests

bash pnpm vitest run lib/health app/api/health 

Result: PASS.

text Test Files: 4 passed Tests: 34 passed 

Covered files:

- lib/health/summary.test.ts
- lib/health/checks.test.ts
- app/api/health/live/route.test.ts
- app/api/health/ready/route.test.ts

### Typecheck

bash pnpm typecheck 

Result: PASS.

### What was verified

- The deployed /api/health/live endpoint is reachable.
- The deployed /api/health alias is reachable.
- The deployed /api/health/ready endpoint is reachable.
- The deployed readiness endpoint returns status: ok.
- Postgres readiness returned ok.
- Redis readiness returned ok after switching Redis health checks to unique keys.
- Supabase Storage readiness returned ok for media-private and media-public.
- Stripe configuration readiness returned ok; live provider check is disabled.
- Postmark configuration readiness returned ok; live provider check is disabled.
- Twilio configuration readiness returned ok; live provider check is disabled.
- Focused local health tests passed.
- Typecheck passed.

### What was not verified

- Stripe live provider API check was not enabled.
- Postmark live provider API check was not enabled.
- Twilio live provider API check was not enabled.
- Sentry dashboard section links for health/readiness are still TODO.
- Slack alert rule for health/readiness failure is still TODO.
- Deployed booking lifecycle smoke proof is still TODO.
- Deployed payment/webhook proof is still TODO if payments are enabled for beta.
- Deployed media/private-storage proof is still TODO.
- Deployed notification/provider proof is still TODO if email/SMS are enabled for beta.
- Public rollout readiness is not fully proven.

### Known limitations

- This was production proof, not staging proof.
- Provider live checks are disabled for Stripe, Postmark, and Twilio.
- This proof does not replace Sentry dashboard section proof.
- This proof does not replace route-specific alert threshold proof.
- This proof does not replace support path proof.
- This proof does not replace rollback proof.
- This proof does not replace risk register review.
- The previously exposed Upstash token must be rotated before private beta.

### Launch decision

Deployed health/readiness proof is complete for the private-beta health gate.

Private beta remains NO-GO until remaining Phase 2 blockers are complete or explicitly accepted.

Public rollout remains NO-GO.

---

## Proof run — Phase 2 launch ops local smoke proof rerun

- Checklist item: Phase 2 launch ops local proof is current.
- Owner: Tori Morales
- Date: 2026-06-07
- Related commits:
  - ae30aff20aff8b205e65f57bf3ae8b5b8b553b29 — audited code commit used for earlier Phase 2 local proof
  - 5dc37c1 — Record Phase 2 launch ops local proof
  - 7f0fe87 — Link completed runbooks from Sentry dashboard proof
- Status: Passed locally
- Environment:
  - Local: yes
  - CI: not yet recorded
  - Deployed staging: not yet recorded
  - Production: not used for load testing
- Launch decision impact:
  - Local launch-ops harness: PASS
  - Deployed staging proof: TODO
  - Live dashboard proof: TODO
  - Alert routing proof: PASS for production-safe app-generated synthetic Slack routing; runbook-link-in-message and formal acknowledgement timing still TODO
  - Public rollout proof: TODO

### Test summary

This run verifies that the Phase 2 local launch-ops suite is green after the runbook-link cleanup and current alert/dashboard documentation updates.

The proof covered:

- TypeScript compile safety
- Phase 1 privacy verification
- Deterministic chaos tests
- Aggregate launch load suite
- Availability bootstrap
- Hold create
- Booking finalize
- Checkout
- Media metadata
- Notification processing
- Stripe webhook replay
- Signup/register strict success mode

This proof confirms the local launch-ops test harness works and that the smoke profile can complete successfully against a locally running app via STAGING_BASE_URL=http://localhost:3000.

This proof does not replace deployed staging proof, live Sentry dashboard proof, provider dashboard proof, route-specific P1/P2 alert thresholds, runbook-link-in-message, formal acknowledgement timing, backup owner assignment, public escalation proof, or launch signoff.

### Commands run

```bash
pnpm typecheck
```

Result: passed.

```bash
pnpm verify:privacy-phase1
```

Result: passed.

Privacy verification details:

- check-canonical-normalization: passed
- check-pii-plaintext-reads: passed with 471 known baseline entries
- test:privacy-phase1: 14 files passed, 195 tests passed
- test:privacy-export-delete: 6 files passed, 45 tests passed

```bash
pnpm test:chaos
```

Result: passed.

Chaos verification details:

- 6 test files passed
- 17 tests passed
- Failures: 0
- Skipped: 0

Known stderr during DB degradation tests:

- POST /api/internal/jobs/notifications/process error
- GET /api/internal/jobs/notifications/process error

These stderr messages are expected for the DB degradation chaos tests. The tests verify controlled 500 behavior and no unsafe database failure detail leakage to callers.

```bash
LOAD_TEST_ALLOW_SLOT_REUSE=true \
LOAD_TEST_TRUSTED_IP_HEADER_NAME=x-forwarded-for \
LOAD_TEST_TRUSTED_IP_PREFIX=10.252 \
LOAD_TEST_EXPECT_SIGNUP_SUCCESS=true \
pnpm verify:launch-ops
```

Result: passed.

Aggregate launch load result:

```json
{
  "runId": "20260608020633267",
  "environment": "staging",
  "baseUrl": "http://localhost:3000",
  "profile": "smoke",
  "suite": "launch-load",
  "totals": {
    "steps": 8,
    "passed": 8,
    "failed": 0,
    "skipped": 0
  }
}
```

### Launch load step results

| Step | Status | Result summary |
|---|---|---|
| availability-bootstrap | Passed | 30/30 successful requests; 0 real failures. |
| hold-create | Passed | 10 successful hold creates in the successful full-suite rerun. |
| booking-finalize | Passed | Hold/finalize flow succeeded with expected slot conflict behavior; 0 real failures. |
| checkout | Passed | 10/10 successful checkout mark-paid requests. |
| media-metadata | Passed | 10/10 successful media metadata requests. |
| notifications | Passed | 10/10 successful notification processing requests. |
| stripe-webhook-replay | Passed | 10/10 successful webhook replay requests; duplicate replay behavior visible. |
| signup | Passed | Strict signup-success mode enabled; 30/30 successful client signups, 0 rate limits, 0 real failures. |

### Signup strict success proof

- Run ID: 20260608020803866
- Profile: smoke
- Base URL: http://localhost:3000
- Requests: 30
- Success 201: 30
- Expected 429: 0
- Real failures: 0
- p50 latency: 385.42 ms
- p95 latency: 413.43 ms
- p99 latency: 621.31 ms

### Important configuration used

```bash
LOAD_TEST_ALLOW_SLOT_REUSE=true
LOAD_TEST_TRUSTED_IP_HEADER_NAME=x-forwarded-for
LOAD_TEST_TRUSTED_IP_PREFIX=10.252
LOAD_TEST_EXPECT_SIGNUP_SUCCESS=true
STAGING_BASE_URL=http://localhost:3000
```

### Notes

An earlier launch load rerun failed at signup because the phone pool had already-used numbers and the script correctly classified ACCOUNT_EXISTS as real failures.

The successful rerun used strict signup success mode and synthetic trusted IP headers so signup requests did not collapse into one rate-limit bucket.

Slot reuse was intentionally enabled for local smoke proof because the available selected-day slot pool is limited and conflict pressure is expected during hold/finalize testing.

### Known limitations

- Local only. This run targeted http://localhost:3000, not a deployed staging URL.
- The load scripts reported "environment": "staging" because of environment naming, but the actual target was local.
- The load script output reported "commit": null; record the actual commit manually using git rev-parse HEAD before final launch signoff.
- Hold/finalize proof used LOAD_TEST_ALLOW_SLOT_REUSE=true, so expected slot conflicts are part of the proof. This is acceptable for local smoke proof but not final public rollout capacity proof.
- Synthetic trusted IP headers were used to prove signup success behavior without all requests collapsing into one rate-limit bucket.
- Signup load creates real local test users and consumes the phone pool. Future runs require a fresh phone pool or generated non-delivering test numbers.
- This does not prove deployed staging or production readiness.
- This does not prove live Sentry dashboard coverage.
- This local proof does not prove Slack/PagerDuty/Opsgenie alert delivery. A later production-safe app-generated Sentry alert proved Slack routing to `#tovis-ops-alerts`; see proof run above.
- This does not prove provider dashboard coverage for Stripe, Postmark, Twilio, Supabase, Vercel, database, or Redis.
- Public rollout still requires deployed staging proof, provider capacity proof, route-specific P1/P2 alert proof, runbook-link-in-message, formal acknowledgement timing, backup owner, tested escalation, and final go/no-go signoff.

### Follow-ups

- Record the current commit SHA after this proof update is committed.
- Update docs/launch-readiness/go-no-go.md to point to this proof.
- Run the same suite against a deployed staging target and record that separately.
- Build and link live Sentry dashboard sections.
- Add runbook-link-in-message and formal acknowledgement timing for the production-safe app-generated synthetic alert, or explicitly accept those as private-beta follow-ups in go-no-go.md.

---

## Proof run — booking/session safe logging hardening

- Checklist item: Replace raw error logging in booking/session hot routes and sibling booking routes.
- Owner: Tori Morales
- Date: 2026-05-23
- Related commit: 8f2a424 — Harden booking route error logging
- Status: Passed locally
- Environment:
  - Local: yes
  - CI: not yet recorded
  - Staging: not yet recorded
  - Production: not yet recorded

### Test summary

This run verifies that the booking/session route logging hardening removed raw console.error(..., error) logging patterns from the scoped booking API routes and that the updated route tests still pass.

The focused proof covered Pro booking creation, Pro booking read/update, cancel, final review, consultation services, checkout mark-paid, checkout waive, invite, rebook, session finish, and client booking reschedule routes.

### Commands run

```bash
grep -RIn \
  --exclude-dir=node_modules \
  --exclude-dir=.next \
  --exclude-dir=.git \
  --include='route.ts' \
  "console\.error([^,]*,[[:space:]]*error[)]" app/api/pro/bookings app/api/bookings
```

Result: no matches. The raw console.error(..., error) pattern is absent from the scoped booking route files.

```bash
pnpm vitest run \
  app/api/pro/bookings/route.test.ts \
  'app/api/pro/bookings/[id]/route.test.ts' \
  'app/api/pro/bookings/[id]/cancel/route.test.ts' \
  'app/api/pro/bookings/[id]/final-review/route.test.ts' \
  'app/api/pro/bookings/[id]/consultation-services/route.test.ts' \
  'app/api/pro/bookings/[id]/checkout/mark-paid/route.test.ts' \
  'app/api/pro/bookings/[id]/checkout/waive/route.test.ts' \
  'app/api/pro/bookings/[id]/invite/route.test.ts' \
  'app/api/pro/bookings/[id]/rebook/route.test.ts' \
  'app/api/pro/bookings/[id]/session/finish/route.test.ts' \
  'app/api/bookings/[id]/reschedule/route.test.ts'
```

Result: 11 test files passed, 153 tests passed.

```bash
pnpm typecheck
```

Result: passed.

### Limitations

- Local only. CI run for the same suite is not yet recorded here.
- Staging deploy verification not yet recorded.
- Production verification not yet recorded.
- Grep is scoped to app/api/pro/bookings and app/api/bookings and to the pattern console.error(..., error). Other call patterns, for example console.error('message', { ...payload }), and other directories, notably lib/booking/writeBoundary.ts, are not covered by this proof. A follow-up ticket covers logHoldCreateInternalError sanitation.

---

## Proof run — contact lookup hash decision documented

- Checklist item: SHA-256 vs HMAC contact hash decision documented.
- Owner: Tori Morales
- Date: 2026-05-23
- Related commits:
  - 9ff31e3 — Repair launch-readiness test-proof.md evidence record
  - 0abef2f — Complete contact lookup hash threat model
- Status: Decision recorded; code still uses SHA-256.
- Environment:
  - Local: yes, doc-only
  - CI: N/A, doc-only
  - Staging: N/A, doc-only
  - Production: N/A, doc-only

### Test summary

This is a documentation proof, not a code proof. It records that the launch-time decision for contact lookup hashing has been written down and linked from the sprint-1 verification checklist.

Decision summary, see docs/security/contact-lookup-hash-threat-model.md for full rationale:

- Current implementation: plain SHA-256 over normalized contact field.
- Risk: bounded — internal-only use, scoped to operator/DB compromise.
- Accepted for private beta / early controlled launch.
- Future migration: HMAC-SHA256 with a versioned, KMS-backed key, using a dual-write + backfill + cut-over pattern. Out of scope for this sprint.

### Commands run

```bash
sed -n '1,220p' docs/security/contact-lookup-hash-threat-model.md
grep -n "SHA-256 vs HMAC contact hash decision documented" \
  docs/launch-readiness/sprint-1-verification-checklist.md
```

Result: file exists, fences closed, trailing newline present; checklist row "SHA-256 vs HMAC contact hash decision documented" is IN PROGRESS and points at the threat-model doc.

### Limitations

- This proof covers the documented decision only. No code has changed. lib/security/crypto/hashLookup.ts still uses SHA-256.
- The HMAC-SHA256 migration is intentionally deferred. It is not tracked by this proof and remains an open future ticket.
- No CI/staging/prod runs apply — this is documentation, not runtime behavior.

---

## Proof run — deployed signup load proof (isolated staging)

- Checklist item: Deployed signup load proof (the launch gate previously blocked on the absence of an isolated staging environment).
- Owner: Tori Morales
- Date: 2026-06-25
- App commit deployed: `2c80cdec` (main HEAD; #356–#360 merged)
- Status: PASS at launch floor (10–25 rps clean); throughput ceiling identified at ~40 rps on free-tier staging.
- Environment:
  - Local: harness only (`tests/load/signup-load-test.ts`)
  - Staging app: Vercel **preview** deployment (`VERCEL_ENV=preview`)
  - Staging DB: dedicated Supabase project `tovis-staging` (`wbujonpayicvocvvoutk`, us-west-1) — **fully isolated from prod** (`rqhhvuaoksuvbvlypztn`). Migrated via `prisma migrate deploy` + `pnpm seed`.
  - Real delivery: **suppressed** — `LOAD_TEST_DISABLE_REAL_DELIVERY=1` on the preview. Runtime logs confirm Twilio `status:"load_test_suppressed"` and the email verification path early-returns before Postmark (no real SMS/email sent).
  - Captcha: Cloudflare Turnstile **test keys** on the preview (always-pass), so the harness token validates.
  - Reachability: Vercel Deployment Protection bypassed via Protection Bypass for Automation (`x-vercel-protection-bypass`).
  - Distinct client IPs simulated via a staging-only `AUTH_TRUSTED_IP_HEADER=x-load-test-client-ip` + harness `LOAD_TEST_TRUSTED_IP_*` (so per-IP rate limiting doesn't collapse all requests into one bucket).

### Test summary

`tests/load/signup-load-test.ts` driven against the deployed staging preview, POSTing `/api/auth/register` (CLIENT signups). Three configs were measured. Each signup writes a real `User`/`ClientProfile` into the isolated staging DB (verified present; prod untouched).

| Profile / config | Requests | 201 OK | 500 | Real-fail % | p95 (ms) | p99 (ms) |
|---|---|---|---|---|---|---|
| **baseline** 10 rps (pgbouncer, no conn-limit) | 600 | 600 | 0 | **0%** | 1417 | 3641 |
| **baseline** 25 rps | 1500 | 1500 | 0 | **0%** | 1325 | 1437 |
| launch 50 rps | 3000 | 2468 | 532 | 18% | 3575 | 4165 |
| launch 100 rps | 6000 | 2473 | 3524 | 59% | 4477 | 7166 |
| launch 10 rps w/ `connection_limit=1` | 600 | 537 | 62 | 10% | 2941 | 3953 |

### Findings

- **Signup works end-to-end on a real deployment.** At the launch traffic *floor* (10–25 rps) the deployed signup pipeline is clean: 0 failures, 0 throttles, p95 ≈ 1.3–1.4 s.
- **Ceiling ≈ 40 successful signups/sec on this (free) tier.** Beyond ~40 rps the failures are DB-connection errors from Vercel runtime logs: `FATAL: (EMAXCONN) max client connections reached` and `Transaction API error: Unable to start a transaction in the given time`. This is the **Supabase free-tier pooler's global client-connection cap**, hit when the serverless fleet fans out under burst — an infra ceiling of the staging tier, not a code defect.
- **`connection_limit=1` makes it worse, not better** (10 rps regressed to 10% failures). The register flow uses DB transactions, so one connection per instance starves the transaction. Lowering `connection_limit` is the wrong lever.

### Commands run

```bash
# (env values redacted; secrets passed via process env, not committed)
STAGING_BASE_URL=<preview-url> \
VERCEL_AUTOMATION_BYPASS_SECRET=<secret> \
TURNSTILE_TEST_TOKEN=dummy LOAD_TEST_DELIVERY_SAFE=1 \
LOAD_TEST_PHONE_POOL_FILE=<pool> \
LOAD_TEST_TRUSTED_IP_HEADER_NAME=x-load-test-client-ip LOAD_TEST_TRUSTED_IP_PREFIX=10.x \
LOAD_TEST_PROFILE=baseline|launch \
pnpm exec tsx tests/load/signup-load-test.ts
```

### Limitations / next steps

- This proves the **signup** step only. The other 7 launch-load steps (holds, booking-finalize, checkout, media, notifications, stripe-replay) still need their fixtures wired against staging to run the full `verify:launch-ops` suite deployed.
- The ~40 rps ceiling is the **free-tier** staging DB. **Production runs on a paid Supabase tier** with much higher pooler limits; re-prove the 100 rps target there (or against a paid staging tier) before treating 100 rps as met. Candidate prod-side mitigations if needed: paid pooler capacity, Prisma Accelerate / a connection multiplexer, or Vercel fluid-compute concurrency tuning — **not** a lowered `connection_limit`.
- Staging carries ~21k synthetic `signup.load+*@example.com` users from these runs; harmless (isolated), truncate for a clean slate if desired.
