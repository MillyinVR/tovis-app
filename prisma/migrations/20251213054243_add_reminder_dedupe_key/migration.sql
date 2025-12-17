/*
  Warnings:

  - A unique constraint covering the columns `[dedupeKey]` on the table `Reminder` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Reminder" ADD COLUMN     "dedupeKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Reminder_dedupeKey_key" ON "Reminder"("dedupeKey");
