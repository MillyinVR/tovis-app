-- 1) Create a replacement enum with the full final value set
CREATE TYPE "NotificationEventKey_new" AS ENUM (
  'BOOKING_REQUEST_CREATED',
  'BOOKING_CONFIRMED',
  'BOOKING_RESCHEDULED',
  'BOOKING_CANCELLED_BY_CLIENT',
  'BOOKING_CANCELLED_BY_PRO',
  'BOOKING_CANCELLED_BY_ADMIN',
  'CONSULTATION_PROPOSAL_SENT',
  'CONSULTATION_APPROVED',
  'CONSULTATION_REJECTED',
  'REVIEW_RECEIVED',
  'APPOINTMENT_REMINDER',
  'AFTERCARE_READY',
  'LAST_MINUTE_OPENING_AVAILABLE',
  'PAYMENT_COLLECTED',
  'PAYMENT_ACTION_REQUIRED'
);

-- 2) Add new nullable eventKey columns using the replacement enum
ALTER TABLE "Notification"
  ADD COLUMN "eventKey" "NotificationEventKey_new";

ALTER TABLE "ClientNotification"
  ADD COLUMN "eventKey" "NotificationEventKey_new";

ALTER TABLE "ScheduledClientNotification"
  ADD COLUMN "eventKey" "NotificationEventKey_new";

-- 3) Move existing NotificationEventKey columns to the replacement enum
ALTER TABLE "NotificationDispatch"
  ALTER COLUMN "eventKey" TYPE "NotificationEventKey_new"
  USING ("eventKey"::text::"NotificationEventKey_new");

ALTER TABLE "ProfessionalNotificationPreference"
  ALTER COLUMN "eventKey" TYPE "NotificationEventKey_new"
  USING ("eventKey"::text::"NotificationEventKey_new");

ALTER TABLE "ClientNotificationPreference"
  ALTER COLUMN "eventKey" TYPE "NotificationEventKey_new"
  USING ("eventKey"::text::"NotificationEventKey_new");

-- 4) Backfill pro notifications from old reason values
UPDATE "Notification"
SET "eventKey" = CASE "reason"
  WHEN 'BOOKING_REQUEST_CREATED' THEN 'BOOKING_REQUEST_CREATED'::"NotificationEventKey_new"
  WHEN 'BOOKING_CONFIRMED' THEN 'BOOKING_CONFIRMED'::"NotificationEventKey_new"
  WHEN 'BOOKING_RESCHEDULED' THEN 'BOOKING_RESCHEDULED'::"NotificationEventKey_new"
  WHEN 'BOOKING_CANCELLED_BY_CLIENT' THEN 'BOOKING_CANCELLED_BY_CLIENT'::"NotificationEventKey_new"
  WHEN 'BOOKING_CANCELLED_BY_ADMIN' THEN 'BOOKING_CANCELLED_BY_ADMIN'::"NotificationEventKey_new"
  WHEN 'CONSULTATION_APPROVED' THEN 'CONSULTATION_APPROVED'::"NotificationEventKey_new"
  WHEN 'CONSULTATION_REJECTED' THEN 'CONSULTATION_REJECTED'::"NotificationEventKey_new"
  WHEN 'REVIEW_RECEIVED' THEN 'REVIEW_RECEIVED'::"NotificationEventKey_new"
  WHEN 'PAYMENT_COLLECTED' THEN 'PAYMENT_COLLECTED'::"NotificationEventKey_new"
  WHEN 'PAYMENT_ACTION_REQUIRED' THEN 'PAYMENT_ACTION_REQUIRED'::"NotificationEventKey_new"
  ELSE NULL
END
WHERE "eventKey" IS NULL;

-- 5) Backfill client inbox notifications where mapping is unambiguous
UPDATE "ClientNotification"
SET "eventKey" = CASE "type"
  WHEN 'AFTERCARE' THEN 'AFTERCARE_READY'::"NotificationEventKey_new"
  WHEN 'LAST_MINUTE' THEN 'LAST_MINUTE_OPENING_AVAILABLE'::"NotificationEventKey_new"
  WHEN 'BOOKING_CONFIRMED' THEN 'BOOKING_CONFIRMED'::"NotificationEventKey_new"
  WHEN 'BOOKING_RESCHEDULED' THEN 'BOOKING_RESCHEDULED'::"NotificationEventKey_new"
  WHEN 'CONSULTATION_PROPOSAL' THEN 'CONSULTATION_PROPOSAL_SENT'::"NotificationEventKey_new"
  WHEN 'APPOINTMENT_REMINDER' THEN 'APPOINTMENT_REMINDER'::"NotificationEventKey_new"
  ELSE NULL
END
WHERE "eventKey" IS NULL;

-- 6) Backfill scheduled client notifications where mapping is unambiguous
UPDATE "ScheduledClientNotification"
SET "eventKey" = CASE "type"
  WHEN 'AFTERCARE' THEN 'AFTERCARE_READY'::"NotificationEventKey_new"
  WHEN 'LAST_MINUTE' THEN 'LAST_MINUTE_OPENING_AVAILABLE'::"NotificationEventKey_new"
  WHEN 'BOOKING_CONFIRMED' THEN 'BOOKING_CONFIRMED'::"NotificationEventKey_new"
  WHEN 'BOOKING_RESCHEDULED' THEN 'BOOKING_RESCHEDULED'::"NotificationEventKey_new"
  WHEN 'CONSULTATION_PROPOSAL' THEN 'CONSULTATION_PROPOSAL_SENT'::"NotificationEventKey_new"
  WHEN 'APPOINTMENT_REMINDER' THEN 'APPOINTMENT_REMINDER'::"NotificationEventKey_new"
  ELSE NULL
END
WHERE "eventKey" IS NULL;

-- 7) Refuse to continue if anything is still unmapped
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Notification"
    WHERE "eventKey" IS NULL
  ) THEN
    RAISE EXCEPTION 'Unmapped Notification rows remain. Backfill them before continuing.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "ClientNotification"
    WHERE "eventKey" IS NULL
  ) THEN
    RAISE EXCEPTION 'Unmapped ClientNotification rows remain. Backfill them before continuing.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "ScheduledClientNotification"
    WHERE "eventKey" IS NULL
  ) THEN
    RAISE EXCEPTION 'Unmapped ScheduledClientNotification rows remain. Backfill them before continuing.';
  END IF;
END $$;

-- 8) Drop old indexes that depend on legacy columns
DROP INDEX IF EXISTS "Notification_professionalId_type_archivedAt_createdAt_idx";
DROP INDEX IF EXISTS "Notification_professionalId_reason_archivedAt_createdAt_idx";
DROP INDEX IF EXISTS "ClientNotification_clientId_type_createdAt_idx";

-- 9) Make new columns required
ALTER TABLE "Notification"
  ALTER COLUMN "eventKey" SET NOT NULL;

ALTER TABLE "ClientNotification"
  ALTER COLUMN "eventKey" SET NOT NULL;

ALTER TABLE "ScheduledClientNotification"
  ALTER COLUMN "eventKey" SET NOT NULL;

-- 10) Drop legacy columns
ALTER TABLE "Notification"
  DROP COLUMN "type",
  DROP COLUMN "reason";

ALTER TABLE "ClientNotification"
  DROP COLUMN "type";

ALTER TABLE "ScheduledClientNotification"
  DROP COLUMN "type";

-- 11) Recreate indexes on eventKey
CREATE INDEX "Notification_professionalId_eventKey_archivedAt_createdAt_idx"
  ON "Notification"("professionalId", "eventKey", "archivedAt", "createdAt");

CREATE INDEX "Notification_professionalId_priority_archivedAt_createdAt_idx"
  ON "Notification"("professionalId", "priority", "archivedAt", "createdAt");

CREATE INDEX "ClientNotification_clientId_eventKey_createdAt_idx"
  ON "ClientNotification"("clientId", "eventKey", "createdAt");

-- 12) Drop legacy enum types after no columns depend on them
DROP TYPE IF EXISTS "NotificationType";
DROP TYPE IF EXISTS "ProNotificationReason";
DROP TYPE IF EXISTS "ClientNotificationType";

-- 13) Swap the enum name so Prisma schema still matches
DROP TYPE "NotificationEventKey";
ALTER TYPE "NotificationEventKey_new" RENAME TO "NotificationEventKey";