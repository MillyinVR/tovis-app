-- Booking-rule overrides no longer require a reason. Audit rows are still
-- written for every applied override; the reason is recorded only when the
-- pro provided one.

ALTER TABLE "BookingOverrideAuditLog"
  ALTER COLUMN "reason" DROP NOT NULL;

-- Client-visible note the pro attached to the latest booking-rule override,
-- shown on the client's appointment detail (the audit log stays admin-only).

ALTER TABLE "Booking"
  ADD COLUMN IF NOT EXISTS "clientVisibleOverrideNote" TEXT;
