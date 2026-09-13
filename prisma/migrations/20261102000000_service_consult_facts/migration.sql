-- What a service actually DOES, so the consult can diagnose instead of guess.
--
-- 🔴 The problem this fixes, measured in production on 2026-09-13: every one of
-- the twelve live `Service` rows had an EMPTY description. So
-- `consultLookPlanMenuContext` was handing the model:
--
--   [{"name":"Full Head Highlight","description":null},
--    {"name":"Toner","description":null}, …]
--
-- The engine was choosing a client's services from BARE NAMES. It had no way to
-- know that a toner cannot lighten anything, that a highlight is chemical work,
-- or that an iTip install adds length rather than changing colour — and it
-- showed: placeholder style directions in both stored analyses, and service
-- names invented off the menu in two separate runs.
--
-- These columns are ENGINE-facing and are not the client blurb. `description`
-- stays what it is ("hand-painted, lived-in lightness"); these say what the work
-- can and cannot ACHIEVE.
--
-- 🔴 Admin-owned (Tori, 2026-09-13: "i want the admin to have the ability to
-- edit and add any services/categories and info directly from their dashboard…
-- so nothing is actually hard coded into the app"). The values below are a
-- STARTING POINT written into the database, not app constants — the app reads
-- these columns, and an admin may change every one of them without a deploy.
--
-- Every column is nullable or defaulted on purpose: an unfilled service makes
-- no claim, and the consult then says less rather than inventing a capability.

ALTER TABLE "Service"
  ADD COLUMN IF NOT EXISTS "consultSummary" TEXT,
  ADD COLUMN IF NOT EXISTS "maxLiftLevels"  INTEGER,
  ADD COLUMN IF NOT EXISTS "depositsTone"   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "isChemical"     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "changesShape"   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "addsLength"     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "limitations"    TEXT;

-- A lift figure is levels of lightening, so it cannot be negative, and nothing
-- on a hair menu lifts more than about seven levels in one service. The bound
-- is deliberately generous — it exists to catch a typo (70 for 7), not to
-- second-guess a colourist.
ALTER TABLE "Service" DROP CONSTRAINT IF EXISTS "Service_maxLiftLevels_range";
ALTER TABLE "Service"
  ADD CONSTRAINT "Service_maxLiftLevels_range"
  CHECK ("maxLiftLevels" IS NULL OR ("maxLiftLevels" >= 0 AND "maxLiftLevels" <= 10));

-- 🔴 A service that lightens is chemical work, always. Stating it twice is how
-- the two facts drift apart, and the one that would drift is the safety one.
ALTER TABLE "Service" DROP CONSTRAINT IF EXISTS "Service_lift_implies_chemical";
ALTER TABLE "Service"
  ADD CONSTRAINT "Service_lift_implies_chemical"
  CHECK (COALESCE("maxLiftLevels", 0) = 0 OR "isChemical");
