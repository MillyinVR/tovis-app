/*
  Warnings:

  - A unique constraint covering the columns `[professionalId,dedupeKey]` on the table `Notification` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "Notification_dedupeKey_key";

-- CreateIndex
CREATE UNIQUE INDEX "Notification_professionalId_dedupeKey_key" ON "Notification"("professionalId", "dedupeKey");
