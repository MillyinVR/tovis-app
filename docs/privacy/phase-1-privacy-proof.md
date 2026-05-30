# Phase 1 Privacy / PII Contract Proof

## Status

Phase 1 removes the hard public-launch privacy blocker by establishing canonical contact normalization, audit redaction, AEAD address encryption, HMAC contact lookup v2, and user export/delete foundations.

Phase 1 is not fully closed yet. The core code paths and local proof commands now pass, but staging backfills, burn-in policy, legacy SHA-256 cleanup, retention decisions, and the plaintext-read baseline decision are still tracked in docs/privacy/phase-1-remaining-work.md.

## Verification date

2026-05-29

## Latest local proof

Command:

bash pnpm verify:privacy-phase1 pnpm typecheck 

Result:

- check-canonical-normalization: passed.
- check-pii-plaintext-reads: passed with 471 known baseline entries.
- test:privacy-phase1: passed, 8 files / 129 tests.
- test:privacy-export-delete: passed, 2 files / 12 tests.
- Focused privacy tests total: 10 files / 141 tests.
- pnpm typecheck: passed.

Notes:

- verify:privacy-phase1 now runs both Phase 1 privacy tests and export/delete privacy tests through pnpm test:privacy.
- The 471 known plaintext-read baseline entries remain open debt until burned down or formally accepted.
- These commands prove local guards/tests/typecheck. They do not prove staging backfills have run.

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

Status: code complete. Final deployed-behavior verification remains tracked in docs/privacy/phase-1-remaining-work.md.

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

Status: implementation exists. Staging backfill execution and recorded results remain open.

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

Status: implementation exists. HMAC v2 staging backfill, burn-in window, legacy SHA-256 fallback removal, and legacy column/index drop remain open.

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

Use this command for the focused Phase 1 privacy proof:

bash pnpm verify:privacy-phase1 

Use this command for TypeScript proof:

bash pnpm typecheck 

Current local proof from 2026-05-29:

text check-canonical-normalization: passed check-pii-plaintext-reads: passed (471 known baseline entries) test:privacy-phase1: 8 files / 129 tests passed test:privacy-export-delete: 2 files / 12 tests passed typecheck: passed 

## Still not proven by this file

The following items are intentionally not marked complete here:

- Address encryption backfill in staging.
- HMAC contact hash v2 backfill in staging.
- Burn-in window for legacy SHA-256 contact hashes.
- Follow-up migration to drop legacy SHA-256 lookup columns/indexes after burn-in.
- Booking retention/anonymization policy.
- Message retention/deletion policy.
- Formal decision on the 471 known plaintext-read baseline entries.
- Deferred export/delete traversal for notification deliveries, aftercare summaries, attribution events, admin audit records, storage object bytes, and tenant-level workflows.