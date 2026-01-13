-- AlterTable
ALTER TABLE "MediaAsset" ADD COLUMN     "storageBucket" TEXT,
ADD COLUMN     "storagePath" TEXT,
ADD COLUMN     "thumbBucket" TEXT,
ADD COLUMN     "thumbPath" TEXT;
