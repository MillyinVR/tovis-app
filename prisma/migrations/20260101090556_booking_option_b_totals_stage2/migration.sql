/*
  Warnings:

  - Made the column `subtotalSnapshot` on table `Booking` required. This step will fail if there are existing NULL values in that column.
  - Made the column `totalDurationMinutes` on table `Booking` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "Booking" ALTER COLUMN "subtotalSnapshot" SET NOT NULL,
ALTER COLUMN "totalDurationMinutes" SET NOT NULL;
