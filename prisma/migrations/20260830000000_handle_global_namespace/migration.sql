-- One global namespace for public `@handle`s.
--
-- THE BUG
-- -------
-- "ProfessionalProfile"."handleNormalized" and "ClientProfile"."handleNormalized"
-- each carry their own UNIQUE index. That makes a handle unique WITHIN a table
-- and says nothing across them, so the same handle could be held by a pro AND a
-- client simultaneously. Neither write path (pro profile PATCH, client profile
-- PATCH, pro signup) ever consulted the other table — each relied entirely on
-- its own index.
--
-- This is not cosmetic. app/(main)/looks/_components/LookOverlays.tsx renders
--   posterName = clientAuthor ? `@${clientAuthor.handle}` : proDisplayName
-- so a client-authored look and a pro-authored look appear in ONE feed as the
-- same `@handle`, with no marker distinguishing them. A client could claim a
-- well-known pro's handle and post under their identity.
--
-- Postgres cannot express a UNIQUE spanning two tables. This registry IS the
-- constraint: "handleNormalized" is the PRIMARY KEY, so the database refuses the
-- second claim whichever table it comes from. The per-table columns stay as the
-- display/lookup source of truth; this table is purely the lock.

CREATE TABLE "HandleRegistration" (
  "handleNormalized" VARCHAR(24) NOT NULL,
  "professionalId"   TEXT,
  "clientProfileId"  TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,

  CONSTRAINT "HandleRegistration_pkey" PRIMARY KEY ("handleNormalized")
);

-- One handle per owner, from either side.
CREATE UNIQUE INDEX "HandleRegistration_professionalId_key"
  ON "HandleRegistration" ("professionalId");

CREATE UNIQUE INDEX "HandleRegistration_clientProfileId_key"
  ON "HandleRegistration" ("clientProfileId");

-- Exactly one owner. A row owned by nobody would squat a handle with no way to
-- reach or release it; a row owned by both would make "whose handle is this?"
-- ambiguous on an identity surface.
ALTER TABLE "HandleRegistration"
  ADD CONSTRAINT "HandleRegistration_one_owner_check"
  CHECK (num_nonnulls("professionalId", "clientProfileId") = 1);

-- CASCADE on both sides: a deleted profile must never leave its handle locked
-- forever, and this table must never be the thing that blocks deleting a user.
ALTER TABLE "HandleRegistration"
  ADD CONSTRAINT "HandleRegistration_professionalId_fkey"
  FOREIGN KEY ("professionalId") REFERENCES "ProfessionalProfile" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "HandleRegistration"
  ADD CONSTRAINT "HandleRegistration_clientProfileId_fkey"
  FOREIGN KEY ("clientProfileId") REFERENCES "ClientProfile" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Backfill ────────────────────────────────────────────────────────────────
--
-- 🔴🔴 THIS MIGRATION RENAMES COLLIDING CLIENT HANDLES.
--
-- Pros are inserted FIRST and win every collision, because the vanity subdomain
-- `{handle}.tovis.me` rewrites to `/p/{handle}` (proxy.ts) — pro-only. A pro's
-- handle backs a live public link; a client's does not, so taking it from the
-- pro would break a working URL while the reverse does not.
--
-- A client holding a colliding handle is RENAMED, not cleared: clearing it
-- would strand an `isPublicProfile = true` profile with no reachable `/u/...`
-- URL, which is a worse outcome than a changed name. The new handle is the old
-- one plus a numeric suffix, first free value wins.
--
-- ⚠️ AT THE TIME OF WRITING, PRODUCTION HAS EXACTLY ONE COLLISION:
--      handle `tori` — held by BOTH the founder's ProfessionalProfile
--      (amara619@gmail.com) and a ClientProfile (amara619+client1@gmail.com).
--    When this runs in production the CLIENT copy becomes `tori2`. The pro keeps
--    `tori`. If that is the wrong call, rename the client handle by hand BEFORE
--    this deploys and the block below will find nothing to do.
--
-- Rows whose handle is not a valid current-format handle (too long for the
-- VARCHAR(24), etc.) are skipped rather than truncated: silently rewriting an
-- identity is worse than leaving it unregistered, and the format rules already
-- reject those on the next save.

INSERT INTO "HandleRegistration" ("handleNormalized", "professionalId", "updatedAt")
SELECT "handleNormalized", "id", CURRENT_TIMESTAMP
FROM "ProfessionalProfile"
WHERE "handleNormalized" IS NOT NULL
  AND length("handleNormalized") <= 24
ON CONFLICT DO NOTHING;

-- Clients whose handle is still free.
INSERT INTO "HandleRegistration" ("handleNormalized", "clientProfileId", "updatedAt")
SELECT "handleNormalized", "id", CURRENT_TIMESTAMP
FROM "ClientProfile"
WHERE "handleNormalized" IS NOT NULL
  AND length("handleNormalized") <= 24
ON CONFLICT DO NOTHING;

-- Clients left unregistered are exactly the collisions. Rename each to the
-- first free `{handle}{n}` and register that instead.
DO $$
DECLARE
  loser   RECORD;
  suffix  INT;
  attempt TEXT;
BEGIN
  FOR loser IN
    SELECT c."id", c."handleNormalized"
    FROM "ClientProfile" c
    LEFT JOIN "HandleRegistration" r ON r."clientProfileId" = c."id"
    WHERE c."handleNormalized" IS NOT NULL
      AND length(c."handleNormalized") <= 24
      AND r."handleNormalized" IS NULL
  LOOP
    suffix := 2;
    LOOP
      attempt := left(loser."handleNormalized", 24 - length(suffix::TEXT)) || suffix::TEXT;
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM "HandleRegistration" WHERE "handleNormalized" = attempt
      );
      suffix := suffix + 1;
    END LOOP;

    UPDATE "ClientProfile"
    SET "handle" = attempt, "handleNormalized" = attempt
    WHERE "id" = loser."id";

    INSERT INTO "HandleRegistration" ("handleNormalized", "clientProfileId", "updatedAt")
    VALUES (attempt, loser."id", CURRENT_TIMESTAMP);

    RAISE NOTICE 'handle collision: ClientProfile % renamed % -> %',
      loser."id", loser."handleNormalized", attempt;
  END LOOP;
END $$;
