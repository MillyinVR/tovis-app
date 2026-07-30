-- K8: the pro's per-service calendar colour, stored on the pro↔service JOIN.
--
-- 🔴 NOT on "Service": that is a GLOBAL catalog row (`name @unique`) shared by
-- every pro on the platform, so no pro can own a column there.
--
-- Nullable with no backfill. Absent means "no service colour", and the event
-- card's 4px accent stripe keeps painting the booking's STATUS tone exactly as
-- it did before K7 — the column only ever adds a colour, never removes one.
--
-- Deliberately TEXT rather than an enum: the palette is a BRAND token set
-- (lib/brand/defaults.ts), so a white-label tenant can ship a different one,
-- and a value that is no longer in the palette must degrade to "no colour"
-- rather than break a migration. `parseCalendarSwatch` narrows it on read.
ALTER TABLE "ProfessionalServiceOffering"
  ADD COLUMN "calendarSwatch" TEXT;
