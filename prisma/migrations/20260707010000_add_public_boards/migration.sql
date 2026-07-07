-- Public/shareable boards (social-first D3).
-- Adds a URL-safe `slug` (unique per client, backfilled from `name`) so a SHARED
-- board can be addressed at /u/[handle]/boards/[slug], plus admin moderation
-- columns (`hiddenAt`/`hiddenByUserId`) that let a SUPER_ADMIN hide a public board.

ALTER TABLE "Board" ADD COLUMN "slug" TEXT;
ALTER TABLE "Board" ADD COLUMN "hiddenAt" TIMESTAMP(3);
ALTER TABLE "Board" ADD COLUMN "hiddenByUserId" TEXT;

-- Backfill slug from the (already client-unique) name. Two names can still
-- collapse to the same slug (e.g. "My Board" vs "My Board!"), so disambiguate
-- per client with a stable row_number suffix.
WITH slugged AS (
  SELECT
    "id",
    "clientId",
    COALESCE(
      NULLIF(
        trim(both '-' from regexp_replace(lower("name"), '[^a-z0-9]+', '-', 'g')),
        ''
      ),
      'board'
    ) AS base
  FROM "Board"
),
ranked AS (
  SELECT
    "id",
    "base",
    row_number() OVER (PARTITION BY "clientId", "base" ORDER BY "id") AS rn
  FROM slugged
)
UPDATE "Board" b
SET "slug" = CASE WHEN r.rn = 1 THEN r.base ELSE r.base || '-' || r.rn END
FROM ranked r
WHERE b."id" = r."id";

ALTER TABLE "Board" ALTER COLUMN "slug" SET NOT NULL;

CREATE UNIQUE INDEX "Board_clientId_slug_key" ON "Board"("clientId", "slug");
