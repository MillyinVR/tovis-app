-- Pre-resolved public display name on the professional search index.
--
-- Additive: new nullable column. Backfilled from ProfessionalProfile using the
-- BUSINESS_NAME-default resolution (business name, else real name) — which is
-- exactly the resolution for every existing pro, since nameDisplay defaults to
-- BUSINESS_NAME. Pros who later pick REAL_NAME/HANDLE get the right value on
-- their next index refresh. Safe to apply online.

-- AlterTable
ALTER TABLE "ProfessionalSearchIndex" ADD COLUMN "displayName" TEXT;

-- Backfill existing rows (business name → real name), matching the helper's
-- default mode so solo pros are no longer shown as "Professional" in search.
UPDATE "ProfessionalSearchIndex" psi
SET "displayName" = COALESCE(
  NULLIF(TRIM(pp."businessName"), ''),
  NULLIF(TRIM(CONCAT_WS(' ', NULLIF(TRIM(pp."firstName"), ''), NULLIF(TRIM(pp."lastName"), ''))), '')
)
FROM "ProfessionalProfile" pp
WHERE pp."id" = psi."professionalId";
