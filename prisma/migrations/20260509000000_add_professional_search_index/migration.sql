-- P2.4a: PostGIS extension + denormalized ProfessionalSearchIndex table.
--
-- This is the *foundation* slice for SEARCH-001. The new table is
-- maintained on every location/working-hours/offering mutation via
-- write hooks in lib/search/index/refreshSearchIndex.ts, but the
-- discovery routes (/api/search/pros, /api/pros/nearby) are NOT yet
-- swapped to read from it. P2.4b will perform that swap.
--
-- Until P2.4b lands, this table is dark-loaded — stale or missing
-- rows have no observable production effect because nothing reads
-- from it yet.
--
-- All `IF NOT EXISTS` / `IF EXISTS` guards make this re-runnable.
--
-- Post-launch follow-up: at high row counts, switch GIST index
-- creation to CREATE INDEX CONCURRENTLY in a separate non-tx step.

-- 1. PostGIS extension. Idempotent. Supabase has the extension
--    pre-bundled; this enables it for our database. The extension
--    itself is process-wide once enabled — safe to leave enabled.
CREATE EXTENSION IF NOT EXISTS postgis;

-- 2. Index table. The geography column is created in the same
--    statement as the rest so we never have a partial table state.
--    Prisma's typed client cannot read or write `geom` (it's declared
--    as Unsupported(...) in schema.prisma); all writes go through raw
--    SQL in refreshSearchIndex.ts.
CREATE TABLE IF NOT EXISTS "ProfessionalSearchIndex" (
  "locationId"         TEXT                             NOT NULL,
  "professionalId"     TEXT                             NOT NULL,
  "geom"               geography(Point, 4326)           NOT NULL,
  "lat"                DECIMAL(10, 7)                   NOT NULL,
  "lng"                DECIMAL(10, 7)                   NOT NULL,
  "verificationStatus" "VerificationStatus"             NOT NULL,
  "professionType"     "ProfessionType",
  "businessName"       TEXT,
  "handle"             TEXT,
  "handleNormalized"   TEXT,
  "avatarUrl"          TEXT,
  "mobileRadiusMiles"  INTEGER,
  "locationType"       "ProfessionalLocationType"       NOT NULL,
  "isPrimary"          BOOLEAN                          NOT NULL,
  "isBookable"         BOOLEAN                          NOT NULL,
  "city"               TEXT,
  "state"              TEXT,
  "formattedAddress"   TEXT,
  "timeZone"           TEXT,
  "workingHours"       JSONB                            NOT NULL,
  "categoryIds"        TEXT[]                           NOT NULL DEFAULT ARRAY[]::TEXT[],
  "serviceIds"         TEXT[]                           NOT NULL DEFAULT ARRAY[]::TEXT[],
  "offersInSalon"      BOOLEAN                          NOT NULL DEFAULT FALSE,
  "offersMobile"       BOOLEAN                          NOT NULL DEFAULT FALSE,
  "minSalonPrice"      DECIMAL(10, 2),
  "minMobilePrice"     DECIMAL(10, 2),
  "minAnyPrice"        DECIMAL(10, 2),
  "ratingAvg"          DOUBLE PRECISION,
  "ratingCount"        INTEGER                          NOT NULL DEFAULT 0,
  "refreshedAt"        TIMESTAMP(3)                     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "refreshSource"      TEXT,

  CONSTRAINT "ProfessionalSearchIndex_pkey" PRIMARY KEY ("locationId")
);

-- 3. Foreign keys with cascade delete so the index row dies with its
--    location or pro. Defensive even though refreshSearchIndex.ts
--    explicitly deletes index rows on mutation paths.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ProfessionalSearchIndex_professionalId_fkey'
  ) THEN
    ALTER TABLE "ProfessionalSearchIndex"
      ADD CONSTRAINT "ProfessionalSearchIndex_professionalId_fkey"
      FOREIGN KEY ("professionalId")
      REFERENCES "ProfessionalProfile"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ProfessionalSearchIndex_locationId_fkey'
  ) THEN
    ALTER TABLE "ProfessionalSearchIndex"
      ADD CONSTRAINT "ProfessionalSearchIndex_locationId_fkey"
      FOREIGN KEY ("locationId")
      REFERENCES "ProfessionalLocation"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

-- 4. GIST index on the geography column — primary index for radius
--    search via ST_DWithin. Without this every query falls back to
--    seqscan + per-row geo computation.
CREATE INDEX IF NOT EXISTS "ProfessionalSearchIndex_geom_gist_idx"
ON "ProfessionalSearchIndex" USING GIST ("geom");

-- 5. Composite BTREE for the standard pre-filter (verified +
--    bookable). Narrows the candidate set before the GIST index
--    evaluates the radius predicate, which matters at high pro counts
--    where the visible-pro fraction is small.
CREATE INDEX IF NOT EXISTS "ProfessionalSearchIndex_verification_bookable_idx"
ON "ProfessionalSearchIndex" ("verificationStatus", "isBookable");

-- 6. GIN indexes for the array filters used by the category/service
--    facets in P2.4b. `text[]` with GIN supports the
--    `categoryIds && ARRAY['cat1', 'cat2']` operator efficiently.
CREATE INDEX IF NOT EXISTS "ProfessionalSearchIndex_categoryIds_gin_idx"
ON "ProfessionalSearchIndex" USING GIN ("categoryIds");

CREATE INDEX IF NOT EXISTS "ProfessionalSearchIndex_serviceIds_gin_idx"
ON "ProfessionalSearchIndex" USING GIN ("serviceIds");

-- 7. BTREE on professionalId for the bulk-delete-by-pro path
--    (refreshProfessional first deletes all rows for a pro before
--    re-upserting current bookable locations).
CREATE INDEX IF NOT EXISTS "ProfessionalSearchIndex_professionalId_idx"
ON "ProfessionalSearchIndex" ("professionalId");
