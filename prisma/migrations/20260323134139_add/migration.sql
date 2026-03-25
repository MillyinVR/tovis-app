/*
  Warnings:

  - A unique constraint covering the columns `[bookingId,idempotencyKey]` on the table `Review` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "BookingCloseoutAuditAction" AS ENUM ('SESSION_STARTED', 'SESSION_FINISHED', 'SESSION_STEP_CHANGED', 'FINAL_REVIEW_CONFIRMED', 'AFTERCARE_DRAFT_SAVED', 'AFTERCARE_FINALIZED', 'CHECKOUT_UPDATED', 'CHECKOUT_PRODUCTS_UPDATED', 'REBOOK_CREATED', 'REVIEW_CREATED');

-- AlterTable
ALTER TABLE "Review" ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "requestId" TEXT;

-- CreateTable
CREATE TABLE "BookingCloseoutAuditLog" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "bookingId" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" "BookingCloseoutAuditAction" NOT NULL,
    "route" TEXT NOT NULL,
    "requestId" TEXT,
    "idempotencyKey" TEXT,
    "oldValue" JSONB,
    "newValue" JSONB,
    "metadata" JSONB,

    CONSTRAINT "BookingCloseoutAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BookingCloseoutAuditLog_bookingId_createdAt_idx" ON "BookingCloseoutAuditLog"("bookingId", "createdAt");

-- CreateIndex
CREATE INDEX "BookingCloseoutAuditLog_professionalId_createdAt_idx" ON "BookingCloseoutAuditLog"("professionalId", "createdAt");

-- CreateIndex
CREATE INDEX "BookingCloseoutAuditLog_actorUserId_createdAt_idx" ON "BookingCloseoutAuditLog"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "BookingCloseoutAuditLog_action_createdAt_idx" ON "BookingCloseoutAuditLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "BookingCloseoutAuditLog_requestId_idx" ON "BookingCloseoutAuditLog"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "BookingCloseoutAuditLog_bookingId_action_idempotencyKey_key" ON "BookingCloseoutAuditLog"("bookingId", "action", "idempotencyKey");

-- CreateIndex
CREATE INDEX "Review_bookingId_createdAt_idx" ON "Review"("bookingId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Review_bookingId_idempotencyKey_key" ON "Review"("bookingId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "BookingCloseoutAuditLog" ADD CONSTRAINT "BookingCloseoutAuditLog_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingCloseoutAuditLog" ADD CONSTRAINT "BookingCloseoutAuditLog_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "ProfessionalProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingCloseoutAuditLog" ADD CONSTRAINT "BookingCloseoutAuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
