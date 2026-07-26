-- B9: give an imported calendar block a real link to its source feed event.
--
-- The Stage-3 calendar import used to encode the event's iCalendar UID inside
-- the block's `note` as a bracketed `[import:<uid>]` tag, and matched it back
-- with `note contains`. Two problems with that:
--
--   1. `note` is pro-editable (PATCH /api/v1/pro/calendar/blocked/[id]), so
--      editing the text orphans the block — the next resync creates a duplicate
--      and the deletion-reconcile can never remove it again;
--   2. `note` is rendered as the block's TITLE on the pro calendar
--      (app/api/v1/pro/calendar/route.ts), so the tag was user-facing copy.
--
-- Additive and nullable: every existing block reads as "not imported", which is
-- what they all are. The unique index is per professional (a UID is only unique
-- within the feed that issued it) and Postgres treats NULLs as distinct, so
-- hand-created blocks are unconstrained.
--
-- No backfill: verified 0 import-tagged blocks in production and 0 locally
-- before shipping, so there is nothing to migrate.

ALTER TABLE "CalendarBlock" ADD COLUMN "importedEventUid" TEXT;

CREATE UNIQUE INDEX "CalendarBlock_professionalId_importedEventUid_key"
  ON "CalendarBlock"("professionalId", "importedEventUid");
