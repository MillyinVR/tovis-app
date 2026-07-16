-- CreateTable
CREATE TABLE "LookViewerImpressionStat" (
    "userId" TEXT NOT NULL,
    "lookPostId" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LookViewerImpressionStat_pkey" PRIMARY KEY ("userId","lookPostId")
);

-- CreateIndex
CREATE INDEX "LookViewerImpressionStat_userId_count_idx" ON "LookViewerImpressionStat"("userId", "count");

-- CreateIndex
CREATE INDEX "LookViewerImpressionStat_lookPostId_idx" ON "LookViewerImpressionStat"("lookPostId");

-- AddForeignKey
ALTER TABLE "LookViewerImpressionStat" ADD CONSTRAINT "LookViewerImpressionStat_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LookViewerImpressionStat" ADD CONSTRAINT "LookViewerImpressionStat_lookPostId_fkey" FOREIGN KEY ("lookPostId") REFERENCES "LookPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

