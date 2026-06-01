# Phase 1 Remaining Work
## Status
Phase 1 privacy closeout is complete for the current pre-launch contract.
The remaining items in this file are accepted follow-up work, scheduled pre-launch QA, or Phase 2+ privacy hardening. They are not unresolved Phase 1 launch blockers unless explicitly marked as public-launch required.
## Completed Phase 1 closeout items
- [x] Run address encryption backfill in staging.
- [x] Record address encryption backfill result.
- [x] Run HMAC contact hash v2 backfill in staging.
- [x] Record HMAC v2 backfill result.
- [x] Remove plaintext contact lookup fallback from login, password reset, and pro-client matching.
- [x] Cut contact lookup readers to HMAC v2-only.
- [x] Define burn-in / no-real-users decision for legacy SHA-256 contact hashes.
- [x] Harden address encryption backfill metadata/key-version writes.
- [x] Harden user export projection so internal secrets/security fields are not exported.
- [x] Add protected internal privacy export route.
- [x] Add protected internal privacy delete/anonymize route.
- [x] Include privacy export/delete routes in Phase 1 verification.
- [x] Add privacy request runbook.
- [x] Verify admin audit payload redaction.
- [x] Decide booking retention/anonymization policy.
- [x] Decide message retention/deletion policy.
- [x] Formally accept current PII plaintext-read baseline as tracked expand-phase debt.
- [x] Re-run final Phase 1 proof commands from clean tree.
## Public-launch required follow-up
These are not blocking the Phase 1 code contract, but should be completed before real public user data exists.
- [ ] Remove legacy SHA-256 lookup fallback/repair paths if any remain.
- [ ] Add follow-up migration to drop legacy SHA-256 lookup columns/indexes after pre-launch QA.
- [ ] Re-run HMAC v2 seed/demo/login/password-reset/pro-client flows after legacy cleanup.
- [ ] Re-run address encryption dry run/write run against the target launch environment.
- [ ] Re-run final proof commands after the legacy SHA-256 cleanup migration.
## Latest local proof
Date: 2026-05-31
Commands:
```bash
pnpm verify:privacy-phase1
pnpm typecheck

Result:

* check-canonical-normalization: passed.
* check-pii-plaintext-reads: passed with 471 known baseline entries.
* test:privacy-phase1: passed, 8 files / 131 tests.
* test:privacy-export-delete: passed, 4 files / 26 tests.
* pnpm typecheck: passed.

Notes:

* verify:privacy-phase1 runs both Phase 1 privacy tests and export/delete privacy tests.
* test:privacy-export-delete now includes:
    * lib/privacy/exportUserData.test.ts
    * lib/privacy/deleteUserData.test.ts
    * app/api/internal/privacy/export/[userId]/route.test.ts
    * app/api/internal/privacy/delete/[userId]/route.test.ts
* deleteUserData clears legacy SHA-256 and HMAC v2 lookup hashes during anonymization.
* exportUserData now uses explicit projections and negative tests to prevent internal secret/security field egress.
* Protected internal export/delete routes are present and covered by tests.
* Plaintext contact lookup fallback has been removed from login, password reset, and pro-client matching.
* Contact lookup readers are now HMAC v2-only.
* Because there are no real users yet, no extended production burn-in is required.
* Booking and message retention decisions are documented in docs/privacy/retention-policy.md.
* Privacy request operations are documented in docs/runbooks/privacy-request.md.

HMAC contact hash v2 staging backfill

Date: 2026-05-29
Environment: staging via .env.staging.local

Commands:

pnpm exec dotenv -e .env.staging.local -- pnpm backfill:contact-hash-v2
pnpm exec dotenv -e .env.staging.local -- pnpm backfill:contact-hash-v2 -- --write

Result:

* Dry run loaded DATABASE_URL and PII_LOOKUP_HMAC_KEYS_JSON.
* Dry run completed with 0 failures.
* Write run completed with 0 failures.
* User: scanned 0, eligible 0, updated 0, skipped 0, failed 0.
* ClientProfile: scanned 0, eligible 0, updated 0, skipped 0, failed 0.

Interpretation:

* The staging backfill script executed successfully.
* No staging User or ClientProfile rows existed to migrate at the time of execution.
* The staging HMAC v2 key/env wiring is valid.

Address encryption staging backfill

Date: 2026-05-29
Environment: staging via .env.staging.local

Preflight:

pnpm exec dotenv -e .env.staging.local -- node -e "for (const k of ['DATABASE_URL','PII_AEAD_KEYS_JSON']) console.log(k, process.env[k] ? 'set' : 'missing')"

Result:

* DATABASE_URL: set.
* PII_AEAD_KEYS_JSON: set.

Command:

pnpm exec dotenv -e .env.staging.local -- pnpm backfill:address-encryption -- --write

Result:

* Write run completed with 0 failures.
* BookingHold: scanned 0, eligible 0, updated 0, skipped 0, failed 0.
* Booking: scanned 0, eligible 0, updated 0, skipped 0, failed 0.
* ClientAddress: scanned 0, eligible 0, updated 0, skipped 0, failed 0.
* ProfessionalLocation: scanned 0, eligible 0, updated 0, skipped 0, failed 0.

Interpretation:

* The staging address encryption backfill script executed successfully.
* No staging address/snapshot rows existed to migrate at the time of execution.
* The staging AEAD key/env wiring is valid.

Address encryption backfill hardening

Date: 2026-05-31

The address encryption backfill was hardened to preserve metadata needed for the Phase 1 AEAD contract.

Covered models:

* Booking
* BookingHold
* ClientAddress
* ProfessionalLocation

The backfill now repairs/writes:

* AEAD encrypted address envelopes.
* Address key-version fields.
* Postal-code prefix fields where applicable.
* Approximate coordinate fields.
* Encryption timestamp fields where applicable.

Verification:

pnpm vitest run --config vitest.config.mts lib/security/addressEncryption.test.ts
pnpm typecheck
pnpm exec dotenv -e .env.staging.local -- pnpm backfill:address-encryption -- --dry-run --target=all

Result:

* lib/security/addressEncryption.test.ts: passed, 9 tests.
* pnpm typecheck: passed.
* Staging dry run completed with 0 failures across all targets.

Plaintext contact lookup fallback removal

Date: 2026-05-31

Plaintext contact lookup fallback was removed from:

* app/api/auth/login/route.ts
* app/api/auth/password-reset/request/route.ts
* lib/clients/upsertProClient.ts

Current reader policy:

* HMAC v2 lookup only.
* No raw plaintext email/phone lookup fallback.
* Legacy SHA-256 columns remain temporarily only for scheduled cleanup/drop migration work.

Verification:

pnpm verify:privacy-phase1
pnpm typecheck

Result:

* verify:privacy-phase1: passed.
* pnpm typecheck: passed.

Legacy SHA-256 cleanup decision

Because the app has no real users yet, no extended production burn-in is required.

Decision:

* Treat HMAC v2 as the canonical contact lookup path.
* Keep legacy SHA-256 columns only until short pre-launch QA confirms seed/demo/auth/pro-client flows.
* Drop legacy SHA-256 lookup columns/indexes before public launch, unless real user data exists before that migration lands.
* If real user data exists before legacy cleanup lands, switch to a safer staged migration plan instead of an immediate drop.

Privacy export/delete route closeout

Date: 2026-05-31

Implemented protected internal routes:

* app/api/internal/privacy/export/[userId]/route.ts
* app/api/internal/privacy/delete/[userId]/route.ts

Tests:

* app/api/internal/privacy/export/[userId]/route.test.ts
* app/api/internal/privacy/delete/[userId]/route.test.ts

Route behavior:

* Requires authenticated ADMIN.
* Requires SUPER_ADMIN permission.
* Uses Cache-Control: no-store.
* Writes admin audit logs.
* Export route returns the sanitized exportUserData payload.
* Delete route defaults to DRY_RUN.
* Delete route requires confirmUserId for live ANONYMIZE.
* Delete route blocks live self-anonymization by the acting admin.

Verification:

pnpm test:privacy-export-delete
pnpm verify:privacy-phase1
pnpm typecheck

Result:

* test:privacy-export-delete: passed, 4 files / 26 tests.
* verify:privacy-phase1: passed.
* pnpm typecheck: passed.

Current known deferred areas

These are accepted follow-up areas, not unresolved Phase 1 blockers.

* Booking-level anonymization implementation after retention/legal policy is finalized.
* Message deletion implementation after conversation ownership and retention rules are finalized.
* Notification delivery traversal expansion.
* Aftercare summary traversal expansion.
* Attribution event disclosure decision and traversal.
* AdminActionLog user-export/delete disclosure decision and schema mapping.
* Storage object byte deletion through a dedicated storage write boundary.
* Tenant-level export/delete as part of WS-1 tenant work.
* PII plaintext-read baseline burn-down from the accepted 471-entry baseline.
* Sentry/logging PII channel review before real production data exists.

PII plaintext-read baseline decision

Date: 2026-05-31

Decision: formally accepted for Phase 1 as tracked expand-phase debt.

Current baseline:

* tools/baselines/pii-plaintext-reads.txt
* 471 known entries.
* Guard command: pnpm check:pii-plaintext-reads.

Rationale:

* The guard blocks new plaintext-read entries outside approved security/privacy boundaries.
* Existing entries are tracked explicitly in the baseline.
* Plaintext contact lookup fallback has been removed from login, password reset, and pro-client matching.
* Remaining baseline entries are mostly UI rendering, operational workflows, notification/calendar/payment flows, booking/client/pro display, and deferred traversal areas.
* These entries are accepted for Phase 1 only; they should be burned down over time by moving reads behind DTOs, privacy helpers, redaction helpers, or purpose-specific access boundaries.

Policy:

* Do not add new baseline entries casually.
* Any new baseline entry must include a narrow reason or be fixed before merge.
* Prefer reducing the baseline when touching related files.
* Treat baseline growth as privacy debt requiring review.