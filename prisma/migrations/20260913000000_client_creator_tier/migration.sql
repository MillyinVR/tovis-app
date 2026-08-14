-- Client-as-creator standing for the public profile (`/u/[handle]`):
-- an opt-in public city, plus a derived, job-owned tier/percentile table.
--
-- Additive only. Every column is nullable or defaulted, and no existing row is
-- rewritten, so the deploy is safe to run ahead of the code that reads it: a
-- client with no ClientCreatorStat row is simply untiered, which is the correct
-- rendering for someone who has never published a public look.

-- The city a creator chooses to show beside their tier. Deliberately its own
-- opt-in field rather than a read of ClientAddress — see schema.prisma.
ALTER TABLE "ClientProfile" ADD COLUMN "publicCity" TEXT;

CREATE TYPE "ClientCreatorTier" AS ENUM ('NONE', 'RISING', 'TASTEMAKER');

CREATE TABLE "ClientCreatorStat" (
    "clientId" TEXT NOT NULL,
    "totalSaves" INTEGER NOT NULL DEFAULT 0,
    "totalRecreations" INTEGER NOT NULL DEFAULT 0,
    "publicLookCount" INTEGER NOT NULL DEFAULT 0,
    "savePercentile" INTEGER,
    "tier" "ClientCreatorTier" NOT NULL DEFAULT 'NONE',
    "computedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientCreatorStat_pkey" PRIMARY KEY ("clientId")
);

CREATE INDEX "ClientCreatorStat_tier_idx" ON "ClientCreatorStat"("tier");
CREATE INDEX "ClientCreatorStat_savePercentile_idx" ON "ClientCreatorStat"("savePercentile");

ALTER TABLE "ClientCreatorStat"
  ADD CONSTRAINT "ClientCreatorStat_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "ClientProfile"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- A percentile is a rank, not a score: constrain it at the database rather than
-- trusting every future writer to clamp. Same for the counters, which are sums
-- of non-negative quantities and can never legitimately go below zero.
ALTER TABLE "ClientCreatorStat"
  ADD CONSTRAINT "ClientCreatorStat_savePercentile_range"
  CHECK ("savePercentile" IS NULL OR ("savePercentile" >= 0 AND "savePercentile" <= 100));

ALTER TABLE "ClientCreatorStat"
  ADD CONSTRAINT "ClientCreatorStat_counts_non_negative"
  CHECK ("totalSaves" >= 0 AND "totalRecreations" >= 0 AND "publicLookCount" >= 0);

-- 🔴 Every table in this database carries RLS; a new one that omits it is
-- readable by any role the app's connection can assume. No policy is added:
-- all access goes through the app's own scoping (the Prisma service role
-- bypasses RLS), matching the sibling engagement tables.
ALTER TABLE "ClientCreatorStat" ENABLE ROW LEVEL SECURITY;
