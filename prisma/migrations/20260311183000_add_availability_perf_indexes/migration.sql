-- CreateIndex
CREATE INDEX "BookingHold_professionalId_scheduledFor_expiresAt_idx" ON "BookingHold"("professionalId", "scheduledFor", "expiresAt");

-- CreateIndex
CREATE INDEX "ProfessionalLocation_isBookable_type_lat_lng_idx" ON "ProfessionalLocation"("isBookable", "type", "lat", "lng");
