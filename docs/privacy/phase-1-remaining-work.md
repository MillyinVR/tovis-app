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
- [x] Add migration to drop legacy SHA-256 lookup columns/indexes.
- [x] Apply legacy SHA-256 lookup column drop migration locally.
- [x] Verify Prisma migration status after legacy SHA-256 cleanup.
- [x] Harden address encryption backfill metadata/key-version writes.
- [x] Harden user export projection so internal secrets/security fields are not exported.
- [x] Add protected internal privacy export route.
- [x] Add protected internal privacy delete/anonymize route.
- [x] Ensure live privacy anonymization and admin audit write happen in the same transaction.
- [x] Reject malformed `dryRun` values on the privacy delete route.
- [x] Include privacy export/delete routes in Phase 1 verification.
- [x] Include AEAD/address encryption tests in Phase 1 verification.
- [x] Include audit redaction/admin audit tests in Phase 1 verification.
- [x] Include login and password-reset route tests in Phase 1 verification.
- [x] Add privacy request runbook.
- [x] Verify admin audit payload redaction.
- [x] Decide booking retention/anonymization policy.
- [x] Decide message retention/deletion policy.
- [x] Formally accept current PII plaintext-read baseline as tracked expand-phase debt.
- [x] Re-run final Phase 1 proof commands from clean tree.
## Public-launch required follow-up
These are not blocking the Phase 1 code contract, but should be completed before real public user data exists.
- [x] Remove legacy SHA-256 lookup fallback/repair paths.
- [x] Add migration to drop legacy SHA-256 lookup columns/indexes.
- [x] Re-run final proof commands after the legacy SHA-256 cleanup migration.
- [x] Expand `verify:privacy-phase1` to include AEAD, address encryption, audit redaction/admin audit, login, and password-reset proof tests.
- [ ] Re-run HMAC v2 seed/demo/login/password-reset/pro-client flows against the target launch environment.
- [ ] Re-run address encryption dry run/write run against the target launch environment.
- [ ] Re-run final proof commands against the target launch environment before public launch.
## Latest local proof
Date: 2026-06-01
Commands:
```bash
pnpm verify:privacy-phase1
pnpm typecheck

Result:

check-canonical-normalization: passed
check-pii-plaintext-reads: passed (471 known baseline entries)
test:privacy-phase1: passed, 14 files / 195 tests
test:privacy-export-delete: passed, 6 files / 45 tests
pnpm typecheck: passed

Notes:

* verify:privacy-phase1 runs both Phase 1 privacy tests and export/delete privacy tests.
* test:privacy-phase1 now includes:
    * lib/security/contactNormalization.test.ts
    * lib/security/crypto/hashLookup.test.ts
    * lib/security/contactLookup.test.ts
    * lib/security/crypto/aead.test.ts
    * lib/security/addressEncryption.test.ts
    * lib/security/auditRedaction.test.ts
    * lib/admin/auditLog.test.ts
    * lib/clientActions/idempotency.test.ts
    * lib/clients/upsertProClient.test.ts
    * lib/observability/authEvents.test.ts
    * app/api/auth/register/route.test.ts
    * app/api/auth/login/route.test.ts
    * app/api/auth/password-reset/request/route.test.ts
    * app/api/auth/phone/correct/route.test.ts
* test:privacy-export-delete now includes:
    * lib/privacy/exportSafety.test.ts
    * lib/privacy/exportUserData.test.ts
    * lib/privacy/deleteUserData.test.ts
    * lib/privacy/deleteUserDataSummary.test.ts
    * app/api/internal/privacy/export/[userId]/route.test.ts
    * app/api/internal/privacy/delete/[userId]/route.test.ts
* deleteUserData clears HMAC v2 lookup hashes and key versions during anonymization.
* Legacy SHA-256 contact lookup columns were removed by prisma/migrations/20260601000000_drop_legacy_contact_lookup_hashes/migration.sql.
* The privacy delete route runs live anonymization and the matching admin audit write inside the same outer Prisma transaction.
* The privacy delete route rejects malformed dryRun values instead of allowing ambiguous input to trigger live anonymization.
* exportUserData uses explicit projections and negative tests to prevent internal secret/security field egress.
* Attribution events and admin action logs are omitted from the default user export pending a separate disclosure decision.
* Protected internal export/delete routes are present and covered by tests.
* Plaintext contact lookup fallback has been removed from login, password reset, and pro-client matching.
* Contact lookup readers are HMAC v2-only.
* Because there are no real users yet, no extended production burn-in is required for the legacy SHA-256 contact lookup cleanup.
* Booking and message retention decisions are documented in docs/privacy/retention-policy.md.
* Privacy request operations are documented in docs/runbooks/privacy-request.md.

HMAC contact hash v2 staging backfill

Date: 2026-05-29
Environment: staging via .env.staging.local

Commands:

pnpm exec dotenv -e .env.staging.local -- pnpm backfill:contact-hash-v2
pnpm exec dotenv -e .env.staging.local -- pnpm backfill:contact-hash-v2 -- --write

Result:

Dry run loaded DATABASE_URL and PII_LOOKUP_HMAC_KEYS_JSON.
Dry run completed with 0 failures.
Write run completed with 0 failures.
User: scanned 0, eligible 0, updated 0, skipped 0, failed 0.
ClientProfile: scanned 0, eligible 0, updated 0, skipped 0, failed 0.

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

DATABASE_URL: set
PII_AEAD_KEYS_JSON: set

Command:

pnpm exec dotenv -e .env.staging.local -- pnpm backfill:address-encryption -- --write

Result:

Write run completed with 0 failures.
BookingHold: scanned 0, eligible 0, updated 0, skipped 0, failed 0.
Booking: scanned 0, eligible 0, updated 0, skipped 0, failed 0.
ClientAddress: scanned 0, eligible 0, updated 0, skipped 0, failed 0.
ProfessionalLocation: scanned 0, eligible 0, updated 0, skipped 0, failed 0.

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

lib/security/addressEncryption.test.ts: passed, 9 tests.
pnpm typecheck: passed.
Staging dry run completed with 0 failures across all targets.

Plaintext contact lookup fallback removal

Date: 2026-05-31

Plaintext contact lookup fallback was removed from:

* app/api/auth/login/route.ts
* app/api/auth/password-reset/request/route.ts
* lib/clients/upsertProClient.ts

Current reader policy:

* HMAC v2 lookup only.
* No raw plaintext email/phone lookup fallback.
* No legacy SHA-256 lookup fallback.

Verification:

pnpm verify:privacy-phase1
pnpm typecheck

Result:

verify:privacy-phase1: passed.
pnpm typecheck: passed.

Legacy SHA-256 cleanup

Date: 2026-06-01

Because the app has no real users yet, no extended production burn-in was required.

Decision:

* Treat HMAC v2 as the canonical contact lookup path.
* Remove legacy SHA-256 lookup helpers and fallback/repair paths.
* Drop legacy SHA-256 lookup columns/indexes before public launch.
* If real user data exists before a future privacy contract cleanup lands, use a safer staged migration plan instead of an immediate drop.

Implemented migration:

prisma/migrations/20260601000000_drop_legacy_contact_lookup_hashes/migration.sql

Dropped columns:

* User.emailHash
* User.phoneHash
* ClientProfile.emailHash
* ClientProfile.phoneHash

Verification:

pnpm prisma migrate status
rg 'DROP COLUMN.*emailHash|DROP COLUMN.*phoneHash' prisma/migrations -n
rg '\bemailHash\b|\bphoneHash\b' prisma/schema.prisma prisma/migrations -n

Result:

Database schema is up to date.
The new drop migration contains the expected DROP COLUMN statements.
schema.prisma contains no legacy emailHash / phoneHash fields.

Privacy export/delete route closeout

Date: 2026-06-01

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
* Writes structured admin audit logs.
* Export route returns the sanitized exportUserData payload.
* Export audit logs include structured target context.
* Delete route defaults to DRY_RUN.
* Delete route rejects malformed dryRun values.
* Delete route requires confirmUserId for live ANONYMIZE.
* Delete route blocks live self-anonymization by the acting admin.
* Live anonymization and the corresponding audit write run in the same outer transaction.

Verification:

pnpm test:privacy-export-delete
pnpm verify:privacy-phase1
pnpm typecheck

Result:

test:privacy-export-delete: passed, 6 files / 45 tests.
verify:privacy-phase1: passed.
pnpm typecheck: passed.

Privacy delete transaction hardening

Date: 2026-06-01

Live privacy delete/anonymize requests now run supported anonymization work and the matching admin audit write in the same outer Prisma transaction.

Covered behavior:

* DRY_RUN does not open a transaction.
* Live ANONYMIZE opens one transaction.
* Supported deletion/anonymization writes run through the transaction client.
* The admin audit log write runs through the same transaction client.
* If the audit log write fails, the live anonymization is not committed.
* Tests cover route-level transaction behavior in app/api/internal/privacy/delete/[userId]/route.test.ts.

Verification:

pnpm test:privacy-export-delete
pnpm verify:privacy-phase1
pnpm typecheck

Result:

test:privacy-export-delete: passed, 6 files / 45 tests.
verify:privacy-phase1: passed.
pnpm typecheck: passed.

Current known deferred areas

These are accepted follow-up areas, not unresolved Phase 1 blockers.

* AEAD address raw-column drop after real-data burn-in.
* Booking-level anonymization implementation after retention/legal policy is finalized.
* Message deletion implementation after conversation ownership and retention rules are finalized.
* Notification delivery traversal expansion beyond the current safe export boundary, if needed.
* Aftercare summary traversal expansion beyond the current safe export boundary, if needed.
* Attribution event disclosure decision and optional safe projection.
* AdminActionLog user-export/delete disclosure decision and optional safe projection.
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

After replacing it, run:
```bash
pnpm verify:privacy-phase1
pnpm typecheck
git diff -- docs/privacy/phase-1-remaining-work.md