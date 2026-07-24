-- M15: cancellation-policy consent recorded on the booking. When a client
-- finalizes with a pro who charges no-show / late-cancel fees, they agree to the
-- policy first; we record when they agreed and a JSON snapshot of the exact terms
-- shown (the no-show fee is later charged from this snapshot, not the pro's live
-- settings). Both additive + nullable — no backfill, inert on every existing row,
-- and inert until ENABLE_NO_SHOW_PROTECTION is on.
ALTER TABLE "Booking" ADD COLUMN "cancellationPolicyAcceptedAt" TIMESTAMP(3);
ALTER TABLE "Booking" ADD COLUMN "cancellationPolicySnapshot" JSONB;
