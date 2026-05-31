# Phase 1 Privacy / PII Contract Proof

## Status

Phase 1 removes the hard public-launch privacy blocker by establishing canonical contact normalization, audit redaction, AEAD address encryption, HMAC contact lookup v2, and user export/delete foundations.

Phase 1 is not fully closed yet. The core code paths, local proof commands, staging backfill scripts, and plaintext lookup fallback removal now pass. Legacy SHA-256 cleanup, retention decisions, admin audit deployed-behavior verification, and the plaintext-read baseline decision are still tracked in docs/privacy/phase-1-remaining-work.md.

## Verification date

2026-05-31

## Latest local proof

Commands:

bash pnpm test pnpm verify:privacy-phase1 pnpm typecheck 

Result:

- Full test suite: passed, 300 files / 3266 tests.
- check-canonical-normalization: passed.
- check-pii-plaintext-reads: passed with 471 known baseline entries.
- test:privacy-phase1: passed, 8 files / 131 tests.
- test:privacy-export-delete: passed, 2 files / 12 tests.
- pnpm typecheck: passed.

Notes:

- verify:privacy-phase1 runs both Phase 1 privacy tests and export/delete privacy tests through pnpm test:privacy.
- The 471 known plaintext-read baseline entries remain open debt until burned down or formally accepted.
- These commands prove local guards/tests/typecheck.

## Completed scope

### 1.1 Canonical contact normalizer

Implemented canonical contact normalization in:

- lib/security/contactNormalization.ts
- tools/check-canonical-normalization.mjs

Verification:

bash node tools/check-canonical-normalization.mjs 

Current result:

text check-canonical-normalization: passed 

Status: complete.

### 1.2 Audit payload redaction

Implemented central audit redaction in:

- lib/security/auditRedaction.ts
- lib/admin/auditLog.ts
- lib/booking/closeoutAudit.ts
- lib/booking/overrideAudit.ts

The redaction boundary prevents raw PII, tokens, signed URLs, private media paths, payment identifiers, address payloads, notes, and other sensitive free-text fields from being persisted into long-lived audit JSON.

Status: code complete. Dedicated writeAdminAuditLog test coverage still needs to be added or verified before checking off admin audit payload redaction in docs/privacy/phase-1-remaining-work.md.

### 1.3 AEAD address encryption

Implemented AEAD address encryption in:

- lib/security/crypto/aead.ts
- lib/security/addressEncryption.ts
- prisma/scripts/backfillAddressEncryption.ts

Address encryption supports:

- AES-256-GCM envelope encryption.
- Versioned AEAD keys from PII_AEAD_KEYS_JSON.
- Address privacy write helpers.
- Dual-read compatibility for legacy plaintext expand-phase envelopes and encrypted AEAD envelopes.
- Backfill support for booking snapshots, booking holds, client addresses, and professional locations.

Status: implementation exists. Staging backfill command executed successfully with 0 failures. Staging had no address/snapshot rows to migrate at the time of execution.

#### Address encryption staging backfill proof

Date: 2026-05-29  
Environment: staging via .env.staging.local

Preflight:

bash pnpm exec dotenv -e .env.staging.local -- node -e "for (const k of ['DATABASE_URL','PII_AEAD_KEYS_JSON']) console.log(k, process.env[k] ? 'set' : 'missing')" 

Result:

- DATABASE_URL: set.
- PII_AEAD_KEYS_JSON: set.

Command:

bash pnpm exec dotenv -e .env.staging.local -- pnpm backfill:address-encryption -- --write 

Result:

- Write run completed with 0 failures.
- BookingHold: scanned 0, eligible 0, updated 0, skipped 0, failed 0.
- Booking: scanned 0, eligible 0, updated 0, skipped 0, failed 0.
- ClientAddress: scanned 0, eligible 0, updated 0, skipped 0, failed 0.
- ProfessionalLocation: scanned 0, eligible 0, updated 0, skipped 0, failed 0.

Interpretation:

- Address encryption staging backfill command executed successfully.
- There were no staging address/snapshot rows to migrate.
- Staging AEAD key/env wiring is valid.

### 1.4 HMAC contact lookup v2

Implemented HMAC contact lookup v2 in:

- lib/security/crypto/hashLookup.ts
- lib/security/contactLookup.ts
- prisma/migrations/20260527040700_add_contact_lookup_hmac_v2/migration.sql
- prisma/scripts/backfillContactHashV2.ts

The HMAC v2 path supports:

- Versioned HMAC lookup keys from PII_LOOKUP_HMAC_KEYS_JSON.
- emailHashV2 / phoneHashV2 lookup values.
- emailHashKeyVersion / phoneHashKeyVersion tracking.
- Dual-write for new/updated contact records.
- V2-first lookup for current auth/contact read paths.
- Backfill script for existing User and ClientProfile rows.

Status: implementation exists. Staging backfill command executed successfully with 0 failures. Staging had no User or ClientProfile rows to migrate at the time of execution. Plaintext lookup fallback has been removed. Legacy SHA-256 fallback remains temporarily for short pre-launch QA.

#### Local script smoke test

Date: 2026-05-29  
Environment: local via .env.local

Commands:

bash pnpm exec dotenv -e .env.local -- pnpm backfill:contact-hash-v2 pnpm exec dotenv -e .env.local -- pnpm backfill:contact-hash-v2 -- --write 

Result:

- Dry run completed successfully.
- Write run completed successfully.
- User: scanned 0, eligible 0, updated 0, skipped 0, failed 0.
- ClientProfile: scanned 0, eligible 0, updated 0, skipped 0, failed 0.

Interpretation:

- Script/env wiring is valid locally.
- DATABASE_URL and PII_LOOKUP_HMAC_KEYS_JSON were loaded from .env.local.
- Local database had no rows to backfill because local data had been reset.
- This is local smoke proof, not staging proof.

#### HMAC contact hash v2 staging backfill proof

Date: 2026-05-29  
Environment: staging via .env.staging.local

Preflight:

bash pnpm exec dotenv -e .env.staging.local -- node -e "for (const k of ['DATABASE_URL','PII_LOOKUP_HMAC_KEYS_JSON']) console.log(k, process.env[k] ? 'set' : 'missing')" 

Result:

- DATABASE_URL: set.
- PII_LOOKUP_HMAC_KEYS_JSON: set.

Commands:

bash pnpm exec dotenv -e .env.staging.local -- pnpm backfill:contact-hash-v2 pnpm exec dotenv -e .env.staging.local -- pnpm backfill:contact-hash-v2 -- --write 

Result:

- Dry run completed with 0 failures.
- Write run completed with 0 failures.
- User: scanned 0, eligible 0, updated 0, skipped 0, failed 0.
- ClientProfile: scanned 0, eligible 0, updated 0, skipped 0, failed 0.

Interpretation:

- HMAC v2 staging backfill command executed successfully.
- There were no staging User or ClientProfile rows to migrate.
- Staging HMAC key/env wiring is valid.

#### Plaintext contact lookup fallback removal

Date: 2026-05-31

Plaintext contact lookup fallback was removed from:

- app/api/auth/login/route.ts
- app/api/auth/password-reset/request/route.ts
- lib/clients/upsertProClient.ts

Tests were updated to prove lookup readers now use:

- HMAC v2 lookup fields first.
- Legacy SHA-256 lookup fields second.
- No raw plaintext email / phone lookup fallback.

Verification:

bash pnpm test pnpm verify:privacy-phase1 pnpm typecheck 

Result:

- Full test suite passed: 300 files / 3266 tests.
- verify:privacy-phase1 passed.
- pnpm typecheck passed.

#### Legacy SHA-256 burn-in decision

Because the app has no real users yet, no extended production burn-in is required.

Decision:

- Keep legacy SHA-256 lookup fallback through short pre-launch QA.
- Verify seed/demo/login/password-reset/pro-client flows using HMAC v2.
- Remove legacy SHA-256 fallback before public launch.
- Add a follow-up migration to drop legacy SHA-256 lookup columns/indexes after the fallback is removed.

### 1.5 User export/delete foundation

Implemented export/delete foundations in:

- lib/privacy/exportUserData.ts
- lib/privacy/deleteUserData.ts
- lib/privacy/exportUserData.test.ts
- lib/privacy/deleteUserData.test.ts

Current delete/anonymization behavior includes:

- Dry-run planning.
- Supported DB-row deletion for client addresses, professional locations, booking holds, client action tokens, and media asset rows.
- User/profile anonymization instead of hard deletion.
- Clearing legacy SHA-256 lookup hashes.
- Clearing HMAC v2 lookup hashes and key versions.
- Preserving a bcrypt-shaped deleted-user password sentinel.

Verification:

bash pnpm test:privacy-export-delete 

Current result:

text Test Files  2 passed (2) Tests       12 passed (12) 

Status: foundation complete. Full product/legal retention decisions and deferred graph traversal remain open.

## Current proof commands

Use this command for the full test suite:

bash pnpm test 

Use this command for the focused Phase 1 privacy proof:

bash pnpm verify:privacy-phase1 

Use this command for TypeScript proof:

bash pnpm typecheck 

Current local proof from 2026-05-31:

text Full test suite: 300 files / 3266 tests passed check-canonical-normalization: passed check-pii-plaintext-reads: passed (471 known baseline entries) test:privacy-phase1: 8 files / 131 tests passed test:privacy-export-delete: 2 files / 12 tests passed typecheck: passed 

## Still not proven by this file

The following items are intentionally not marked complete here:

- Follow-up migration to drop legacy SHA-256 lookup columns/indexes after pre-launch QA.
- Admin audit deployed-behavior verification.
- Booking retention/anonymization policy.
- Message retention/deletion policy.
- Formal decision on the 471 known plaintext-read baseline entries.
- Deferred export/delete traversal for notification deliveries, aftercare summaries, attribution events, admin audit records, storage object bytes, and tenant-level workflows.
### 1.6 Retention policy

Documented Phase 1 retention policy in:

- `docs/privacy/retention-policy.md`

The policy covers:

- User account anonymization.
- Client profile anonymization.
- Professional profile retention constraints.
- Client address deletion.
- Professional location retention constraints.
- Booking retention/anonymization policy.
- Message/conversation retention policy.
- Aftercare summaries.
- Notification deliveries.
- Attribution events.
- Admin action logs.
- Media/storage objects.
- Export/delete behavior.

Status: policy complete. Booking-level anonymization, message deletion implementation, storage byte deletion, and remaining graph traversal are tracked as deferred implementation areas.
### 1.7 PII plaintext-read baseline decision

The plaintext-read guard is implemented in:

- `tools/check-pii-plaintext-reads.mjs`

The known baseline is stored in:

- `tools/baselines/pii-plaintext-reads.txt`

Current result:

```bash
pnpm check:pii-plaintext-reads