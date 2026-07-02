-- Opt-in before/after pairing on MediaAsset. `beforeAssetId` lives on the
-- *displayed* "after" asset (the photo a pro features to portfolio, or the
-- after-photo of a review) and points at the chosen "before" counterpart, so
-- surfaces can render the comparison slider (BeforeAfterReveal /
-- BeforeAfterCompareView) instead of a single tile. Null = single tile.
--
-- Additive — nullable self-referential FK + index, no existing data touched.
-- ON DELETE SET NULL so deleting a "before" never cascades to the "after" that
-- referenced it (the after simply reverts to a single tile).

ALTER TABLE "MediaAsset" ADD COLUMN "beforeAssetId" TEXT;

CREATE INDEX "MediaAsset_beforeAssetId_idx" ON "MediaAsset"("beforeAssetId");

ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_beforeAssetId_fkey" FOREIGN KEY ("beforeAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
