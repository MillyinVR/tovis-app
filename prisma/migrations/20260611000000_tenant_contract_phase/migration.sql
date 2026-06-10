-- Contract phase of the tenant expand–contract migration
-- (docs/architecture/tenant-model.md). Prerequisite: the launch-environment
-- backfill (prisma/scripts/backfillTenantFoundation.ts) has been run and
-- verified — zero NULLs across all five tenant columns. Verified 2026-06-10.
--
-- These SET NOT NULL statements fail loudly if any NULL slipped in between
-- the backfill and this migration; re-run the backfill and retry.

-- AlterTable
ALTER TABLE "ProfessionalProfile" ALTER COLUMN "homeTenantId" SET NOT NULL;

-- AlterTable
ALTER TABLE "ClientProfile" ALTER COLUMN "homeTenantId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Booking" ALTER COLUMN "proTenantId" SET NOT NULL,
ALTER COLUMN "clientHomeTenantId" SET NOT NULL;

-- AlterTable
ALTER TABLE "NfcCard" ALTER COLUMN "tenantId" SET NOT NULL;

-- Drop the deprecated salonSlug placeholder (superseded by tenantId).
DROP INDEX "NfcCard_salonSlug_idx";
ALTER TABLE "NfcCard" DROP COLUMN "salonSlug";
