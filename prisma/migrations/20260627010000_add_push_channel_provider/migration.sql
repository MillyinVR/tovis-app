-- AlterEnum
ALTER TYPE "NotificationChannel" ADD VALUE 'PUSH';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationProvider" ADD VALUE 'APNS';
ALTER TYPE "NotificationProvider" ADD VALUE 'FCM';

-- DropIndex
DROP INDEX "NotificationDelivery_dispatchId_channel_key";

-- CreateIndex
CREATE UNIQUE INDEX "NotificationDelivery_dispatchId_channel_destination_key" ON "NotificationDelivery"("dispatchId", "channel", "destination");
