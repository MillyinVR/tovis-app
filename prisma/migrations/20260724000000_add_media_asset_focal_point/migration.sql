-- Smart 9:16 publish crop (camera C6). Captures are 3:4; the Looks feed
-- cover-crops to the full phone screen (~9:19.5), scaling to fill height so the
-- left/right ~40% of a 3:4 frame is cropped blind-center. Store a normalized
-- focal point of the subject (a face) on the asset and apply it as CSS
-- `object-position` (web) / UnitPoint (iOS) over the existing cover-crop → the
-- visible window centers on the face, with ZERO image processing and no new
-- bytes (the original file is untouched).
--
-- Additive + nullable → fully back-compat: every existing row stays focal-less,
-- which every surface treats as "center" = the exact pre-C6 render. No backfill.
-- Coordinates are [0,1] from the TOP-LEFT origin (maps 1:1 onto object-position
-- and UnitPoint). Written at the media-confirm choke point; the iOS capture path
-- (C6b) is the v1 source, everything else stays null → center.

-- AlterTable
ALTER TABLE "MediaAsset" ADD COLUMN     "focalX" DOUBLE PRECISION;
ALTER TABLE "MediaAsset" ADD COLUMN     "focalY" DOUBLE PRECISION;
