-- Per-add-on "pre-select this" switch (Tori, 2026-08-14): whether a
-- recommended add-on starts ticked is the PRO's choice, not a platform
-- default. `isRecommended` keeps its existing meaning (drives the
-- "Recommended" badge only) — this is a separate, independent opt-in.
--
-- Additive and default-off: every existing OfferingAddOn keeps its current
-- effective behavior of "not pre-ticked" until a pro explicitly turns this on
-- for a specific add-on, so this is safe to run ahead of the code that reads
-- it, and needs no coordinated same-deploy client update.
ALTER TABLE "OfferingAddOn" ADD COLUMN "isPreselected" BOOLEAN NOT NULL DEFAULT false;
