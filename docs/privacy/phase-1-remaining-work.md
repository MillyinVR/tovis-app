# Phase 1 Remaining Work

## Must finish before Phase 1 is complete

- [ ] Run address encryption backfill in staging.
- [ ] Record address encryption backfill result.
- [ ] Run HMAC contact hash v2 backfill in staging.
- [ ] Record HMAC v2 backfill result.
- [ ] Confirm app readers are fully cut over to v2 lookup hashes.
- [ ] Define burn-in window for legacy SHA-256 contact hashes.
- [ ] Add follow-up migration to drop legacy SHA-256 lookup columns/indexes after burn-in.
- [ ] Verify admin audit payload redaction.
- [ ] Decide booking retention/anonymization policy.
- [ ] Decide message retention/deletion policy.
- [ ] Burn down or formally accept current PII plaintext-read baseline.
- [ ] Re-run final Phase 1 proof commands from clean tree.

## Current known deferred areas

- Booking-level anonymization is deferred until retention policy is finalized.
- Message deletion is deferred until conversation ownership and retention are finalized.
- Notification deliveries need real relation traversal.
- Aftercare summaries need real Booking/Aftercare traversal.
- Attribution events need real attribution identity traversal.
- AdminActionLog export/delete needs real admin audit schema mapping.
- Storage object byte deletion needs a storage write boundary.
- Tenant-level export/delete belongs to WS-1 tenant work