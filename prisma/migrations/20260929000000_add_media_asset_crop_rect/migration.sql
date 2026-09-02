-- Non-destructive publish CROP on MediaAsset (capture chain, item 2).
--
-- The rect of the stored image a surface should display, normalized [0,1] from
-- the TOP-LEFT origin — the SAME convention and the SAME space as focalX/focalY
-- (the original, EXIF-corrected upright image at `storagePath`). x/y are the
-- origin, w/h the extent.
--
-- Additive + nullable → fully back-compat: every existing row stays crop-less,
-- which every surface treats as "the full stored frame" = the exact pre-crop
-- render. No backfill, and nothing renders the rect yet — this ships DARK.
--
-- All four columns are written together or not at all. A partial rect has no
-- meaning, so the create choke point (lib/media/recordMediaAsset.ts) normalizes
-- an incomplete or out-of-frame rect to all-NULL rather than storing three of
-- four. That invariant lives in application code on purpose: a CHECK constraint
-- here would have to be dropped and re-added by any future migration that
-- widens the shape, and Prisma's schema is the single source of truth for it.
--
-- 🔴 CONSENT BOUND — the reason this is a stored rect and not baked pixels. The
-- rect is the frame the pro published and the client consented to seeing. A
-- later re-frame may move and narrow anywhere INSIDE the current rect, but may
-- never reach outside it: that would reveal pixels the published frame had
-- removed (the rest of the room, another client, the body below a head crop).
-- Enforced at the write in PUT /api/v1/pro/media/[id]/crop.
-- See docs/design/media-crop-rect.md.
--
-- No RLS work is needed here. `20260901000000_enable_rls_and_pin_function_search_path`
-- enabled RLS with NO policies (deny-all) on every table in `public`, MediaAsset
-- included, and the app connects as a BYPASSRLS role. RLS in this database is a
-- TABLE-level property, so a new COLUMN on an already-covered table inherits it;
-- it is a NEW TABLE that needs its own grant (and `database-hardening.test.ts`
-- is what catches a missing one). The focal-point migration that added focalX /
-- focalY to this same table added no grant either.

-- AlterTable
ALTER TABLE "MediaAsset" ADD COLUMN     "cropX" DOUBLE PRECISION;
ALTER TABLE "MediaAsset" ADD COLUMN     "cropY" DOUBLE PRECISION;
ALTER TABLE "MediaAsset" ADD COLUMN     "cropW" DOUBLE PRECISION;
ALTER TABLE "MediaAsset" ADD COLUMN     "cropH" DOUBLE PRECISION;
