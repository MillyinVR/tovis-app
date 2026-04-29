-- Phase 0.2: Add IN_PROGRESS to BookingStatus enum
-- Phase 7.3: Add BOOKING_STARTED to NotificationEventKey enum
-- Phase 3.3: Add PENDING_MANUAL_REVIEW to VerificationStatus enum

-- AlterEnum: BookingStatus — add IN_PROGRESS
ALTER TYPE "BookingStatus" ADD VALUE IF NOT EXISTS 'IN_PROGRESS';

-- AlterEnum: NotificationEventKey — add BOOKING_STARTED
ALTER TYPE "NotificationEventKey" ADD VALUE IF NOT EXISTS 'BOOKING_STARTED';

-- AlterEnum: VerificationStatus — add PENDING_MANUAL_REVIEW
ALTER TYPE "VerificationStatus" ADD VALUE IF NOT EXISTS 'PENDING_MANUAL_REVIEW';
