-- CreateEnum
CREATE TYPE "ModerationReportReason" AS ENUM ('SPAM', 'HATE_OR_HARASSMENT', 'NUDITY_OR_SEXUAL_CONTENT', 'VIOLENCE_OR_DANGEROUS_ACTS', 'SCAM_OR_FRAUD', 'COPYRIGHT_OR_IMPERSONATION', 'OTHER');

-- AlterTable
ALTER TABLE "LookComment" ADD COLUMN     "adminNotes" TEXT,
ADD COLUMN     "removedAt" TIMESTAMP(3),
ADD COLUMN     "reportCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedByUserId" TEXT;

-- AlterTable
ALTER TABLE "LookCommentReport" ADD COLUMN     "reason" "ModerationReportReason" NOT NULL DEFAULT 'OTHER';

-- AlterTable
ALTER TABLE "LookPost" ADD COLUMN     "adminNotes" TEXT,
ADD COLUMN     "reportCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedByUserId" TEXT;

-- AlterTable
ALTER TABLE "LookPostReport" ADD COLUMN     "reason" "ModerationReportReason" NOT NULL DEFAULT 'OTHER';

-- AlterTable
ALTER TABLE "ViralServiceRequest" ADD COLUMN     "removedAt" TIMESTAMP(3),
ADD COLUMN     "reportCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ViralServiceRequestReport" (
    "id" TEXT NOT NULL,
    "viralServiceRequestId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" "ModerationReportReason" NOT NULL DEFAULT 'OTHER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ViralServiceRequestReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ViralServiceRequestReport_viralServiceRequestId_createdAt_idx" ON "ViralServiceRequestReport"("viralServiceRequestId", "createdAt");

-- CreateIndex
CREATE INDEX "ViralServiceRequestReport_userId_createdAt_idx" ON "ViralServiceRequestReport"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ViralServiceRequestReport_reason_createdAt_idx" ON "ViralServiceRequestReport"("reason", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ViralServiceRequestReport_viralServiceRequestId_userId_key" ON "ViralServiceRequestReport"("viralServiceRequestId", "userId");

-- CreateIndex
CREATE INDEX "LookComment_moderationStatus_reportCount_createdAt_idx" ON "LookComment"("moderationStatus", "reportCount", "createdAt");

-- CreateIndex
CREATE INDEX "LookComment_reviewedByUserId_reviewedAt_idx" ON "LookComment"("reviewedByUserId", "reviewedAt");

-- CreateIndex
CREATE INDEX "LookCommentReport_reason_createdAt_idx" ON "LookCommentReport"("reason", "createdAt");

-- CreateIndex
CREATE INDEX "LookPost_moderationStatus_reportCount_createdAt_idx" ON "LookPost"("moderationStatus", "reportCount", "createdAt");

-- CreateIndex
CREATE INDEX "LookPost_reviewedByUserId_reviewedAt_idx" ON "LookPost"("reviewedByUserId", "reviewedAt");

-- CreateIndex
CREATE INDEX "LookPostReport_reason_createdAt_idx" ON "LookPostReport"("reason", "createdAt");

-- CreateIndex
CREATE INDEX "ViralServiceRequest_moderationStatus_reportCount_createdAt_idx" ON "ViralServiceRequest"("moderationStatus", "reportCount", "createdAt");

-- CreateIndex
CREATE INDEX "ViralServiceRequest_reviewedByUserId_reviewedAt_idx" ON "ViralServiceRequest"("reviewedByUserId", "reviewedAt");

-- AddForeignKey
ALTER TABLE "LookPost" ADD CONSTRAINT "LookPost_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LookComment" ADD CONSTRAINT "LookComment_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ViralServiceRequestReport" ADD CONSTRAINT "ViralServiceRequestReport_viralServiceRequestId_fkey" FOREIGN KEY ("viralServiceRequestId") REFERENCES "ViralServiceRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ViralServiceRequestReport" ADD CONSTRAINT "ViralServiceRequestReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
