-- P2.7: Add composite indexes flagged by the connectedness audit's
-- capacity plan as required for 100K-day-one read performance.
--
-- Three indexes are genuinely missing — the rest of the audit's
-- original list (ProfessionalLocation [professionalId, isBookable],
-- MediaAsset [bookingId, phase], NotificationDelivery [status,
-- nextAttemptAt], IdempotencyKey [status, lockedUntil],
-- BookingHold [professionalId, expiresAt]) already exist or are
-- covered by leading-prefix on existing composite indexes.
--
-- Booking [professionalId, status, scheduledFor] is intentionally
-- skipped: the audit plan called for adding it only after EXPLAIN
-- ANALYZE confirms it's needed against production query patterns.
-- Without prod data we'd be speculating.
--
-- IF NOT EXISTS guards make this re-runnable.
--
-- Notes for post-launch migrations: at 100K+ rows on these tables,
-- consider switching to CREATE INDEX CONCURRENTLY in a separate
-- non-transactional migration step to avoid table-level locks.

-- 1. ProfessionalServiceOffering: filtered list reads always include
--    isActive = true. Without this, every pro-detail page does a
--    seqscan over the offerings table.
CREATE INDEX IF NOT EXISTS "ProfessionalServiceOffering_professionalId_isActive_idx"
ON "ProfessionalServiceOffering" ("professionalId", "isActive");

-- 2. ProfessionalProfile: search and discovery filter to verified pros.
--    With 10K registered pros, the filter is selective enough that an
--    index on verificationStatus alone is materially faster than
--    seqscan + filter.
CREATE INDEX IF NOT EXISTS "ProfessionalProfile_verificationStatus_idx"
ON "ProfessionalProfile" ("verificationStatus");

-- 3. BookingHold: the hold-cleanup cron sweeps WHERE expiresAt <= now,
--    no professionalId predicate. The existing
--    [professionalId, expiresAt] composite cannot serve a query
--    without a leading professionalId predicate, so the cron either
--    seqscans or uses the index inefficiently. A bare [expiresAt]
--    index makes the sweep linear in the number of expired holds.
CREATE INDEX IF NOT EXISTS "BookingHold_expiresAt_idx"
ON "BookingHold" ("expiresAt");
