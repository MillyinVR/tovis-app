-- License-expiry lifecycle (Tori approved 2026-08-06). Additive, no backfill.
--
-- VerificationDocument.fileDeletedAt: the license-doc-retention sweep purges
-- the raw file (imageUrl/url) 90 days after reviewedAt and stamps this column,
-- keeping everything else on the row (status, reviewedAt, adminNote,
-- reviewedByAdminId) as a permanent audit trail. NULL for every existing row —
-- nothing is retroactively purged.
ALTER TABLE "VerificationDocument" ADD COLUMN "fileDeletedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "VerificationDocument_reviewedAt_fileDeletedAt_idx" ON "VerificationDocument"("reviewedAt", "fileDeletedAt");

-- Two additive enum values (30-days-before reminder, on-expiry badge-paused
-- notice — lib/licensing/licenseExpiryNotifications.ts). Postgres allows
-- ALTER TYPE … ADD VALUE inside a transaction block (PG 12+) as long as the
-- new value is not USED in the same transaction — nothing here uses either
-- one. Precedent: 20260903000000_waitlist_offer_expiry_events.
ALTER TYPE "NotificationEventKey" ADD VALUE IF NOT EXISTS 'PRO_LICENSE_EXPIRING_SOON';
ALTER TYPE "NotificationEventKey" ADD VALUE IF NOT EXISTS 'PRO_LICENSE_EXPIRED';
