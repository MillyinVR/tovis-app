/*
  Warnings:

  - A unique constraint covering the columns `[shortCode]` on the table `NfcCard` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "NfcCard" ADD COLUMN     "shortCode" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "NfcCard_shortCode_key" ON "NfcCard"("shortCode");
