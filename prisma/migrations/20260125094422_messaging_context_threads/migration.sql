/*
  Warnings:

  - A unique constraint covering the columns `[clientId,professionalId,contextType,contextId]` on the table `MessageThread` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `contextId` to the `MessageThread` table without a default value. This is not possible if the table is not empty.
  - Added the required column `contextType` to the `MessageThread` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "MessageThreadContextType" AS ENUM ('BOOKING', 'SERVICE', 'OFFERING', 'PRO_PROFILE');

-- DropIndex
DROP INDEX "MessageThread_clientId_professionalId_serviceId_key";

-- AlterTable
ALTER TABLE "MessageThread" ADD COLUMN     "bookingId" TEXT,
ADD COLUMN     "contextId" TEXT NOT NULL,
ADD COLUMN     "contextType" "MessageThreadContextType" NOT NULL,
ADD COLUMN     "lastMessageAt" TIMESTAMP(3),
ADD COLUMN     "lastMessagePreview" TEXT;

-- CreateTable
CREATE TABLE "MessageThreadParticipant" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "lastReadAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessageThreadParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MessageThreadParticipant_userId_updatedAt_idx" ON "MessageThreadParticipant"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "MessageThreadParticipant_threadId_updatedAt_idx" ON "MessageThreadParticipant"("threadId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MessageThreadParticipant_threadId_userId_key" ON "MessageThreadParticipant"("threadId", "userId");

-- CreateIndex
CREATE INDEX "Message_threadId_createdAt_idx" ON "Message"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "MessageThread_contextType_contextId_idx" ON "MessageThread"("contextType", "contextId");

-- CreateIndex
CREATE UNIQUE INDEX "MessageThread_clientId_professionalId_contextType_contextId_key" ON "MessageThread"("clientId", "professionalId", "contextType", "contextId");

-- AddForeignKey
ALTER TABLE "MessageThread" ADD CONSTRAINT "MessageThread_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageThreadParticipant" ADD CONSTRAINT "MessageThreadParticipant_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "MessageThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageThreadParticipant" ADD CONSTRAINT "MessageThreadParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
