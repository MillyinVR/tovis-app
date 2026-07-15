-- LookCategoryTrendStat: per-family RECENT engagement-trend aggregate behind the
-- engagement-driven ordering of the camera shot packs (camera-perfect C10). One
-- row per top-level service family (leaves rolled up to their root), holding the
-- intent-weighted engagement + floored impressions of looks PUBLISHED in the
-- trailing window. Populated by the daily looks-category-trend-stats job; an
-- empty table means the shot packs keep their editorial order (safe default).
-- Additive — safe on a live DB.

-- CreateTable
CREATE TABLE "LookCategoryTrendStat" (
    "categoryId" TEXT NOT NULL,
    "categorySlug" TEXT NOT NULL,
    "weightedEngagement" DOUBLE PRECISION NOT NULL,
    "impressions" INTEGER NOT NULL,
    "lookCount" INTEGER NOT NULL,
    "windowDays" INTEGER NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LookCategoryTrendStat_pkey" PRIMARY KEY ("categoryId")
);

-- CreateIndex
CREATE UNIQUE INDEX "LookCategoryTrendStat_categorySlug_key" ON "LookCategoryTrendStat"("categorySlug");

-- AddForeignKey
ALTER TABLE "LookCategoryTrendStat" ADD CONSTRAINT "LookCategoryTrendStat_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ServiceCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
