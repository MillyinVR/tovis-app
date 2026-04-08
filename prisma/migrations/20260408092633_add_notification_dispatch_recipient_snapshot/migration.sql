/*
  Warnings:

  - You are about to drop the column `reminderChannel` on the `Booking` table. All the data in the column will be lost.
  - You are about to drop the column `reminderMinutesBefore` on the `Booking` table. All the data in the column will be lost.
  - You are about to drop the column `reminderSentAt` on the `Booking` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Booking" DROP COLUMN "reminderChannel",
DROP COLUMN "reminderMinutesBefore",
DROP COLUMN "reminderSentAt";

-- AlterTable
ALTER TABLE "NotificationDispatch" ADD COLUMN     "recipientEmail" VARCHAR(320),
ADD COLUMN     "recipientInAppTargetId" VARCHAR(64),
ADD COLUMN     "recipientPhone" VARCHAR(32),
ADD COLUMN     "recipientTimeZone" VARCHAR(64);

-- DropEnum
DROP TYPE "ReminderChannel";
