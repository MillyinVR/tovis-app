-- Add client identity linkage to invite rows.
-- Phase 3 goal: claim state belongs to ClientProfile, and invite links
-- must point directly at the client identity they deliver for.

-- 1) Add the column as nullable first so we can backfill safely.
ALTER TABLE "ProClientInvite"
ADD COLUMN "clientId" TEXT;

-- 2) Backfill from the booking that already owns the invite row.
UPDATE "ProClientInvite" AS pci
SET "clientId" = b."clientId"
FROM "Booking" AS b
WHERE b."id" = pci."bookingId"
  AND pci."clientId" IS NULL;

-- 3) Hard fail if any row still could not be linked.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "ProClientInvite"
    WHERE "clientId" IS NULL
  ) THEN
    RAISE EXCEPTION
      'Migration aborted: some ProClientInvite rows could not be backfilled with clientId from Booking.clientId';
  END IF;
END $$;

-- 4) Make the new column required.
ALTER TABLE "ProClientInvite"
ALTER COLUMN "clientId" SET NOT NULL;

-- 5) Add the foreign key to ClientProfile.
ALTER TABLE "ProClientInvite"
ADD CONSTRAINT "ProClientInvite_clientId_fkey"
FOREIGN KEY ("clientId")
REFERENCES "ClientProfile"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

-- 6) Add indexes for identity-based claim lookups.
CREATE INDEX "ProClientInvite_clientId_idx"
ON "ProClientInvite"("clientId");

CREATE INDEX "ProClientInvite_clientId_status_createdAt_idx"
ON "ProClientInvite"("clientId", "status", "createdAt");