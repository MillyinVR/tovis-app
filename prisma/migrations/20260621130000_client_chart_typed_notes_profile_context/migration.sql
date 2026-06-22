-- Client chart PR3: typed notes + pro-captured profile context.
--
-- Additive / expand-only — safe to apply online:
--   * new ClientNoteKind enum
--   * ClientProfessionalNote.kind (NOT NULL DEFAULT 'GENERAL' — existing rows get
--     the default, no backfill needed)
--   * ClientProfile.occupationEncrypted (AEAD envelope JSONB, nullable) +
--     proCapturedSocialHandle (nullable TEXT)
--   * one new composite index for author/kind lookups
--
-- No data backfill, no drops, no NOT NULL added to pre-existing nullable data.
-- The new enum is only referenced by the new column's default.

-- CreateEnum
CREATE TYPE "ClientNoteKind" AS ENUM ('GENERAL', 'CONSULTATION', 'COMMUNICATION_STYLE', 'DO_NOT_REBOOK');

-- AlterTable
ALTER TABLE "ClientProfessionalNote" ADD COLUMN     "kind" "ClientNoteKind" NOT NULL DEFAULT 'GENERAL';

-- AlterTable
ALTER TABLE "ClientProfile" ADD COLUMN     "occupationEncrypted" JSONB,
ADD COLUMN     "proCapturedSocialHandle" TEXT;

-- CreateIndex
CREATE INDEX "ClientProfessionalNote_professionalId_clientId_kind_idx" ON "ClientProfessionalNote"("professionalId", "clientId", "kind");
