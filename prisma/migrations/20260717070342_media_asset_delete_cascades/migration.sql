-- DropForeignKey
ALTER TABLE "LookPost" DROP CONSTRAINT "LookPost_primaryMediaAssetId_fkey";

-- DropForeignKey
ALTER TABLE "LookPostAsset" DROP CONSTRAINT "LookPostAsset_mediaAssetId_fkey";

-- DropForeignKey
ALTER TABLE "MediaComment" DROP CONSTRAINT "MediaComment_mediaId_fkey";

-- DropForeignKey
ALTER TABLE "MediaLike" DROP CONSTRAINT "MediaLike_mediaId_fkey";

-- DropForeignKey
ALTER TABLE "MediaServiceTag" DROP CONSTRAINT "MediaServiceTag_mediaId_fkey";

-- AddForeignKey
ALTER TABLE "MediaServiceTag" ADD CONSTRAINT "MediaServiceTag_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "MediaAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaLike" ADD CONSTRAINT "MediaLike_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "MediaAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaComment" ADD CONSTRAINT "MediaComment_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "MediaAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LookPost" ADD CONSTRAINT "LookPost_primaryMediaAssetId_fkey" FOREIGN KEY ("primaryMediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LookPostAsset" ADD CONSTRAINT "LookPostAsset_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
