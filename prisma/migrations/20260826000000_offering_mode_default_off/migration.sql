-- W6: stop defaulting a service offering to "in salon".
--
-- `offersInSalon` was `DEFAULT true`, so every offering created without an
-- explicit mode claimed in-salon booking. That is what put an In-salon toggle —
-- and the salon waitlist panel under it — in front of clients booking a
-- mobile-only pro, and what made `ensureLocationsForOffering` auto-write a
-- placeholder "Set salon address" location to back the claim up.
--
-- Column default only. EXISTING ROWS ARE NOT TOUCHED: correcting offerings whose
-- salon flag was never a choice is a separate, reviewed backfill
-- (scripts/w6-offering-mode-backfill.mjs), because it changes what live pros
-- advertise and must be dry-run first. Until that runs, the client-facing read
-- boundary in lib/offerings/locationCapability.ts is what keeps an unhostable
-- mode from reaching a client.
ALTER TABLE "ProfessionalServiceOffering"
  ALTER COLUMN "offersInSalon" SET DEFAULT false;
