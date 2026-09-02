-- The UNDO WINDOW on a re-frame (capture chain, item 4).
--
-- The consent bound added by 20260929000000_add_media_asset_crop_rect is a
-- one-way ratchet: a re-frame may narrow inside the current rect and never reach
-- outside it. Correct for disclosure, but it made a pro's own mis-drag permanent
-- — there is no re-consent flow, so one notch too far cropped the photograph
-- that tight forever.
--
-- Tori's decision (2026-09-01): for 24h after a crop, or until the look is
-- viewed by anyone, a re-frame is bounded by the frame that stood BEFORE the
-- narrowing rather than by the narrowed rect. Then the ratchet engages as
-- before. No client re-consent flow — nobody has seen the tighter frame yet.
--
-- cropUndoBoundX/Y/W/H  the frame the pro may return to while the window is open
-- cropUndoExpiresAt     the window itself; NULL = no window (every existing row)
-- cropUndoViewBaseline  total LookPost.viewCount when the window opened; the
--                       window closes once the live total rises above it
--
-- 🔴 An OPEN window is never refreshed by a later crop write. If every save
-- restarted the clock, a pro could hold it open indefinitely by re-cropping
-- every 23 hours and the ratchet would never engage. The rule lives in
-- lib/media/cropUndoWindow.ts and is applied at the write by
-- PUT /api/v1/pro/media/[id]/crop.
--
-- Additive + nullable → fully back-compat. Every existing row gets a NULL
-- expiry, which reads as "no window open", which is byte-identical to today's
-- behaviour: the stored rect is the bound. No backfill.
--
-- No RLS work is needed. 20260901000000_enable_rls_and_pin_function_search_path
-- enabled RLS with no policies (deny-all) on every table in `public`, and the
-- app connects as a BYPASSRLS role. RLS here is a TABLE-level property, so new
-- COLUMNS on an already-covered table inherit it; it is a new TABLE that needs
-- its own grant. Same reasoning as the crop-rect and focal-point migrations.

-- AlterTable
ALTER TABLE "MediaAsset" ADD COLUMN     "cropUndoBoundX" DOUBLE PRECISION;
ALTER TABLE "MediaAsset" ADD COLUMN     "cropUndoBoundY" DOUBLE PRECISION;
ALTER TABLE "MediaAsset" ADD COLUMN     "cropUndoBoundW" DOUBLE PRECISION;
ALTER TABLE "MediaAsset" ADD COLUMN     "cropUndoBoundH" DOUBLE PRECISION;
ALTER TABLE "MediaAsset" ADD COLUMN     "cropUndoExpiresAt" TIMESTAMP(3);
ALTER TABLE "MediaAsset" ADD COLUMN     "cropUndoViewBaseline" INTEGER;
