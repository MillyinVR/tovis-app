-- CreateEnum
CREATE TYPE "LookImpressionSource" AS ENUM ('FEED', 'DETAIL', 'BOARD');

-- CreateTable
CREATE TABLE "LookPostImpressionStat" (
    "lookPostId" TEXT NOT NULL,
    "source" "LookImpressionSource" NOT NULL,
    "windowDate" DATE NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LookPostImpressionStat_pkey" PRIMARY KEY ("lookPostId","source","windowDate")
);

-- CreateIndex
CREATE INDEX "LookPostImpressionStat_windowDate_idx" ON "LookPostImpressionStat"("windowDate");

-- CreateIndex
CREATE INDEX "LookPostImpressionStat_lookPostId_windowDate_idx" ON "LookPostImpressionStat"("lookPostId", "windowDate");

-- AddForeignKey
ALTER TABLE "LookPostImpressionStat" ADD CONSTRAINT "LookPostImpressionStat_lookPostId_fkey" FOREIGN KEY ("lookPostId") REFERENCES "LookPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
