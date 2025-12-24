/*
  Warnings:

  - Added the required column `locationType` to the `BookingHold` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "BookingHold"
ADD COLUMN "locationType" "ServiceLocationType" NOT NULL DEFAULT 'SALON';

