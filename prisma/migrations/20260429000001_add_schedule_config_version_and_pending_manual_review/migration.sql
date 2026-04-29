-- Phase 4.1: Add scheduleConfigVersion to ProfessionalProfile
-- Used by POST /api/pro/schedule/publish to signal availability cache invalidation.

ALTER TABLE "ProfessionalProfile"
  ADD COLUMN IF NOT EXISTS "scheduleConfigVersion" INTEGER NOT NULL DEFAULT 0;
