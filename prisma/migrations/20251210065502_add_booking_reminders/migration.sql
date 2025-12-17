-- CreateEnum
CREATE TYPE "ReminderChannel" AS ENUM ('SMS', 'EMAIL');

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "reminderChannel" "ReminderChannel",
ADD COLUMN     "reminderMinutesBefore" INTEGER DEFAULT 1440,
ADD COLUMN     "reminderSentAt" TIMESTAMP(3);
