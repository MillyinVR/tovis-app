-- Client-side media export/share (docs decision, Tori 2026-08-05).
--
-- Whether a CLIENT may export/share this pro's media with the pro's handle
-- watermarked on it. Independent of exportsDropPlatformMark/
-- social_export_unbranded, which decides the platform MARK, not whether
-- export is allowed at all.
--
-- Additive, default true (existing pros opted in by default per Tori's
-- decision), no backfill needed.

ALTER TABLE "ProfessionalProfile" ADD COLUMN "clientMediaExportEnabled" BOOLEAN NOT NULL DEFAULT true;
