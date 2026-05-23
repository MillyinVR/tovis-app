-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "addressSnapshotsEncryptedAt" TIMESTAMP(3),
ADD COLUMN     "clientAddressLatApprox" DOUBLE PRECISION,
ADD COLUMN     "clientAddressLngApprox" DOUBLE PRECISION,
ADD COLUMN     "clientAddressSnapshotKeyVersion" VARCHAR(32),
ADD COLUMN     "encryptedClientAddressSnapshotJson" JSONB,
ADD COLUMN     "encryptedLocationAddressSnapshotJson" JSONB,
ADD COLUMN     "locationAddressSnapshotKeyVersion" VARCHAR(32),
ADD COLUMN     "locationLatApprox" DOUBLE PRECISION,
ADD COLUMN     "locationLngApprox" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "BookingHold" ADD COLUMN     "addressSnapshotsEncryptedAt" TIMESTAMP(3),
ADD COLUMN     "clientAddressLatApprox" DOUBLE PRECISION,
ADD COLUMN     "clientAddressLngApprox" DOUBLE PRECISION,
ADD COLUMN     "clientAddressSnapshotKeyVersion" VARCHAR(32),
ADD COLUMN     "encryptedClientAddressSnapshotJson" JSONB,
ADD COLUMN     "encryptedLocationAddressSnapshotJson" JSONB,
ADD COLUMN     "locationAddressSnapshotKeyVersion" VARCHAR(32),
ADD COLUMN     "locationLatApprox" DOUBLE PRECISION,
ADD COLUMN     "locationLngApprox" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "ClientAddress" ADD COLUMN     "addressKeyVersion" VARCHAR(32),
ADD COLUMN     "encryptedAddressJson" JSONB,
ADD COLUMN     "encryptedAt" TIMESTAMP(3),
ADD COLUMN     "latApprox" DECIMAL(8,4),
ADD COLUMN     "lngApprox" DECIMAL(8,4),
ADD COLUMN     "postalCodePrefix" VARCHAR(12);

-- AlterTable
ALTER TABLE "ProfessionalLocation" ADD COLUMN     "addressKeyVersion" VARCHAR(32),
ADD COLUMN     "encryptedAddressJson" JSONB,
ADD COLUMN     "encryptedAt" TIMESTAMP(3),
ADD COLUMN     "latApprox" DECIMAL(8,4),
ADD COLUMN     "lngApprox" DECIMAL(8,4),
ADD COLUMN     "postalCodePrefix" VARCHAR(12);

-- CreateIndex
CREATE INDEX "Booking_locationAddressSnapshotKeyVersion_idx" ON "Booking"("locationAddressSnapshotKeyVersion");

-- CreateIndex
CREATE INDEX "Booking_clientAddressSnapshotKeyVersion_idx" ON "Booking"("clientAddressSnapshotKeyVersion");

-- CreateIndex
CREATE INDEX "Booking_addressSnapshotsEncryptedAt_idx" ON "Booking"("addressSnapshotsEncryptedAt");

-- CreateIndex
CREATE INDEX "BookingHold_locationAddressSnapshotKeyVersion_idx" ON "BookingHold"("locationAddressSnapshotKeyVersion");

-- CreateIndex
CREATE INDEX "BookingHold_clientAddressSnapshotKeyVersion_idx" ON "BookingHold"("clientAddressSnapshotKeyVersion");

-- CreateIndex
CREATE INDEX "BookingHold_addressSnapshotsEncryptedAt_idx" ON "BookingHold"("addressSnapshotsEncryptedAt");

-- CreateIndex
CREATE INDEX "ClientAddress_postalCodePrefix_idx" ON "ClientAddress"("postalCodePrefix");

-- CreateIndex
CREATE INDEX "ClientAddress_latApprox_lngApprox_idx" ON "ClientAddress"("latApprox", "lngApprox");

-- CreateIndex
CREATE INDEX "ClientAddress_addressKeyVersion_idx" ON "ClientAddress"("addressKeyVersion");

-- CreateIndex
CREATE INDEX "ProfessionalLocation_postalCodePrefix_idx" ON "ProfessionalLocation"("postalCodePrefix");

-- CreateIndex
CREATE INDEX "ProfessionalLocation_latApprox_lngApprox_idx" ON "ProfessionalLocation"("latApprox", "lngApprox");

-- CreateIndex
CREATE INDEX "ProfessionalLocation_addressKeyVersion_idx" ON "ProfessionalLocation"("addressKeyVersion");