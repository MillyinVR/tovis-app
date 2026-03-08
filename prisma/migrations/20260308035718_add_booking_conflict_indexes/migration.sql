-- CreateIndex
CREATE INDEX "CalendarBlock_professionalId_locationId_startsAt_endsAt_idx" ON "CalendarBlock"("professionalId", "locationId", "startsAt", "endsAt");
