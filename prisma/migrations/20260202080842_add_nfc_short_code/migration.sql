/*
  Warnings:

  - Made the column `shortCode` on table `NfcCard` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "NfcCard" ALTER COLUMN "shortCode" SET NOT NULL;
