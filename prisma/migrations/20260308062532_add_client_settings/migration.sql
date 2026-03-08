-- CreateEnum
CREATE TYPE "ClientAddressKind" AS ENUM ('SEARCH_AREA', 'SERVICE_ADDRESS');

-- AlterTable
ALTER TABLE "ClientProfile" ADD COLUMN     "dateOfBirth" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ClientAddress" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "kind" "ClientAddressKind" NOT NULL,
    "label" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "formattedAddress" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postalCode" TEXT,
    "countryCode" TEXT,
    "placeId" TEXT,
    "lat" DECIMAL(10,7),
    "lng" DECIMAL(10,7),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientAddress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClientAddress_clientId_kind_idx" ON "ClientAddress"("clientId", "kind");

-- CreateIndex
CREATE INDEX "ClientAddress_clientId_isDefault_idx" ON "ClientAddress"("clientId", "isDefault");

-- CreateIndex
CREATE INDEX "ClientAddress_placeId_idx" ON "ClientAddress"("placeId");

-- AddForeignKey
ALTER TABLE "ClientAddress" ADD CONSTRAINT "ClientAddress_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "ClientProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
