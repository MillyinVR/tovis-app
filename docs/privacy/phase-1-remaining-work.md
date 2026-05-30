# Phase 1 Remaining Work

## Must finish before Phase 1 is complete

- [x] Run address encryption backfill in staging.
- [x] Record address encryption backfill result.
- [x] Run HMAC contact hash v2 backfill in staging.
- [x] Record HMAC v2 backfill result.
- [x] Confirm app readers are v2-first with legacy/plaintext burn-in fallback.
- [ ] Define burn-in window for legacy SHA-256 contact hashes.
- [ ] Remove plaintext contact lookup fallback after staging/prod verification.
- [ ] Add follow-up migration to drop legacy SHA-256 lookup columns/indexes after burn-in.
- [ ] Verify admin audit payload redaction.
- [ ] Decide booking retention/anonymization policy.
- [ ] Decide message retention/deletion policy.
- [ ] Burn down or formally accept current PII plaintext-read baseline.
- [x] Re-run final Phase 1 proof commands from clean tree.

## Latest local proof

Date: 2026-05-29  
Command: `pnpm verify:privacy-phase1`

Result:

- `check-canonical-normalization`: passed.
- `check-pii-plaintext-reads`: passed with 471 known baseline entries.
- `test:privacy-phase1`: passed, 8 files / 129 tests.
- `test:privacy-export-delete`: passed, 2 files / 12 tests.
- Total focused privacy tests: 10 files / 141 tests.
- `pnpm typecheck`: passed.

Notes:

- `verify:privacy-phase1` now runs both Phase 1 privacy tests and export/delete privacy tests.
- `deleteUserData` now clears legacy SHA-256 and HMAC v2 lookup hashes during anonymization.
- The 471 known plaintext-read baseline entries are still open debt until burned down or formally accepted.
- App contact lookup readers are v2-first, but still keep legacy SHA-256 and plaintext fallback during burn-in.

## HMAC contact hash v2 staging backfill

Date: 2026-05-29  
Environment: staging via `.env.staging.local`

Commands:

```bash
pnpm exec dotenv -e .env.staging.local -- pnpm backfill:contact-hash-v2
pnpm exec dotenv -e .env.staging.local -- pnpm backfill:contact-hash-v2 -- --write