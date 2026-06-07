# TOVIS Launch Readiness Test Proof

This file records concrete test/proof runs for launch-readiness work.

Do not mark a launch-readiness item fully proven unless the relevant command, environment, commit SHA, result, and known limitations are recorded here.

---

## Proof run — Phase 2 launch-ops local smoke proof

- Checklist item: Phase 2 launch ops proof — chaos suite and launch load suite.
- Owner: Tori Morales
- Date: 2026-06-07
- Related commit: TODO — run git rev-parse HEAD and paste the SHA here.
- Status: Passed locally with documented caveats.
- Environment:
  - Local: yes
  - CI: not yet recorded
  - Staging: not yet recorded
  - Production: not yet recorded
- Launch decision impact:
  - Local launch-ops harness: PASS
  - Deployed staging proof: TODO
  - Live dashboard proof: TODO
  - Alert routing proof: TODO
  - Public rollout proof: TODO

### Test summary

This run verifies that the Phase 2 launch-ops local proof harness is green.

The proof covered:

- chaos/failure-mode tests
- availability bootstrap load
- hold create load
- booking finalize load
- checkout load
- media metadata load
- notification processing load
- Stripe webhook replay load
- signup load with strict signup-success proof

This proof confirms the local launch-ops test harness works and that the smoke profile can complete successfully against a locally running app via STAGING_BASE_URL=http://localhost:3000.

This proof does not replace deployed staging proof, live Sentry dashboard proof, provider dashboard proof, Slack/PagerDuty/Opsgenie alert routing proof, or public rollout signoff.

### Commands run

bash pnpm vitest run tests/chaos/redis-outage.test.ts --config vitest.config.mts 

Result: 1 test file passed, 1 test passed.

bash pnpm test:chaos 

Result: 6 test files passed, 17 tests passed.

Known stderr during DB degradation tests:

- POST /api/internal/jobs/notifications/process error
- GET /api/internal/jobs/notifications/process error

These stderr messages are expected for the DB degradation chaos tests. The tests verify controlled 500 behavior and no unsafe database failure detail leakage to callers.

bash pnpm test 

Result: 311 test files passed, 3317 tests passed.

bash LOAD_TEST_TRUSTED_IP_HEADER_NAME=x-forwarded-for \ LOAD_TEST_TRUSTED_IP_PREFIX=10.251 \ LOAD_TEST_EXPECT_SIGNUP_SUCCESS=true \ pnpm test:load:signup 

Result: passed.

Signup strict success proof:

- Run ID: 20260607191115006
- Profile: smoke
- Base URL: http://localhost:3000
- Requests: 30
- success201: 30
- expected429: 0
- realFailures: 0
- p50: 383.78 ms
- p95: 407.27 ms
- p99: 624.82 ms

bash LOAD_TEST_ALLOW_SLOT_REUSE=true \ LOAD_TEST_TRUSTED_IP_HEADER_NAME=x-forwarded-for \ LOAD_TEST_TRUSTED_IP_PREFIX=10.252 \ LOAD_TEST_EXPECT_SIGNUP_SUCCESS=true \ pnpm verify:launch-ops 

Result: passed.

Aggregate launch load result:

- Run ID: 20260607191351099
- Profile: smoke
- Environment label: staging
- Actual target: local app via STAGING_BASE_URL=http://localhost:3000
- Total duration: 120591.24 ms
- Steps: 8
- Passed: 8
- Failed: 0
- Skipped: 0

### Launch load step results

| Step | Status | Result summary |
|---|---|---|
| availability-bootstrap | Passed | Smoke profile completed successfully. |
| hold-create | Passed | 10 successful hold creates; no real failures in final full-suite run. |
| booking-finalize | Passed | 1 hold/finalize flow succeeded; 4 expected TIME_BOOKED conflicts due to slot reuse; no real failures. |
| checkout | Passed | 10/10 successful checkout mark-paid requests. |
| media-metadata | Passed | 10/10 successful media metadata requests. |
| notifications | Passed | 10/10 successful notification processing requests. |
| stripe-webhook-replay | Passed | 10/10 successful webhook replay requests; 9 duplicate replay responses and 1 unhandled replay event were reported by the script. |
| signup | Passed | Strict signup-success mode enabled; 30/30 successful client signups, 0 rate limits, 0 real failures. |

### Important configuration used

bash LOAD_TEST_ALLOW_SLOT_REUSE=true LOAD_TEST_TRUSTED_IP_HEADER_NAME=x-forwarded-for LOAD_TEST_TRUSTED_IP_PREFIX=10.252 LOAD_TEST_EXPECT_SIGNUP_SUCCESS=true STAGING_BASE_URL=http://localhost:3000 

### Known limitations

- Local only. This run targeted http://localhost:3000, not a deployed staging URL.
- The load scripts reported environment: "staging" because of environment naming, but the actual target was local.
- The load script output reported commit: null; record the actual commit manually using git rev-parse HEAD.
- Hold/finalize proof used LOAD_TEST_ALLOW_SLOT_REUSE=true, so expected slot conflicts are part of the proof. This is acceptable for local smoke proof but not final public rollout capacity proof.
- Synthetic trusted IP headers were used to prove signup success behavior without all requests collapsing into one rate-limit bucket.
- Signup load creates real local test users and consumes the phone pool. Future runs require a fresh phone pool.
- This does not prove deployed staging or production readiness.
- This does not prove live Sentry dashboard coverage.
- This does not prove Slack/PagerDuty/Opsgenie alert delivery.
- This does not prove provider dashboard coverage for Stripe, Postmark, Twilio, Supabase, Vercel, database, or Redis.
- Public rollout still requires deployed staging proof, provider capacity proof, alert proof, backup owner, tested escalation, and final go/no-go signoff.

### Follow-ups

- Record the current commit SHA.
- Update docs/launch-readiness/go-no-go.md to point to this proof.
- Update docs/launch-readiness/load-test-plan.md from TODO to PASS LOCALLY / STAGING PROOF TODO.
- Update docs/launch-readiness/chaos-test-plan.md from TODO/stale proof to PASS LOCALLY / OPERATIONAL PROOF TODO.
- Update docs/launch-readiness/risk-register.md to mark local load/chaos implementation risks as mitigated locally while keeping dashboard/alert/provider proof risks open.
- Run the same suite against a deployed staging target and record that separately.
- Build and link live Sentry dashboard sections.
- Wire alert routing and record one synthetic alert delivery proof.

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

bash grep -RIn \   --exclude-dir=node_modules \   --exclude-dir=.next \   --exclude-dir=.git \   --include='route.ts' \   "console\.error([^,]*,[[:space:]]*error[)]" app/api/pro/bookings app/api/bookings 

Result: no matches. The raw console.error(..., error) pattern is absent from the scoped booking route files.

bash pnpm vitest run \   app/api/pro/bookings/route.test.ts \   'app/api/pro/bookings/[id]/route.test.ts' \   'app/api/pro/bookings/[id]/cancel/route.test.ts' \   'app/api/pro/bookings/[id]/final-review/route.test.ts' \   'app/api/pro/bookings/[id]/consultation-services/route.test.ts' \   'app/api/pro/bookings/[id]/checkout/mark-paid/route.test.ts' \   'app/api/pro/bookings/[id]/checkout/waive/route.test.ts' \   'app/api/pro/bookings/[id]/invite/route.test.ts' \   'app/api/pro/bookings/[id]/rebook/route.test.ts' \   'app/api/pro/bookings/[id]/session/finish/route.test.ts' \   'app/api/bookings/[id]/reschedule/route.test.ts' 

Result: 11 test files passed, 153 tests passed.

bash pnpm typecheck 

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

bash sed -n '1,220p' docs/security/contact-lookup-hash-threat-model.md grep -n "SHA-256 vs HMAC contact hash decision documented" \   docs/launch-readiness/sprint-1-verification-checklist.md 

Result: file exists, fences closed, trailing newline present; checklist row "SHA-256 vs HMAC contact hash decision documented" is IN PROGRESS and points at the threat-model doc.

### Limitations

- This proof covers the documented decision only. No code has changed. lib/security/crypto/hashLookup.ts still uses SHA-256.
- The HMAC-SHA256 migration is intentionally deferred. It is not tracked by this proof and remains an open future ticket.
- No CI/staging/prod runs apply — this is documentation, not runtime behavior.