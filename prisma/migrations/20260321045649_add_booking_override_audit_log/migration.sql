-- CreateEnum
CREATE TYPE "BookingOverrideRule" AS ENUM ('ADVANCE_NOTICE', 'MAX_DAYS_AHEAD', 'WORKING_HOURS');

-- CreateEnum
CREATE TYPE "BookingOverrideAction" AS ENUM ('CREATE', 'UPDATE');

-- CreateTable
CREATE TABLE "BookingOverrideAuditLog" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "bookingId" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "action" "BookingOverrideAction" NOT NULL,
    "rule" "BookingOverrideRule" NOT NULL,
    "reason" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "requestId" TEXT,
    "oldValue" JSONB NOT NULL,
    "newValue" JSONB NOT NULL,
    "bookingScheduledForBefore" TIMESTAMP(3),
    "bookingScheduledForAfter" TIMESTAMP(3),
    "metadata" JSONB,

    CONSTRAINT "BookingOverrideAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BookingOverrideAuditLog_bookingId_createdAt_idx" ON "BookingOverrideAuditLog"("bookingId", "createdAt");

-- CreateIndex
CREATE INDEX "BookingOverrideAuditLog_professionalId_createdAt_idx" ON "BookingOverrideAuditLog"("professionalId", "createdAt");

-- CreateIndex
CREATE INDEX "BookingOverrideAuditLog_actorUserId_createdAt_idx" ON "BookingOverrideAuditLog"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "BookingOverrideAuditLog_rule_createdAt_idx" ON "BookingOverrideAuditLog"("rule", "createdAt");

-- CreateIndex
CREATE INDEX "BookingOverrideAuditLog_action_createdAt_idx" ON "BookingOverrideAuditLog"("action", "createdAt");

-- AddForeignKey
ALTER TABLE "BookingOverrideAuditLog" ADD CONSTRAINT "BookingOverrideAuditLog_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingOverrideAuditLog" ADD CONSTRAINT "BookingOverrideAuditLog_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "ProfessionalProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingOverrideAuditLog" ADD CONSTRAINT "BookingOverrideAuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
