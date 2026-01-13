-- Ensure the unique index matches the database intent:
-- one hold per professional per scheduledFor (locationType should not allow duplicates)

DROP INDEX IF EXISTS "BookingHold_professionalId_scheduledFor_locationType_key";

CREATE UNIQUE INDEX IF NOT EXISTS "BookingHold_professionalId_scheduledFor_key"
ON "BookingHold"("professionalId", "scheduledFor");
