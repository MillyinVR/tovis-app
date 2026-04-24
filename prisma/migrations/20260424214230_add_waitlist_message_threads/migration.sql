/*
  Warnings:

  - A unique constraint covering the columns `[waitlistEntryId]` on the table `MessageThread` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterEnum
ALTER TYPE "MessageThreadContextType" ADD VALUE 'WAITLIST';

-- AlterTable
ALTER TABLE "MessageThread" ADD COLUMN     "waitlistEntryId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "MessageThread_waitlistEntryId_key" ON "MessageThread"("waitlistEntryId");

-- CreateIndex
CREATE INDEX "MessageThread_professionalId_contextType_lastMessageAt_idx" ON "MessageThread"("professionalId", "contextType", "lastMessageAt");

-- CreateIndex
CREATE INDEX "MessageThread_clientId_contextType_lastMessageAt_idx" ON "MessageThread"("clientId", "contextType", "lastMessageAt");

-- CreateIndex
CREATE INDEX "MessageThread_waitlistEntryId_idx" ON "MessageThread"("waitlistEntryId");

-- AddForeignKey
ALTER TABLE "MessageThread" ADD CONSTRAINT "MessageThread_waitlistEntryId_fkey" FOREIGN KEY ("waitlistEntryId") REFERENCES "WaitlistEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
