-- Per-look weekly save momentum: the "+84 saves this week · top 3% in Brooklyn"
-- banner on /client/activity.
--
-- Additive only — one new table, nothing existing is touched — so the deploy is
-- safe to run ahead of the code that reads it. Until the hourly job has run the
-- table is empty, and an empty table renders no banner, which is exactly the
-- correct output for "nothing is trending".
--
-- Modelled on ClientCreatorStat (20260913000000): job-owned, replaced wholesale
-- on every run, CHECK-constrained at the database rather than trusted to every
-- future writer, and carrying its own RLS statement.

CREATE TABLE "ClientLookTrendStat" (
    "lookPostId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "weeklySaves" INTEGER NOT NULL,
    "cityPercentile" INTEGER,
    "city" TEXT,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientLookTrendStat_pkey" PRIMARY KEY ("lookPostId")
);

-- The only read shape: "this client's best-moving look this week".
CREATE INDEX "ClientLookTrendStat_clientId_weeklySaves_idx"
  ON "ClientLookTrendStat"("clientId", "weeklySaves");

ALTER TABLE "ClientLookTrendStat"
  ADD CONSTRAINT "ClientLookTrendStat_lookPostId_fkey"
  FOREIGN KEY ("lookPostId") REFERENCES "LookPost"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ClientLookTrendStat"
  ADD CONSTRAINT "ClientLookTrendStat_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "ClientProfile"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- A percentile is a rank, not a score.
ALTER TABLE "ClientLookTrendStat"
  ADD CONSTRAINT "ClientLookTrendStat_cityPercentile_range"
  CHECK ("cityPercentile" IS NULL OR ("cityPercentile" >= 0 AND "cityPercentile" <= 100));

-- 🔴 The percentile and the city it was computed in are ONE fact. A percentile
-- with no city is a "top 3%" the banner cannot name a place for, and a city with
-- no percentile is a place with nothing to say about it — either half alone
-- would be rendered as a claim the other half was supposed to qualify.
ALTER TABLE "ClientLookTrendStat"
  ADD CONSTRAINT "ClientLookTrendStat_city_pairs_with_percentile"
  CHECK (("cityPercentile" IS NULL) = ("city" IS NULL));

-- A row only exists because the look actually moved. Zero is not a trend, and a
-- zero row is a flattering number waiting for a reader to print it.
ALTER TABLE "ClientLookTrendStat"
  ADD CONSTRAINT "ClientLookTrendStat_weeklySaves_positive"
  CHECK ("weeklySaves" > 0);

-- 🔴 Every table in this database carries RLS; a new one that omits it is
-- readable by any role the app's connection can assume. No policy is added: all
-- access goes through the app's own scoping (the Prisma service role bypasses
-- RLS), matching ClientCreatorStat and the sibling engagement tables.
ALTER TABLE "ClientLookTrendStat" ENABLE ROW LEVEL SECURITY;
