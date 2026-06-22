-- Professional name-display preference.
--
-- Additive only:
--   * New enum ProNameDisplay.
--   * ProfessionalProfile gains nameDisplay with a DEFAULT, so existing rows
--     backfill to BUSINESS_NAME automatically (preserving current rendering).
--
-- No drops, no data backfill needed, safe to apply online.

-- CreateEnum
CREATE TYPE "ProNameDisplay" AS ENUM ('BUSINESS_NAME', 'REAL_NAME', 'HANDLE');

-- AlterTable
ALTER TABLE "ProfessionalProfile" ADD COLUMN "nameDisplay" "ProNameDisplay" NOT NULL DEFAULT 'BUSINESS_NAME';
