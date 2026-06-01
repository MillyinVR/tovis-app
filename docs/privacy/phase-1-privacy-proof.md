# Phase 1 Privacy / PII Contract Proof
## Status
Phase 1 removes the hard public-launch privacy blocker by establishing canonical contact normalization, audit redaction, AEAD address encryption, HMAC contact lookup v2, protected user export/delete routes, and user delete/anonymization foundations.
Phase 1 privacy is launch-ready for the current pre-launch scope.
The core code paths, local proof commands, staging backfill scripts, protected export/delete routes, privacy request runbook, and verification gates now pass.
Remaining items are accepted pre-launch/follow-up work tracked in `docs/privacy/phase-1-remaining-work.md`, including:
- Follow-up migration to drop legacy SHA-256 lookup columns/indexes after short pre-launch QA.
- Booking-level anonymization implementation beyond the conservative Phase 1 boundary.
- Message deletion implementation after conversation ownership/retention policy is converted into code.
- Continued burn-down of the accepted plaintext-read baseline.
## Verification date
2026-05-31
## Latest local proof
Commands:
```bash
pnpm verify:privacy-phase1
pnpm typecheck

Result:

check-canonical-normalization: passed
check-pii-plaintext-reads: passed (471 known baseline entries)
test:privacy-phase1: 8 files / 131 tests passed
test:privacy-export-delete: 4 files / 29 tests passed
typecheck: passed

Notes:

* verify:privacy-phase1 runs both Phase 1 privacy tests and export/delete privacy tests through pnpm test:privacy.
* The 471 known plaintext-read baseline entries are formally accepted for Phase 1 and remain tracked burn-down debt.
* These commands prove local privacy guards, focused tests, protected route tests, and TypeScript compilation.

Completed scope

1.1 Canonical contact normalizer

Implemented canonical contact normalization in:

* lib/security/contactNormalization.ts
* tools/check-canonical-normalization.mjs

Verification:

node tools/check-canonical-normalization.mjs

Current result:

check-canonical-normalization: passed

Status: complete.

1.2 Audit payload redaction

Implemented central audit redaction in:

* lib/security/auditRedaction.ts
* lib/admin/auditLog.ts
* lib/booking/closeoutAudit.ts
* lib/booking/overrideAudit.ts

The redaction boundary prevents raw PII, tokens, signed URLs, private media paths, payment identifiers, address payloads, notes, and other sensitive free-text fields from being persisted into long-lived audit JSON.

Status: complete. Admin audit writes are centralized through lib/admin/auditLog.ts, and audit payload redaction is covered by focused tests.

1.3 AEAD address encryption

Implemented AEAD address encryption in:

* lib/security/crypto/aead.ts
* lib/security/addressEncryption.ts
* prisma/scripts/backfillAddressEncryption.ts

Address encryption supports:

* AES-256-GCM envelope encryption.
* Versioned AEAD keys from PII_AEAD_KEYS_JSON.
* Address privacy write helpers.
* Dual-read compatibility for legacy plaintext expand-phase envelopes and encrypted AEAD envelopes.
* Backfill support for booking snapshots, booking holds, client addresses, and professional locations.

Status: complete for Phase 1 launch readiness. Staging backfill command executed successfully with 0 failures. Staging had no address/snapshot rows to migrate at the time of execution.

Address encryption staging backfill proof

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

* Address encryption staging backfill command executed successfully.
* There were no staging address/snapshot rows to migrate.
* Staging AEAD key/env wiring is valid.

1.4 HMAC contact lookup v2

Implemented HMAC contact lookup v2 in:

* lib/security/crypto/hashLookup.ts
* lib/security/contactLookup.ts
* prisma/migrations/20260527040700_add_contact_lookup_hmac_v2/migration.sql
* prisma/scripts/backfillContactHashV2.ts

The HMAC v2 path supports:

* Versioned HMAC lookup keys from PII_LOOKUP_HMAC_KEYS_JSON.
* emailHashV2 / phoneHashV2 lookup values.
* emailHashKeyVersion / phoneHashKeyVersion tracking.
* Dual-write for new/updated contact records.
* V2-only lookup for current auth/contact read paths.
* Backfill script for existing User and ClientProfile rows.

Status: complete for Phase 1 launch readiness. Staging backfill command executed successfully with 0 failures. Staging had no User or ClientProfile rows to migrate at the time of execution. Plaintext lookup fallback and legacy SHA-256 reader fallback have been removed from current auth/contact read paths.

Local script smoke test

Date: 2026-05-29
Environment: local via .env.local

Commands:

pnpm exec dotenv -e .env.local -- pnpm backfill:contact-hash-v2
pnpm exec dotenv -e .env.local -- pnpm backfill:contact-hash-v2 -- --write

Result:

* Dry run completed successfully.
* Write run completed successfully.
* User: scanned 0, eligible 0, updated 0, skipped 0, failed 0.
* ClientProfile: scanned 0, eligible 0, updated 0, skipped 0, failed 0.

Interpretation:

* Script/env wiring is valid locally.
* DATABASE_URL and PII_LOOKUP_HMAC_KEYS_JSON were loaded from .env.local.
* Local database had no rows to backfill because local data had been reset.
* This is local smoke proof, not staging proof.

HMAC contact hash v2 staging backfill proof

Date: 2026-05-29
Environment: staging via .env.staging.local

Preflight:

pnpm exec dotenv -e .env.staging.local -- node -e "for (const k of ['DATABASE_URL','PII_LOOKUP_HMAC_KEYS_JSON']) console.log(k, process.env[k] ? 'set' : 'missing')"

Result:

* DATABASE_URL: set.
* PII_LOOKUP_HMAC_KEYS_JSON: set.

Commands:

pnpm exec dotenv -e .env.staging.local -- pnpm backfill:contact-hash-v2
pnpm exec dotenv -e .env.staging.local -- pnpm backfill:contact-hash-v2 -- --write

Result:

* Dry run completed with 0 failures.
* Write run completed with 0 failures.
* User: scanned 0, eligible 0, updated 0, skipped 0, failed 0.
* ClientProfile: scanned 0, eligible 0, updated 0, skipped 0, failed 0.

Interpretation:

* HMAC v2 staging backfill command executed successfully.
* There were no staging User or ClientProfile rows to migrate.
* Staging HMAC key/env wiring is valid.

Plaintext contact lookup fallback removal

Date: 2026-05-31

Plaintext contact lookup fallback was removed from:

* app/api/auth/login/route.ts
* app/api/auth/password-reset/request/route.ts
* lib/clients/upsertProClient.ts

Tests now verify that these lookup paths use:

* HMAC v2 lookup fields only.
* No legacy SHA-256 reader fallback.
* No raw plaintext email / phone lookup fallback.

Verification:

pnpm test
pnpm verify:privacy-phase1
pnpm typecheck

Result:

* Full test suite passed: 300 files / 3266 tests.
* verify:privacy-phase1 passed.
* pnpm typecheck passed.

Legacy SHA-256 cleanup decision

Because the app has no real users yet, no extended production burn-in is required.

Decision:

* Verify seed/demo/login/password-reset/pro-client flows using HMAC v2.
* Add a follow-up migration to drop legacy SHA-256 lookup columns/indexes after short pre-launch QA.
* Keep legacy SHA-256 columns only as temporary schema cleanup debt until the drop migration lands.

1.5 User export/delete foundation

Implemented export/delete foundations and protected internal routes in:

* lib/privacy/exportUserData.ts
* lib/privacy/deleteUserData.ts
* app/api/internal/privacy/export/[userId]/route.ts
* app/api/internal/privacy/delete/[userId]/route.ts
* docs/runbooks/privacy-request.md
* lib/privacy/exportUserData.test.ts
* lib/privacy/deleteUserData.test.ts
* app/api/internal/privacy/export/[userId]/route.test.ts
* app/api/internal/privacy/delete/[userId]/route.test.ts

Current delete/anonymization behavior includes:

* Dry-run planning.
* Supported DB-row deletion for client addresses, professional locations, booking holds, client action tokens, and media asset rows.
* User/profile anonymization instead of hard deletion.
* Clearing legacy SHA-256 lookup hashes.
* Clearing HMAC v2 lookup hashes and key versions.
* Preserving a bcrypt-shaped deleted-user password sentinel.

Route behavior:

* Export route requires Role.ADMIN plus AdminPermissionRole.SUPER_ADMIN.
* Delete route requires Role.ADMIN plus AdminPermissionRole.SUPER_ADMIN.
* Delete route defaults to DRY_RUN.
* Live anonymization requires confirmUserId to match the target userId.
* Live self-anonymization by the acting admin is blocked.
* Export/delete responses use Cache-Control: no-store.
* Export/delete actions write admin audit logs.

Privacy delete transaction boundary

Live ANONYMIZE requests now run inside a Prisma transaction when called with a Prisma client that supports $transaction.

Covered behavior:

* DRY_RUN does not open a transaction.
* Live ANONYMIZE opens one transaction.
* Existing transaction clients do not recursively open another transaction.
* Supported deletion/anonymization writes run through the transaction client.

Verification:

pnpm test:privacy-export-delete
pnpm verify:privacy-phase1
pnpm typecheck

Result:

* test:privacy-export-delete: passed, 4 files / 29 tests.
* verify:privacy-phase1: passed.
* typecheck: passed.

Status: complete for Phase 1 launch readiness. Full product/legal retention implementation beyond the conservative boundary remains follow-up work.

1.6 Retention policy

Documented Phase 1 retention policy in:

* docs/privacy/retention-policy.md

The policy covers:

* User account anonymization.
* Client profile anonymization.
* Professional profile retention constraints.
* Client address deletion.
* Professional location retention constraints.
* Booking retention/anonymization policy.
* Message/conversation retention policy.
* Aftercare summaries.
* Notification deliveries.
* Attribution events.
* Admin action logs.
* Media/storage objects.
* Export/delete behavior.

Status: policy complete. Booking-level anonymization, message deletion implementation, storage byte deletion, and remaining graph traversal are tracked as deferred implementation areas.

1.7 PII plaintext-read baseline decision

The plaintext-read guard is implemented in:

* tools/check-pii-plaintext-reads.mjs

The known baseline is stored in:

* tools/baselines/pii-plaintext-reads.txt

Current result:

pnpm check:pii-plaintext-reads
check-pii-plaintext-reads: passed (471 known baseline entries)

Decision: formally accepted for Phase 1 as tracked expand-phase debt.

Rationale:

* The guard blocks new plaintext-read entries outside approved security/privacy boundaries.
* Existing entries are tracked explicitly in the baseline.
* Plaintext contact lookup fallback has already been removed from login, password reset, and pro-client matching.
* Remaining baseline entries are mostly UI rendering, operational workflows, notification/calendar/payment flows, booking/client/pro display, and deferred export/delete traversal areas.
* These entries are accepted for Phase 1 only and should be burned down over time by moving reads behind DTOs, privacy helpers, redaction helpers, or purpose-specific access boundaries.

Policy:

* Do not add new baseline entries casually.
* Any new baseline entry must include a narrow reason or be fixed before merge.
* Prefer reducing the baseline when touching related files.
* Treat baseline growth as privacy debt requiring review.

Current proof commands

Use this command for the focused Phase 1 privacy proof:

pnpm verify:privacy-phase1

Use this command for TypeScript proof:

pnpm typecheck

Use this command for the full test suite:

pnpm test

Current local proof from 2026-05-31:

check-canonical-normalization: passed
check-pii-plaintext-reads: passed (471 known baseline entries)
test:privacy-phase1: 8 files / 131 tests passed
test:privacy-export-delete: 4 files / 29 tests passed
typecheck: passed

Still not proven by this file

The following items are intentionally not marked complete here:

* Follow-up migration to drop legacy SHA-256 lookup columns/indexes after pre-launch QA.
* Booking retention/anonymization implementation beyond the Phase 1 conservative boundary.
* Message retention/deletion implementation.
* Continued burn-down of the 471 accepted plaintext-read baseline entries.
* Deferred export/delete traversal for attribution events, admin audit records, storage object bytes, and tenant-level workflows.