-- BookingRefund: per-refund records against a booking's captured Stripe payment
-- (automated cancellation refunds + discretionary pro/admin refunds). A booking
-- can have several rows (partial / repeated refunds); the cumulative SUCCEEDED
-- amount drives Booking.stripePaymentStatus.
--
-- Written in the idempotent raw-SQL style (see
-- 20260614100000_add_upload_session_and_media_pointer_unique) so manual reruns /
-- manual prod application are safe. Adding a new table + enums is metadata-only
-- (no rewrite of existing tables, no blocking lock).

-- Enums ---------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BookingRefundStatus') THEN
    CREATE TYPE "BookingRefundStatus" AS ENUM (
      'PENDING',
      'SUCCEEDED',
      'FAILED',
      'CANCELED'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BookingRefundTrigger') THEN
    CREATE TYPE "BookingRefundTrigger" AS ENUM (
      'AUTO_CANCELLATION',
      'DISCRETIONARY'
    );
  END IF;
END
$$;

-- BookingRefund -------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "BookingRefund" (
  "id"                     TEXT NOT NULL,
  "bookingId"              TEXT NOT NULL,
  "amountCents"            INTEGER NOT NULL,
  "currency"               VARCHAR(3) NOT NULL,
  "status"                 "BookingRefundStatus" NOT NULL DEFAULT 'PENDING',
  "trigger"                "BookingRefundTrigger" NOT NULL,
  "reverseTransfer"        BOOLEAN NOT NULL DEFAULT true,
  "applicationFeeRefunded" BOOLEAN NOT NULL DEFAULT false,
  "initiatedByUserId"      TEXT,
  "initiatedByRole"        "Role",
  "reason"                 VARCHAR(500),
  "stripePaymentIntentId"  TEXT,
  "stripeRefundId"         TEXT,
  "failureCode"            TEXT,
  "failureMessage"         VARCHAR(500),
  "createdAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"              TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BookingRefund_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "BookingRefund_stripeRefundId_key"
  ON "BookingRefund"("stripeRefundId");
CREATE INDEX IF NOT EXISTS "BookingRefund_bookingId_idx"
  ON "BookingRefund"("bookingId");
CREATE INDEX IF NOT EXISTS "BookingRefund_status_idx"
  ON "BookingRefund"("status");

-- Foreign key ---------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'BookingRefund_bookingId_fkey'
  ) THEN
    ALTER TABLE "BookingRefund"
      ADD CONSTRAINT "BookingRefund_bookingId_fkey"
      FOREIGN KEY ("bookingId") REFERENCES "Booking"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;
