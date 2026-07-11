-- Pro appointment-reminder cadence moves from a fixed 3-value day menu to a
-- fully custom lead-time list. The unit of identity becomes "minutes before the
-- appointment" (offsetMinutes): a whole-day lead is a multiple of 1440 (fires at
-- the appointment's own local wall-clock time N days earlier, DST-safe); a
-- sub-day lead fires exactly that many minutes before the appointment instant.
--
-- Hand-authored (not `prisma migrate dev`) so NO data is dropped: add the new
-- column, backfill offsetDays*1440, then drop the old column.

-- 1. Add the new column with the day/3-day/week default (in minutes).
ALTER TABLE "ProReminderSettings"
  ADD COLUMN "offsetMinutes" INTEGER[] NOT NULL DEFAULT ARRAY[10080, 4320, 1440];

-- 2. Backfill each pro's existing cadence: every stored day-offset * 1440.
--    An empty offsetDays (reminders effectively cleared) backfills to an empty
--    array; the DEFAULT above only seeds brand-new rows.
UPDATE "ProReminderSettings"
SET "offsetMinutes" = ARRAY(SELECT unnest("offsetDays") * 1440);

-- 3. Drop the retired column.
ALTER TABLE "ProReminderSettings" DROP COLUMN "offsetDays";

-- 4. One-shot rewrite of PENDING appointment-reminder rows scheduled before this
--    deploy. The send path keyed on a symbolic "reminderKind"
--    (ONE_WEEK/THREE_DAYS/DAY_BEFORE) in both the payload and the dedupeKey; the
--    new path keys on offsetMinutes and a `M<minutes>` dedupeKey. Without this
--    rewrite the new drain-time validator would see a stale dedupeKey and CANCEL
--    every in-flight reminder. Rewriting the payload (drop reminderKind, add
--    offsetMinutes) and the dedupeKey guarantees zero missed reminders across the
--    deploy. Only untouched (not cancelled / not processed) rows with a
--    recognized kind are rewritten; the runtime parser is legacy-tolerant as
--    defense-in-depth, and any touched booking re-syncs its reminders anyway.
UPDATE "ScheduledClientNotification"
SET
  "data" = jsonb_set(
    "data" - 'reminderKind',
    '{offsetMinutes}',
    to_jsonb(
      CASE "data" ->> 'reminderKind'
        WHEN 'ONE_WEEK' THEN 10080
        WHEN 'THREE_DAYS' THEN 4320
        WHEN 'DAY_BEFORE' THEN 1440
      END
    )
  ),
  "dedupeKey" =
    'CLIENT_REMINDER:M'
    || (
      CASE "data" ->> 'reminderKind'
        WHEN 'ONE_WEEK' THEN 10080
        WHEN 'THREE_DAYS' THEN 4320
        WHEN 'DAY_BEFORE' THEN 1440
      END
    )::text
    || ':'
    || ("data" ->> 'bookingId')
WHERE "eventKey" = 'APPOINTMENT_REMINDER'
  AND "cancelledAt" IS NULL
  AND "processedAt" IS NULL
  AND "data" ->> 'reminderKind' IN ('ONE_WEEK', 'THREE_DAYS', 'DAY_BEFORE')
  AND "data" ->> 'bookingId' IS NOT NULL;
