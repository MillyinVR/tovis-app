# Phase 1 Remaining Work

## Must finish before Phase 1 is complete

- [x] Run address encryption backfill in staging.
- [x] Record address encryption backfill result.
- [x] Run HMAC contact hash v2 backfill in staging.
- [x] Record HMAC v2 backfill result.
- [x] Confirm app readers are v2-first with legacy SHA-256 fallback.
- [x] Remove plaintext contact lookup fallback after staging/pre-launch verification.
- [x] Define burn-in window for legacy SHA-256 contact hashes.
- [ ] Add follow-up migration to drop legacy SHA-256 lookup columns/indexes after pre-launch QA.
- [x] Verify admin audit payload redaction.
- [x] Decide booking retention/anonymization policy.
- [x] Decide message retention/deletion policy.
- [ ] Burn down or formally accept current PII plaintext-read baseline.
- [x] Re-run final Phase 1 proof commands from clean tree.

## Latest local proof

Date: 2026-05-31  
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

- verify:privacy-phase1 runs both Phase 1 privacy tests and export/delete privacy tests.
- deleteUserData clears legacy SHA-256 and HMAC v2 lookup hashes during anonymization.
- Plaintext contact lookup fallback has been removed from login, password reset, and pro-client matching.
- App contact lookup readers are now v2-first with legacy SHA-256 fallback only.
- Because there are no real users yet, no extended production burn-in is required. Legacy SHA-256 fallback will remain through short pre-launch QA and should be removed before public launch after seed/demo/auth flows are verified with HMAC v2.
- The 471 known plaintext-read baseline entries remain open debt until burned down or formally accepted.
- Booking and message retention decisions are documented in `docs/privacy/retention-policy.md`.
- Booking-level anonymization and message deletion implementation remain deferred follow-up work.

## HMAC contact hash v2 staging backfill

Date: 2026-05-29  
Environment: staging via .env.staging.local

Commands:

bash pnpm exec dotenv -e .env.staging.local -- pnpm backfill:contact-hash-v2 pnpm exec dotenv -e .env.staging.local -- pnpm backfill:contact-hash-v2 -- --write 

Result:

- Dry run loaded DATABASE_URL and PII_LOOKUP_HMAC_KEYS_JSON.
- Dry run completed with 0 failures.
- Write run completed with 0 failures.
- User: scanned 0, eligible 0, updated 0, skipped 0, failed 0.
- ClientProfile: scanned 0, eligible 0, updated 0, skipped 0, failed 0.

Interpretation:

- The staging backfill script executed successfully.
- No staging User or ClientProfile rows existed to migrate at the time of execution.
- The staging HMAC v2 key/env wiring is valid.

## Address encryption staging backfill

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

- The staging address encryption backfill script executed successfully.
- No staging address/snapshot rows existed to migrate at the time of execution.
- The staging AEAD key/env wiring is valid.

## Plaintext contact lookup fallback removal

Date: 2026-05-31

Plaintext contact lookup fallback was removed from:

- app/api/auth/login/route.ts
- app/api/auth/password-reset/request/route.ts
- lib/clients/upsertProClient.ts

Tests now verify that these lookup paths use:

- HMAC v2 lookup fields first.
- Legacy SHA-256 lookup fields second.
- No raw plaintext email / phone lookup fallback.

Verification:

bash pnpm test pnpm verify:privacy-phase1 pnpm typecheck 

Result:

- Full test suite passed: 300 files / 3266 tests.
- verify:privacy-phase1 passed.
- pnpm typecheck passed.

## Legacy SHA-256 burn-in decision

Because the app has no real users yet, no extended production burn-in is required.

Decision:

- Keep legacy SHA-256 lookup fallback through short pre-launch QA.
- Verify seed/demo/login/password-reset/pro-client flows using HMAC v2.
- Remove legacy SHA-256 fallback before public launch.
- Add a follow-up migration to drop legacy SHA-256 lookup columns/indexes after the fallback is removed.

## Current known deferred areas

- Booking-level anonymization is deferred until retention policy is finalized.
- Message deletion is deferred until conversation ownership and retention are finalized.
- Notification deliveries need real relation traversal.
- Aftercare summaries need real Booking/Aftercare traversal.
- Attribution events need real attribution identity traversal.
- AdminActionLog export/delete needs real admin audit schema mapping.
- Storage object byte deletion needs a storage write boundary.
- Tenant-level export/delete belongs to WS-1 tenant work.