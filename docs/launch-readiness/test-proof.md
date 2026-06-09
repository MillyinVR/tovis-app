# TOVIS Launch Readiness Test Proof

This file records concrete test/proof runs for launch-readiness work.

Do not mark a launch-readiness item fully proven unless the relevant command, environment, commit SHA, result, and known limitations are recorded here.

---

## Proof run — production-safe app-generated synthetic Sentry alert routed to Slack

- Checklist item: Production-safe app-generated synthetic alert routing proof.
- Owner: Tori Morales
- Date: 2026-06-08
- Related commits:
  - e9a93fb — Document partial Sentry Slack alert routing proof
  - TODO — Add stable synthetic Sentry alert tags
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
- Deployed smoke proof for health/readiness, booking, payments, media, notifications, privacy/export/delete, or rollback.

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