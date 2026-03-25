-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "BookingCloseoutAuditAction" ADD VALUE 'CONSULTATION_PROPOSAL_SENT';
ALTER TYPE "BookingCloseoutAuditAction" ADD VALUE 'CONSULTATION_APPROVED';
ALTER TYPE "BookingCloseoutAuditAction" ADD VALUE 'CONSULTATION_REJECTED';
ALTER TYPE "BookingCloseoutAuditAction" ADD VALUE 'PAYMENT_METHOD_UPDATED';
ALTER TYPE "BookingCloseoutAuditAction" ADD VALUE 'PAYMENT_AUTHORIZED';
ALTER TYPE "BookingCloseoutAuditAction" ADD VALUE 'PAYMENT_COLLECTED';
