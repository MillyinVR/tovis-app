# TOVIS Launch Readiness Checklist

This checklist tracks the remaining work required before TOVIS is safe to launch to real users at scale.

Status values must follow `docs/launch-readiness/status-rubric.md`.

## Tracking fields

Each item should include:

- Owner
- Status
- Priority
- Source
- Implementation reference
- Test evidence
- Rollback notes
- Known risks

---

# Phase 0 — Freeze and baseline

## Goal

Create the launch-readiness control documents needed to track the remaining work.

## Acceptance criteria

| Item | Owner | Status | Priority | Source | Implementation reference | Test evidence | Rollback notes | Known risks |
|---|---|---|---|---|---|---|---|---|
| Create launch-readiness README | TBD | DONE | P1 | Launch readiness plan | `docs/launch-readiness/README.md` | Documentation review | Revert doc file | None |
| Create master checklist | TBD | DONE | P0 | Launch readiness plan | `docs/launch-readiness/checklist.md` | Documentation review | Revert doc file | Checklist must stay maintained |
| Create sprint index | TBD | DONE | P1 | Launch readiness plan | `docs/launch-readiness/sprint-index.md` | Documentation review | Revert doc file | Estimates can drift if not updated |
| Create status rubric | TBD | DONE | P1 | Launch readiness plan | `docs/launch-readiness/status-rubric.md` | Documentation review | Revert doc file | Status misuse can hide risk |
| Create rollback template | TBD | DONE | P1 | Launch readiness plan | `docs/launch-readiness/rollback-template.md` | Documentation review | Revert doc file | Template must be used for runtime changes |
| Create test evidence template | TBD | DONE | P1 | Launch readiness plan | `docs/launch-readiness/test-evidence-template.md` | Documentation review | Revert doc file | Template must be used before marking runtime work verified |
| Create enterprise handoff notes | TBD | TODO | P1 | Launch readiness plan | `docs/launch-readiness/handoff.md` | Documentation review | Revert doc file | Missing handoff doc weakens enterprise readiness |

---

# Phase 1 — Lifecycle correctness

## Goal

Make booking lifecycle behavior safe, consistent, and testable.

## Acceptance criteria

| Item | Owner | Status | Priority | Source | Implementation reference | Test evidence | Rollback notes | Known risks |
|---|---|---|---|---|---|---|---|---|
| Strict lifecycle behavior enabled by default | TBD | DONE | P0 | Audit finding | `lib/booking/lifecycleContract.ts`, `lib/booking/writeBoundary.ts` | Needs linked test evidence | Runtime rollback required if behavior changes | Must verify staging/prod env |
| Checkout actor is `SYSTEM` where required | TBD | DONE | P0 | Audit finding | Booking checkout flow | Needs linked test evidence | Runtime rollback required | Must verify payment edge cases |
| Direct `DONE` UI path removed | TBD | DONE | P0 | Audit finding | Pro session UI | Needs linked regression test | Runtime rollback required | Must ensure no alternate direct DONE path exists |
| Wrap-up blockers aligned with backend closeout criteria | TBD | DONE | P0 | Audit finding | Pro session wrap-up UI | Needs linked regression test | Runtime rollback required | Must verify payment/checkout/aftercare/photo combinations |
| After-photo step fixed | TBD | DONE | P0 | Audit finding | Pro session flow | Needs linked test evidence | Runtime rollback required | Must verify media phase behavior |
| `IN_PROGRESS` visibility fixed | TBD | DONE | P1 | Audit finding | Booking/session UI | Needs linked test evidence | Runtime rollback required | Must verify pro dashboard filters |
| Endpoint hints fixed | TBD | DONE | P2 | Audit finding | Relevant API/UI hints | Documentation or regression proof | Runtime rollback if user-facing | None |
| Lifecycle regression suite exists | TBD | TODO | P0 | Launch readiness plan | Test files | Required before public launch | None | Direct DONE bug could regress |
| Staging/prod telemetry soak completed | TBD | TODO | P1 | Launch readiness plan | Sentry/log dashboard | Required before public launch | None | Lifecycle drift may appear only under real use |

---

# Phase 2 — Token and retry safety

## Goal

Make externally retryable and token-backed flows safe, idempotent, and auditable.

## Acceptance criteria

| Item | Owner | Status | Priority | Source | Implementation reference | Test evidence | Rollback notes | Known risks |
|---|---|---|---|---|---|---|---|---|
| Cancel route idempotency | TBD | DONE | P0 | Audit finding | `app/api/bookings/[id]/cancel/route.ts` | Needs linked test evidence | Runtime rollback required | Duplicate cancellation side effects must stay impossible |
| Reschedule route idempotency | TBD | DONE | P0 | Audit finding | `app/api/bookings/[id]/reschedule/route.ts` | Needs linked test evidence | Runtime rollback required | Duplicate reschedule side effects must stay impossible |
| Finalize idempotency | TBD | DONE | P0 | Audit finding | Booking finalize route | Needs linked test evidence | Runtime rollback required | Token flows must remain covered |
| Media metadata idempotency | TBD | DONE | P0 | Audit finding | Pro booking media route | Needs linked test evidence | Runtime rollback required | Duplicate media rows must remain impossible |
| Aftercare idempotency | TBD | DONE | P0 | Audit finding | Pro aftercare route | Needs linked test evidence | Runtime rollback required | Delivery side effects must be atomic |
| Client rebook idempotency | TBD | DONE | P0 | Audit finding | Client rebook route | Needs linked test evidence | Runtime rollback required | Token-backed rebook must remain safe |
| publicToken deprecation guard | TBD | DONE | P0 | Audit finding | Aftercare token tests | Needs linked test evidence | None | `AftercareSummary.publicToken` still exists in schema |
| Idempotency map document | TBD | TODO | P1 | Launch readiness plan | `docs/launch-readiness/idempotency-map.md` | Documentation review | Revert doc file | Missing map makes future regressions easier |
| Aftercare send atomicity | TBD | TODO | P0 | Audit finding | Pro aftercare route / delivery enqueue | Required before public launch | Runtime rollback required | False-success send state is user-facing |

---

# Phase 3 — Verification and onboarding policy

## Goal

Prevent unready Pros from becoming bookable or entering booking-critical flows.

## Acceptance criteria

| Item | Owner | Status | Priority | Source | Implementation reference | Test evidence | Rollback notes | Known risks |
|---|---|---|---|---|---|---|---|---|
| Verification readiness policy decided | TBD | TODO | P0 | Audit finding | Product/security decision doc | Decision record required | Policy rollback required | Pending/manual-review Pros may be too permissive |
| Pro onboarding hard redirect gate | TBD | TODO | P0 | Audit finding | `app/pro/layout.tsx` or route-level guard | E2E or integration proof required | Runtime rollback required | Unready Pros may reach booking-sensitive routes |
| Readiness blocker routes verified | TBD | TODO | P1 | Launch readiness plan | Pro readiness mapping | Test evidence required | Runtime rollback if behavior changes | Incorrect redirects can trap users |
| Marketplace visibility respects readiness | TBD | TODO | P0 | Audit finding | Search/index/readiness logic | Integration proof required | Runtime rollback required | Unready Pros may appear bookable |
| Support/admin override policy documented | TBD | TODO | P1 | Enterprise handoff | Policy doc | Documentation review | Policy rollback | Manual overrides can create inconsistent states |

---

# Phase 4 — Boundary hardening

## Goal

Prevent future code from bypassing lifecycle, booking, payment, and checkout boundaries.

## Acceptance criteria

| Item | Owner | Status | Priority | Source | Implementation reference | Test evidence | Rollback notes | Known risks |
|---|---|---|---|---|---|---|---|---|
| Existing booking write boundary retained | TBD | DONE | P0 | Existing architecture | `lib/booking/writeBoundary.ts` | Boundary script evidence needed | None | Boundary can erode without CI |
| Lifecycle field-level CI guard | TBD | TODO | P0 | Audit finding | `tools/check-lifecycle-field-writes.mjs` | CI evidence required | Revert script if false positive | Direct lifecycle writes can reappear |
| Pro-side manual checkout API decision | TBD | TODO | P0 | Audit finding | Checkout design/API doc or route | Test evidence if implemented | Runtime rollback required | Pro closeout/payment parity unclear |
| Stripe webhook transactional atomicity test | TBD | TODO | P0 | Audit finding | Stripe webhook tests | Integration proof required | Runtime rollback required | Payment state can become unrecoverable |
| Payment state transition documentation | TBD | TODO | P1 | Enterprise handoff | Payment lifecycle doc | Documentation review | Revert doc file | Support may not know how to reconcile payment mismatch |

---

# Phase 5 — Secure media and storage

## Goal

Make private media access safe, auditable, and recoverable.

## Acceptance criteria

| Item | Owner | Status | Priority | Source | Implementation reference | Test evidence | Rollback notes | Known risks |
|---|---|---|---|---|---|---|---|---|
| Supabase Storage RLS policy migration exists | TBD | DONE | P0 | Audit finding | `supabase/migrations/20260514180000_storage_media_bucket_policies.sql` | Needs policy test or live verification | Provider rollback required | Must confirm applied in live project |
| Supabase policy SQL tests | TBD | TODO | P0 | Launch readiness plan | Supabase policy test file | Required before public launch | Provider rollback required | Private media access could be misconfigured |
| Booking media path/bucket/object checks | TBD | DONE | P0 | Audit finding | Pro upload/media routes | Needs linked test evidence | Runtime rollback required | Must verify phase/path edge cases |
| Media audit enum actions | TBD | DONE | P1 | Audit finding | `BookingCloseoutAuditAction` | Schema/migration evidence | Migration rollback required | Enum alone does not prove write-path use |
| Media audit write-path verified | TBD | TODO | P0 | Audit finding | `uploadProBookingMedia` or equivalent | Integration proof required | Runtime rollback required | Media evidence may lack forensic trail |
| Upload-token binding | TBD | TODO | P1 | Audit finding | Upload route / metadata route | Integration proof required | Runtime rollback required | Upload token may be reused unexpectedly |
| Checksum validation | TBD | TODO | P2 | Launch readiness plan | Upload/media pipeline | Test evidence required | Runtime rollback required | Corrupt uploads may be accepted |
| Orphan cleanup | TBD | TODO | P1 | Launch readiness plan | Cleanup job | Job test required | Runtime rollback required | Storage cost and privacy risk |
| Scan/moderation flow | TBD | TODO | P1 | Launch readiness plan | Media processing pipeline | Test evidence required | Runtime rollback required | Unsafe media may become visible |

---

# Phase 6 — Health and operations

## Goal

Make the system observable, diagnosable, and operable.

## Acceptance criteria

| Item | Owner | Status | Priority | Source | Implementation reference | Test evidence | Rollback notes | Known risks |
|---|---|---|---|---|---|---|---|---|
| `/api/health/live` endpoint | TBD | TODO | P0 | Audit finding | Health route | Test evidence required | Runtime rollback required | App liveness may be unclear |
| `/api/health/ready` endpoint | TBD | TODO | P0 | Audit finding | Health route | Test evidence required | Runtime rollback required | Dependency failures may go undetected |
| Postgres readiness probe | TBD | TODO | P0 | Audit finding | Health readiness check | Test evidence required | Runtime rollback required | DB outage may not be detected |
| Redis readiness probe | TBD | TODO | P0 | Audit finding | Health readiness check | Test evidence required | Runtime rollback required | Queue/cache/rate-limit failures may be hidden |
| Supabase Storage readiness probe | TBD | TODO | P1 | Audit finding | Health readiness check | Test evidence required | Runtime rollback required | Media failures may be hidden |
| Stripe readiness probe | TBD | TODO | P1 | Audit finding | Health readiness check | Test evidence required | Runtime rollback required | Payment failures may be hidden |
| Postmark readiness probe | TBD | TODO | P1 | Audit finding | Health readiness check | Test evidence required | Runtime rollback required | Email failures may be hidden |
| Twilio readiness probe | TBD | TODO | P1 | Audit finding | Health readiness check | Test evidence required | Runtime rollback required | SMS failures may be hidden |
| Runbook directory | TBD | TODO | P0 | Launch readiness plan | `docs/runbooks/` | Documentation review | Revert docs | Operators lack recovery steps |
| Launch dashboard list | TBD | TODO | P1 | Launch readiness plan | Dashboard doc | Documentation review | Revert docs | Metrics may be missing at launch |

---

# Phase 7 — Realtime and push

## Goal

Make booking/session state changes visible to the right user without manual refresh.

## Acceptance criteria

| Item | Owner | Status | Priority | Source | Implementation reference | Test evidence | Rollback notes | Known risks |
|---|---|---|---|---|---|---|---|---|
| Realtime strategy selected | TBD | TODO | P0 | Audit finding | Decision doc | Documentation review | Revert doc | Dead publisher may persist |
| Notification version polling endpoint | TBD | TODO | P0 | Launch readiness plan | API route | Integration proof required | Runtime rollback required | Pro UI may not update |
| Session state refresh wiring | TBD | TODO | P0 | Launch readiness plan | Pro session UI | E2E proof required | Runtime rollback required | Client approval/payment may require refresh |
| Dead Redis publisher decision | TBD | TODO | P1 | Audit finding | Notification processor / doc | Test or doc evidence | Runtime rollback if changed | Misleading infrastructure |
| Mobile push decision | TBD | TODO | P2 | Launch readiness plan | Push decision doc | Documentation review | Revert doc | Mobile UX may depend on SMS only |

---

# Phase 8 — Rate limiting and abuse protection

## Goal

Protect auth, SMS, token, booking, and media routes from abuse.

## Acceptance criteria

| Item | Owner | Status | Priority | Source | Implementation reference | Test evidence | Rollback notes | Known risks |
|---|---|---|---|---|---|---|---|---|
| Central rate-limit policy module | TBD | DONE | P0 | Audit finding | `lib/rateLimit/policies.ts` | Needs linked test evidence | Runtime rollback required | Policies must be enforced |
| Global middleware or wrapper enforcement | TBD | TODO | P0 | Audit finding | Middleware or route wrapper | Test evidence required | Runtime rollback required | Policies may exist but not run |
| Auth route rate limits | TBD | TODO | P0 | Audit finding | Auth routes / middleware | Test evidence required | Runtime rollback required | Signup/login abuse |
| SMS route rate limits | TBD | TODO | P0 | Audit finding | Phone routes / middleware | Test evidence required | Runtime rollback required | Twilio abuse cost |
| SMS fail-closed behavior | TBD | TODO | P0 | Audit finding | Rate-limit helper / SMS routes | Test evidence required | Runtime rollback required | Redis outage may allow SMS abuse |
| Origin/Referer checks | TBD | TODO | P1 | Audit finding | Middleware | Test evidence required | Runtime rollback required | Subdomain/cookie abuse risk |
| Token route rate limits | TBD | TODO | P1 | Audit finding | Public token routes | Test evidence required | Runtime rollback required | Token brute force risk |
| Media route rate limits | TBD | TODO | P1 | Audit finding | Upload/media routes | Test evidence required | Runtime rollback required | Upload abuse risk |

---

# Phase 9 — NFC and claim trust boundaries

## Goal

Make NFC, short-code, and claim-invite flows safe before they are launch-scoped.

## Acceptance criteria

| Item | Owner | Status | Priority | Source | Implementation reference | Test evidence | Rollback notes | Known risks |
|---|---|---|---|---|---|---|---|---|
| NFC tap-card tests | TBD | DONE | P1 | Audit finding | `app/t/[cardId]/page.test.tsx` | Needs linked test evidence | Runtime rollback if behavior changes | Full NFC launch scope still needs decision |
| Short-code redirect tests | TBD | DONE | P1 | Audit finding | `app/c/[code]/page.test.tsx` | Needs linked test evidence | Runtime rollback if behavior changes | Tap-code rate limiting still needed |
| NFC trust-boundary doc | TBD | DONE | P1 | Audit finding | NFC/claim audit doc | Documentation review | Revert doc | Deferred work must be tracked |
| Claim flow audit doc | TBD | DONE | P1 | Audit finding | NFC/claim audit doc | Documentation review | Revert doc | Deferred work must be tracked |
| ProClientInvite tokenHash migration | TBD | TODO | P1 | Audit finding | Prisma migration / claim flow | Migration test required | Migration rollback required | Raw invite token remains in DB |
| Tap-code rate limiting | TBD | TODO | P1 | Audit finding | Middleware or route-level limit | Test evidence required | Runtime rollback required | Enumeration or abuse risk |
| NFC readiness bypass proof | TBD | TODO | P0 if launch-scoped | Audit finding | NFC booking path tests | E2E or integration proof | Runtime rollback required | Unready Pros could be bookable through NFC |
| Claim accept idempotency proof | TBD | TODO | P1 | Audit finding | Claim flow tests | Test evidence required | Runtime rollback required | Duplicate claim side effects |

---

# Phase 10 — Testing sweep

## Goal

Prove the product works under normal, duplicate, hostile, and failure-prone conditions.

## Acceptance criteria

| Item | Owner | Status | Priority | Source | Implementation reference | Test evidence | Rollback notes | Known risks |
|---|---|---|---|---|---|---|---|---|
| Lifecycle smoke tests | TBD | DONE | P0 | Audit finding | Test suite | Test output required | None | Must stay in CI |
| AuthVersion enforcement test | TBD | DONE | P0 | Audit finding | `tests/auth/authVersionEnforcement.test.ts` | Test output required | None | Must stay in CI |
| Booking concurrency integration test | TBD | DONE | P0 | Audit finding | `tests/integration/bookingConcurrency.test.ts` | Test output required | None | App-layer proof only |
| Full 12-step E2E | TBD | TODO | P0 | Launch readiness plan | Playwright spec | Required before public launch | None | Core flow could regress |
| Broad retry suite | TBD | TODO | P0 | Launch readiness plan | Integration tests | Required before public launch | None | Duplicate side effects |
| k6 booking finalize load test | TBD | TODO | P0 | Launch readiness plan | Load test | Load evidence required | None | Launch traffic unknown |
| k6 availability load test | TBD | TODO | P1 | Launch readiness plan | Load test | Load evidence required | None | Search/booking UX may degrade |
| k6 media load test | TBD | TODO | P1 | Launch readiness plan | Load test | Load evidence required | None | Upload flow may fail under load |
| Stripe webhook replay storm test | TBD | TODO | P0 | Launch readiness plan | Load/integration test | Test evidence required | None | Duplicate payment effects |
| Chaos test: Redis outage | TBD | TODO | P1 | Launch readiness plan | Chaos test | Test evidence required | None | Rate/cache behavior unknown |
| Chaos test: provider outage | TBD | TODO | P1 | Launch readiness plan | Chaos test | Test evidence required | None | Notification/payment behavior unknown |

---

# Phase 11 — Database and performance

## Goal

Make database behavior safe and performant under launch load.

## Acceptance criteria

| Item | Owner | Status | Priority | Source | Implementation reference | Test evidence | Rollback notes | Known risks |
|---|---|---|---|---|---|---|---|---|
| App-layer overlap behavior tested | TBD | DONE | P0 | Audit finding | Booking concurrency tests | Test output required | None | DB-level constraint still stronger |
| DB no-overlap exclusion constraint decision | TBD | TODO | P0 | Audit finding | Decision doc or migration | Migration proof if implemented | Migration rollback required | Overlap prevention depends on app logic |
| Hot query index review | TBD | TODO | P1 | Launch readiness plan | EXPLAIN notes | Evidence required | Migration rollback if indexes added | Hidden slow queries |
| Notification query index review | TBD | TODO | P1 | Audit finding | EXPLAIN notes | Evidence required | Migration rollback if indexes added | Inbox hot path may degrade |
| Schema cleanup plan | TBD | TODO | P2 | Launch readiness plan | Schema cleanup doc | Documentation review | Migration rollback if changed | Deprecated fields linger |

---

# Phase 12 — Compliance, privacy, and PII

## Goal

Make sensitive data handling explicit, auditable, and enterprise-handoff ready.

## Acceptance criteria

| Item | Owner | Status | Priority | Source | Implementation reference | Test evidence | Rollback notes | Known risks |
|---|---|---|---|---|---|---|---|---|
| Data classification doc | TBD | TODO | P0 | Launch readiness plan | `docs/security/data-classification.md` | Documentation review | Revert doc | Sensitive data ownership unclear |
| PII encryption strategy | TBD | TODO | P0 | Audit finding | Security design doc | Review required | Migration rollback if implemented | Plaintext PII remains |
| Retention policy | TBD | TODO | P0 | Launch readiness plan | Privacy/security doc | Documentation review | Revert doc | Data retained too long |
| User export/delete plan | TBD | TODO | P1 | Launch readiness plan | Privacy runbook | Documentation review | Revert doc | Support cannot satisfy requests |
| Media deletion policy | TBD | TODO | P1 | Launch readiness plan | Privacy/media doc | Documentation review | Revert doc | Sensitive photos may persist |
| Secret rotation runbook | TBD | TODO | P1 | Enterprise handoff | Runbook | Documentation review | Revert doc | Incident response slower |

---

# Phase 13 — Feature flags and rollout

## Goal

Make launch gradual, reversible, and measurable.

## Acceptance criteria

| Item | Owner | Status | Priority | Source | Implementation reference | Test evidence | Rollback notes | Known risks |
|---|---|---|---|---|---|---|---|---|
| Runtime flags documented | TBD | TODO | P1 | Launch readiness plan | Runtime flag doc | Documentation review | Revert doc | Unknown launch controls |
| Percentage rollout decision | TBD | TODO | P1 | Audit finding | Feature flag design doc | Documentation review | Runtime rollback if implemented | Boolean flags limit safe rollout |
| Segment rollout decision | TBD | TODO | P1 | Audit finding | Feature flag design doc | Documentation review | Runtime rollback if implemented | Cannot target beta cohorts cleanly |
| Dogfood checklist | TBD | TODO | P0 | Launch readiness plan | Dogfood doc | Documentation review | Revert doc | Private beta readiness unclear |
| Staged rollout plan | TBD | TODO | P0 | Launch readiness plan | Rollout doc | Documentation review | Revert doc | Public launch may be all-or-nothing |

---

# Phase 14 — Final launch checklist

## Goal

Create the final release gate before public launch.

## Acceptance criteria

| Item | Owner | Status | Priority | Source | Implementation reference | Test evidence | Rollback notes | Known risks |
|---|---|---|---|---|---|---|---|---|
| Private beta readiness checklist | TBD | TODO | P0 | Launch readiness plan | Launch checklist | Evidence required | Rollback plan required | Beta may expose known holes |
| Public launch readiness checklist | TBD | TODO | P0 | Launch readiness plan | Launch checklist | Evidence required | Rollback plan required | Public launch unsafe without all P0s |
| Enterprise handoff checklist | TBD | TODO | P0 | Enterprise handoff | Handoff doc | Documentation review | Revert doc | Operators lack context |
| Final risk register | TBD | TODO | P0 | Launch readiness plan | Risk register | Review required | Revert doc | Known risks may be forgotten |
| Final go/no-go review | TBD | TODO | P0 | Launch readiness plan | Meeting notes / issue | Review required | Rollback plan required | Launch decision not evidence-based |