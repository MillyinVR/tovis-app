/*
  Warnings:

  - The values [PENDING] on the enum `ViralServiceRequestStatus` will be removed. If these variants are still used in the database, this will fail.

*/
-- CreateEnum
CREATE TYPE "LookPostStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED', 'REMOVED');

-- CreateEnum
CREATE TYPE "LookPostVisibility" AS ENUM ('PUBLIC', 'FOLLOWERS_ONLY', 'UNLISTED');

-- CreateEnum
CREATE TYPE "ModerationStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REJECTED', 'REMOVED', 'AUTO_FLAGGED');

-- CreateEnum
CREATE TYPE "BoardVisibility" AS ENUM ('PRIVATE', 'SHARED');

-- AlterEnum
BEGIN;
CREATE TYPE "ViralServiceRequestStatus_new" AS ENUM ('REQUESTED', 'IN_REVIEW', 'APPROVED', 'REJECTED');
ALTER TABLE "public"."ViralServiceRequest" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "ViralServiceRequest" ALTER COLUMN "status" TYPE "ViralServiceRequestStatus_new" USING ("status"::text::"ViralServiceRequestStatus_new");
ALTER TYPE "ViralServiceRequestStatus" RENAME TO "ViralServiceRequestStatus_old";
ALTER TYPE "ViralServiceRequestStatus_new" RENAME TO "ViralServiceRequestStatus";
DROP TYPE "public"."ViralServiceRequestStatus_old";
ALTER TABLE "ViralServiceRequest" ALTER COLUMN "status" SET DEFAULT 'REQUESTED';
COMMIT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "transactionalSmsConsentAt" TIMESTAMP(3),
ADD COLUMN     "transactionalSmsConsentIp" VARCHAR(64),
ADD COLUMN     "transactionalSmsConsentSource" VARCHAR(64),
ADD COLUMN     "transactionalSmsConsentUserAgent" TEXT,
ADD COLUMN     "transactionalSmsConsentVersion" VARCHAR(64);

-- AlterTable
ALTER TABLE "ViralServiceRequest" ADD COLUMN     "adminNotes" TEXT,
ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "description" TEXT,
ADD COLUMN     "linksJson" JSONB,
ADD COLUMN     "mediaUrlsJson" JSONB,
ADD COLUMN     "moderationStatus" "ModerationStatus" NOT NULL DEFAULT 'APPROVED',
ADD COLUMN     "rejectedAt" TIMESTAMP(3),
ADD COLUMN     "requestedCategoryId" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedByUserId" TEXT,
ALTER COLUMN "status" SET DEFAULT 'REQUESTED';

-- CreateTable
CREATE TABLE "LookPost" (
    "id" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "primaryMediaAssetId" TEXT NOT NULL,
    "serviceId" TEXT,
    "caption" TEXT,
    "priceStartingAt" DECIMAL(10,2),
    "status" "LookPostStatus" NOT NULL DEFAULT 'DRAFT',
    "visibility" "LookPostVisibility" NOT NULL DEFAULT 'PUBLIC',
    "moderationStatus" "ModerationStatus" NOT NULL DEFAULT 'APPROVED',
    "publishedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "removedAt" TIMESTAMP(3),
    "likeCount" INTEGER NOT NULL DEFAULT 0,
    "commentCount" INTEGER NOT NULL DEFAULT 0,
    "saveCount" INTEGER NOT NULL DEFAULT 0,
    "shareCount" INTEGER NOT NULL DEFAULT 0,
    "spotlightScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rankScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LookPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LookPostAsset" (
    "id" TEXT NOT NULL,
    "lookPostId" TEXT NOT NULL,
    "mediaAssetId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LookPostAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LookLike" (
    "id" TEXT NOT NULL,
    "lookPostId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LookLike_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LookComment" (
    "id" TEXT NOT NULL,
    "lookPostId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "moderationStatus" "ModerationStatus" NOT NULL DEFAULT 'APPROVED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LookComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProFollow" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProFollow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Board" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "visibility" "BoardVisibility" NOT NULL DEFAULT 'PRIVATE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Board_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoardItem" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "lookPostId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BoardItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LookPost_primaryMediaAssetId_key" ON "LookPost"("primaryMediaAssetId");

-- CreateIndex
CREATE INDEX "LookPost_professionalId_publishedAt_idx" ON "LookPost"("professionalId", "publishedAt");

-- CreateIndex
CREATE INDEX "LookPost_serviceId_publishedAt_idx" ON "LookPost"("serviceId", "publishedAt");

-- CreateIndex
CREATE INDEX "LookPost_status_visibility_publishedAt_idx" ON "LookPost"("status", "visibility", "publishedAt");

-- CreateIndex
CREATE INDEX "LookPost_moderationStatus_publishedAt_idx" ON "LookPost"("moderationStatus", "publishedAt");

-- CreateIndex
CREATE INDEX "LookPost_rankScore_publishedAt_idx" ON "LookPost"("rankScore", "publishedAt");

-- CreateIndex
CREATE INDEX "LookPost_spotlightScore_publishedAt_idx" ON "LookPost"("spotlightScore", "publishedAt");

-- CreateIndex
CREATE INDEX "LookPostAsset_lookPostId_sortOrder_idx" ON "LookPostAsset"("lookPostId", "sortOrder");

-- CreateIndex
CREATE INDEX "LookPostAsset_mediaAssetId_idx" ON "LookPostAsset"("mediaAssetId");

-- CreateIndex
CREATE UNIQUE INDEX "LookPostAsset_lookPostId_mediaAssetId_key" ON "LookPostAsset"("lookPostId", "mediaAssetId");

-- CreateIndex
CREATE INDEX "LookLike_lookPostId_createdAt_idx" ON "LookLike"("lookPostId", "createdAt");

-- CreateIndex
CREATE INDEX "LookLike_userId_createdAt_idx" ON "LookLike"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LookLike_lookPostId_userId_key" ON "LookLike"("lookPostId", "userId");

-- CreateIndex
CREATE INDEX "LookComment_lookPostId_createdAt_idx" ON "LookComment"("lookPostId", "createdAt");

-- CreateIndex
CREATE INDEX "LookComment_userId_createdAt_idx" ON "LookComment"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "LookComment_moderationStatus_createdAt_idx" ON "LookComment"("moderationStatus", "createdAt");

-- CreateIndex
CREATE INDEX "ProFollow_professionalId_createdAt_idx" ON "ProFollow"("professionalId", "createdAt");

-- CreateIndex
CREATE INDEX "ProFollow_clientId_createdAt_idx" ON "ProFollow"("clientId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProFollow_clientId_professionalId_key" ON "ProFollow"("clientId", "professionalId");

-- CreateIndex
CREATE INDEX "Board_clientId_createdAt_idx" ON "Board"("clientId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Board_clientId_name_key" ON "Board"("clientId", "name");

-- CreateIndex
CREATE INDEX "BoardItem_lookPostId_createdAt_idx" ON "BoardItem"("lookPostId", "createdAt");

-- CreateIndex
CREATE INDEX "BoardItem_boardId_createdAt_idx" ON "BoardItem"("boardId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BoardItem_boardId_lookPostId_key" ON "BoardItem"("boardId", "lookPostId");

-- CreateIndex
CREATE INDEX "ViralServiceRequest_requestedCategoryId_status_createdAt_idx" ON "ViralServiceRequest"("requestedCategoryId", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "LookPost" ADD CONSTRAINT "LookPost_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "ProfessionalProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LookPost" ADD CONSTRAINT "LookPost_primaryMediaAssetId_fkey" FOREIGN KEY ("primaryMediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LookPost" ADD CONSTRAINT "LookPost_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LookPostAsset" ADD CONSTRAINT "LookPostAsset_lookPostId_fkey" FOREIGN KEY ("lookPostId") REFERENCES "LookPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LookPostAsset" ADD CONSTRAINT "LookPostAsset_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LookLike" ADD CONSTRAINT "LookLike_lookPostId_fkey" FOREIGN KEY ("lookPostId") REFERENCES "LookPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LookLike" ADD CONSTRAINT "LookLike_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LookComment" ADD CONSTRAINT "LookComment_lookPostId_fkey" FOREIGN KEY ("lookPostId") REFERENCES "LookPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LookComment" ADD CONSTRAINT "LookComment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProFollow" ADD CONSTRAINT "ProFollow_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "ClientProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProFollow" ADD CONSTRAINT "ProFollow_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "ProfessionalProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Board" ADD CONSTRAINT "Board_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "ClientProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardItem" ADD CONSTRAINT "BoardItem_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardItem" ADD CONSTRAINT "BoardItem_lookPostId_fkey" FOREIGN KEY ("lookPostId") REFERENCES "LookPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ViralServiceRequest" ADD CONSTRAINT "ViralServiceRequest_requestedCategoryId_fkey" FOREIGN KEY ("requestedCategoryId") REFERENCES "ServiceCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ViralServiceRequest" ADD CONSTRAINT "ViralServiceRequest_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
