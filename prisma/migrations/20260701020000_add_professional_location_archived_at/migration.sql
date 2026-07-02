-- Soft-delete for pro locations. A pro can "remove" a location even when it has
-- historical bookings / holds / last-minute openings / aftercare rebook slots
-- (those FKs are Restrict). Referenced locations are archived (hidden from the
-- pro's management, publish, booking and search surfaces) instead of being
-- hard-deleted, so booking history and FK integrity are preserved. Locations
-- with no references are still hard-deleted and never get an archivedAt.
--
-- Additive — nullable column + index, no existing data touched.

ALTER TABLE "ProfessionalLocation" ADD COLUMN "archivedAt" TIMESTAMP(3);

CREATE INDEX "ProfessionalLocation_professionalId_archivedAt_idx" ON "ProfessionalLocation"("professionalId", "archivedAt");
