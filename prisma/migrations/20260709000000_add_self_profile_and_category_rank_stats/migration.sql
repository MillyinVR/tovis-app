-- Personalization shared-schema pass (spec §6.6 + §4.1 per-category prior).
--
-- ClientProfile.selfProfile: optional, fully user-entered chip answers (hair
-- type/length/color, skin type/concern) + declared category interests,
-- validated by lib/personalization/selfProfile.ts on write AND read (same
-- pattern as Board.answers). Backfill-free: existing clients simply have no
-- self-profile.
--
-- LookCategoryRankStat: per-service-category engagement-rate aggregate — the
-- data source for the per-category Bayesian prior in Look rank scoring.
-- Populated by the daily looks-category-rank-stats job; empty table means
-- every look keeps the global prior (safe default).

ALTER TABLE "ClientProfile" ADD COLUMN "selfProfile" JSONB;
ALTER TABLE "ClientProfile" ADD COLUMN "selfProfileUpdatedAt" TIMESTAMP(3);

CREATE TABLE "LookCategoryRankStat" (
    "categoryId" TEXT NOT NULL,
    "weightedEngagement" DOUBLE PRECISION NOT NULL,
    "impressions" INTEGER NOT NULL,
    "lookCount" INTEGER NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LookCategoryRankStat_pkey" PRIMARY KEY ("categoryId")
);

ALTER TABLE "LookCategoryRankStat" ADD CONSTRAINT "LookCategoryRankStat_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ServiceCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
