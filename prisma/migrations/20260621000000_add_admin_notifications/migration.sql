-- Admin operational notifications.
--
-- Additive only:
--   * NotificationRecipientKind gains ADMIN.
--   * NotificationEventKey gains three admin operational-alert keys.
--   * New AdminNotification inbox table (keyed by the admin User).
--   * NotificationDispatch gains an optional adminNotificationId link.
--
-- No data backfill, no drops, no NOT NULL on existing rows. New enum values are
-- not referenced in any DDL here (only at runtime), so this is safe to apply
-- online.

-- AlterEnum
ALTER TYPE "NotificationRecipientKind" ADD VALUE 'ADMIN';

-- AlterEnum
ALTER TYPE "NotificationEventKey" ADD VALUE 'ADMIN_VERIFICATION_REVIEW_NEEDED';
ALTER TYPE "NotificationEventKey" ADD VALUE 'ADMIN_SUPPORT_TICKET_CREATED';
ALTER TYPE "NotificationEventKey" ADD VALUE 'ADMIN_VIRAL_REQUEST_PENDING';

-- AlterTable
ALTER TABLE "NotificationDispatch" ADD COLUMN     "adminNotificationId" TEXT;

-- CreateTable
CREATE TABLE "AdminNotification" (
    "id" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "eventKey" "NotificationEventKey" NOT NULL,
    "priority" "NotificationPriority" NOT NULL DEFAULT 'NORMAL',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "href" TEXT NOT NULL DEFAULT '',
    "data" JSONB,
    "dedupeKey" TEXT,
    "seenAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "clickedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdminNotification_adminUserId_archivedAt_readAt_createdAt_idx" ON "AdminNotification"("adminUserId", "archivedAt", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "AdminNotification_adminUserId_eventKey_archivedAt_createdAt_idx" ON "AdminNotification"("adminUserId", "eventKey", "archivedAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AdminNotification_adminUserId_dedupeKey_key" ON "AdminNotification"("adminUserId", "dedupeKey");

-- CreateIndex
CREATE INDEX "NotificationDispatch_adminNotificationId_idx" ON "NotificationDispatch"("adminNotificationId");

-- AddForeignKey
ALTER TABLE "NotificationDispatch" ADD CONSTRAINT "NotificationDispatch_adminNotificationId_fkey" FOREIGN KEY ("adminNotificationId") REFERENCES "AdminNotification"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminNotification" ADD CONSTRAINT "AdminNotification_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
