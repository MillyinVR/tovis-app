/*
  Warnings:

  - The values [WAITLIST] on the enum `BookingStatus` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `preferredEnd` on the `WaitlistEntry` table. All the data in the column will be lost.
  - You are about to drop the column `preferredStart` on the `WaitlistEntry` table. All the data in the column will be lost.
  - You are about to drop the column `preferredTimeBucket` on the `WaitlistEntry` table. All the data in the column will be lost.
  - Added the required column `updatedAt` to the `WaitlistEntry` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "WaitlistPreferenceType" AS ENUM ('ANY_TIME', 'TIME_OF_DAY', 'SPECIFIC_DATE', 'TIME_RANGE');

-- CreateEnum
CREATE TYPE "WaitlistTimeOfDay" AS ENUM ('MORNING', 'AFTERNOON', 'EVENING');

-- AlterEnum
BEGIN;
CREATE TYPE "BookingStatus_new" AS ENUM ('PENDING', 'ACCEPTED', 'COMPLETED', 'CANCELLED');
ALTER TABLE "public"."Booking" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Booking" ALTER COLUMN "status" TYPE "BookingStatus_new" USING ("status"::text::"BookingStatus_new");
ALTER TYPE "BookingStatus" RENAME TO "BookingStatus_old";
ALTER TYPE "BookingStatus_new" RENAME TO "BookingStatus";
DROP TYPE "public"."BookingStatus_old";
ALTER TABLE "Booking" ALTER COLUMN "status" SET DEFAULT 'PENDING';
COMMIT;

-- DropForeignKey
ALTER TABLE "WaitlistEntry" DROP CONSTRAINT "WaitlistEntry_clientId_fkey";

-- DropForeignKey
ALTER TABLE "WaitlistEntry" DROP CONSTRAINT "WaitlistEntry_professionalId_fkey";

-- DropForeignKey
ALTER TABLE "WaitlistEntry" DROP CONSTRAINT "WaitlistEntry_serviceId_fkey";

-- AlterTable
ALTER TABLE "WaitlistEntry" DROP COLUMN "preferredEnd",
DROP COLUMN "preferredStart",
DROP COLUMN "preferredTimeBucket",
ADD COLUMN     "preferenceType" "WaitlistPreferenceType" NOT NULL DEFAULT 'ANY_TIME',
ADD COLUMN     "specificDate" DATE,
ADD COLUMN     "timeOfDay" "WaitlistTimeOfDay",
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "windowEndMin" INTEGER,
ADD COLUMN     "windowStartMin" INTEGER;

-- CreateIndex
CREATE INDEX "WaitlistEntry_professionalId_status_createdAt_idx" ON "WaitlistEntry"("professionalId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "WaitlistEntry_clientId_status_createdAt_idx" ON "WaitlistEntry"("clientId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "WaitlistEntry_serviceId_status_createdAt_idx" ON "WaitlistEntry"("serviceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "WaitlistEntry_professionalId_preferenceType_status_idx" ON "WaitlistEntry"("professionalId", "preferenceType", "status");

-- AddForeignKey
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "ClientProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "ProfessionalProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;
