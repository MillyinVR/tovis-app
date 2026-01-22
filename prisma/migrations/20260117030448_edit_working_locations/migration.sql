/*
  NOTE:
  This migration includes backfills so NOT NULL changes won't fail.

  It also remaps any legacy ProfessionalLocation.type = 'OTHER' to 'SALON'
  before the enum variant is removed.
*/

-- =========================================
-- 0) SAFETY: Backfill/cleanup BEFORE schema constraints
-- =========================================

-- 0A) Remap legacy enum value 'OTHER' so enum change won't fail
UPDATE "ProfessionalLocation"
SET "type" = 'SALON'
WHERE "type" = 'OTHER';


-- 0B) Backfill ProfessionalLocation required fields (defaults)
UPDATE "ProfessionalLocation"
SET
  "workingHours" = COALESCE(
    "workingHours",
    '{
      "mon": {"enabled": true, "start": "09:00", "end": "17:00"},
      "tue": {"enabled": true, "start": "09:00", "end": "17:00"},
      "wed": {"enabled": true, "start": "09:00", "end": "17:00"},
      "thu": {"enabled": true, "start": "09:00", "end": "17:00"},
      "fri": {"enabled": true, "start": "09:00", "end": "17:00"},
      "sat": {"enabled": true, "start": "09:00", "end": "17:00"},
      "sun": {"enabled": true, "start": "09:00", "end": "17:00"}
    }'::jsonb
  ),
  "bufferMinutes" = COALESCE("bufferMinutes", 10),
  "stepMinutes" = COALESCE("stepMinutes", 5),
  "advanceNoticeMinutes" = COALESCE("advanceNoticeMinutes", 10),
  "maxDaysAhead" = COALESCE("maxDaysAhead", 365);


-- 0C) Backfill Booking.locationId where NULL (choose best matching location)
-- Preference:
--  - Match by booking.locationType:
--      SALON  -> location.type in (SALON, SUITE)
--      MOBILE -> location.type = MOBILE_BASE
--  - Prefer isPrimary
--  - Prefer oldest createdAt
UPDATE "Booking" b
SET "locationId" = x."locationId"
FROM (
  SELECT DISTINCT ON (b2."id")
    b2."id" AS "bookingId",
    pl."id" AS "locationId"
  FROM "Booking" b2
  JOIN "ProfessionalLocation" pl
    ON pl."professionalId" = b2."professionalId"
   AND pl."isBookable" = true
  WHERE b2."locationId" IS NULL
  ORDER BY
    b2."id",
    CASE
      WHEN b2."locationType" = 'SALON'  AND pl."type" IN ('SALON','SUITE') THEN 0
      WHEN b2."locationType" = 'MOBILE' AND pl."type" = 'MOBILE_BASE' THEN 0
      ELSE 1
    END,
    pl."isPrimary" DESC,
    pl."createdAt" ASC
) x
WHERE b."id" = x."bookingId"
  AND b."locationId" IS NULL;


-- 0D) Backfill BookingHold.locationId where NULL
-- We prefer:
--  - If hold has professionalId + locationType, pick matching pro location
--  - Prefer isPrimary
--  - Prefer oldest createdAt
UPDATE "BookingHold" h
SET "locationId" = x."locationId"
FROM (
  SELECT DISTINCT ON (h2."id")
    h2."id" AS "holdId",
    pl."id" AS "locationId"
  FROM "BookingHold" h2
  JOIN "ProfessionalLocation" pl
    ON pl."professionalId" = h2."professionalId"
   AND pl."isBookable" = true
  WHERE h2."locationId" IS NULL
  ORDER BY
    h2."id",
    CASE
      WHEN h2."locationType" = 'SALON'  AND pl."type" IN ('SALON','SUITE') THEN 0
      WHEN h2."locationType" = 'MOBILE' AND pl."type" = 'MOBILE_BASE' THEN 0
      ELSE 1
    END,
    pl."isPrimary" DESC,
    pl."createdAt" ASC
) x
WHERE h."id" = x."holdId"
  AND h."locationId" IS NULL;


-- 0E) If you already have duplicate holds for the same (locationId, scheduledFor),
-- the UNIQUE index will fail. Since holds are temporary, we delete duplicates and keep the newest.
DELETE FROM "BookingHold" a
USING "BookingHold" b
WHERE a."locationId" IS NOT NULL
  AND a."scheduledFor" = b."scheduledFor"
  AND a."locationId" = b."locationId"
  AND a."id" <> b."id"
  AND a."createdAt" < b."createdAt";


-- =========================================
-- 1) AlterEnum: remove OTHER safely (already remapped above)
-- =========================================
BEGIN;
CREATE TYPE "ProfessionalLocationType_new" AS ENUM ('SALON', 'SUITE', 'MOBILE_BASE');
ALTER TABLE "public"."ProfessionalLocation" ALTER COLUMN "type" DROP DEFAULT;
ALTER TABLE "ProfessionalLocation"
  ALTER COLUMN "type" TYPE "ProfessionalLocationType_new"
  USING ("type"::text::"ProfessionalLocationType_new");
ALTER TYPE "ProfessionalLocationType" RENAME TO "ProfessionalLocationType_old";
ALTER TYPE "ProfessionalLocationType_new" RENAME TO "ProfessionalLocationType";
DROP TYPE "public"."ProfessionalLocationType_old";
COMMIT;


-- =========================================
-- 2) DropForeignKey / DropIndex (as Prisma generated)
-- =========================================
ALTER TABLE "Booking" DROP CONSTRAINT "Booking_locationId_fkey";
ALTER TABLE "BookingHold" DROP CONSTRAINT "BookingHold_locationId_fkey";

DROP INDEX "Booking_locationId_idx";
DROP INDEX "Booking_locationTimeZone_idx";
DROP INDEX "Booking_professionalId_clientId_idx";
DROP INDEX "BookingHold_locationId_idx";
DROP INDEX "BookingHold_locationTimeZone_idx";
DROP INDEX "BookingHold_professionalId_scheduledFor_key";


-- =========================================
-- 3) AlterTable (now safe because we backfilled)
-- =========================================
ALTER TABLE "Booking"
  DROP COLUMN "durationMinutesSnapshot",
  DROP COLUMN "priceSnapshot",
  DROP COLUMN "serviceNotes",
  ALTER COLUMN "locationType" DROP DEFAULT,
  ALTER COLUMN "clientTimeZoneAtBooking" SET DATA TYPE VARCHAR(64),
  ALTER COLUMN "locationId" SET NOT NULL,
  ALTER COLUMN "locationTimeZone" SET DATA TYPE VARCHAR(64);

ALTER TABLE "BookingHold"
  ALTER COLUMN "locationId" SET NOT NULL,
  ALTER COLUMN "locationTimeZone" SET DATA TYPE VARCHAR(64);

ALTER TABLE "ProfessionalLocation"
  ALTER COLUMN "type" DROP DEFAULT,
  ALTER COLUMN "timeZone" SET DATA TYPE VARCHAR(64),
  ALTER COLUMN "workingHours" SET NOT NULL,
  ALTER COLUMN "bufferMinutes" SET NOT NULL,
  ALTER COLUMN "bufferMinutes" SET DEFAULT 10,
  ALTER COLUMN "stepMinutes" SET NOT NULL,
  ALTER COLUMN "stepMinutes" SET DEFAULT 5,
  ALTER COLUMN "advanceNoticeMinutes" SET NOT NULL,
  ALTER COLUMN "advanceNoticeMinutes" SET DEFAULT 10,
  ALTER COLUMN "maxDaysAhead" SET NOT NULL,
  ALTER COLUMN "maxDaysAhead" SET DEFAULT 365;

ALTER TABLE "ProfessionalProfile"
  DROP COLUMN "addressLine1",
  DROP COLUMN "addressLine2",
  DROP COLUMN "city",
  DROP COLUMN "isInSalon",
  DROP COLUMN "isMobile",
  DROP COLUMN "isSuite",
  DROP COLUMN "latitude",
  DROP COLUMN "longitude",
  DROP COLUMN "postalCode",
  DROP COLUMN "state",
  DROP COLUMN "workingHours",
  ADD COLUMN "mobileBasePostalCode" TEXT,
  ALTER COLUMN "timeZone" SET DATA TYPE VARCHAR(64);


-- =========================================
-- 4) CreateIndex / constraints / FKs (as Prisma generated)
-- =========================================
CREATE INDEX "Booking_clientId_scheduledFor_idx" ON "Booking"("clientId", "scheduledFor");
CREATE INDEX "Booking_locationId_scheduledFor_idx" ON "Booking"("locationId", "scheduledFor");

CREATE INDEX "BookingHold_professionalId_expiresAt_idx" ON "BookingHold"("professionalId", "expiresAt");
CREATE UNIQUE INDEX "BookingHold_locationId_scheduledFor_key" ON "BookingHold"("locationId", "scheduledFor");

ALTER TABLE "Booking"
  ADD CONSTRAINT "Booking_locationId_fkey"
  FOREIGN KEY ("locationId")
  REFERENCES "ProfessionalLocation"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

ALTER TABLE "BookingHold"
  ADD CONSTRAINT "BookingHold_locationId_fkey"
  FOREIGN KEY ("locationId")
  REFERENCES "ProfessionalLocation"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

ALTER TABLE "BookingHold"
  ADD CONSTRAINT "BookingHold_offeringId_fkey"
  FOREIGN KEY ("offeringId")
  REFERENCES "ProfessionalServiceOffering"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

ALTER TABLE "BookingHold"
  ADD CONSTRAINT "BookingHold_professionalId_fkey"
  FOREIGN KEY ("professionalId")
  REFERENCES "ProfessionalProfile"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;
