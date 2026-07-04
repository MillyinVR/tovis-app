-- Social-first C2: milestone nudges + unlock client looks.
-- Additive only. Rides the next `vercel --prod` alongside the already-queued
-- arc migrations (…230000, …000000, …010000, B2's …020000, AM1's …030000).

-- Milestone nudge event key ("Your look hit N likes / N saves" → look author).
-- Additive enum value; not used within this migration, so it is safe alongside
-- the ALTER TABLE below in a single transaction (PG 12+).
ALTER TYPE "NotificationEventKey" ADD VALUE IF NOT EXISTS 'LOOK_MILESTONE_REACHED';

-- Per-look client-discovery gate. Default false: a client-authored look only
-- enters the public feed once the client opts it in (independent of profile).
-- Pro-authored looks are admitted via `clientAuthorId IS NULL` and ignore this.
ALTER TABLE "LookPost" ADD COLUMN "publicToFeed" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: preserve current feed behavior for existing client-authored looks
-- that were already eligible under the old profile-level gate (public profile +
-- PUBLIC visibility). Without this they would silently drop out of the feed when
-- the OR clause switches from `clientAuthor.isPublicProfile` to `publicToFeed`.
UPDATE "LookPost" lp
SET "publicToFeed" = true
FROM "ClientProfile" cp
WHERE lp."clientAuthorId" = cp."id"
  AND cp."isPublicProfile" = true
  AND lp."visibility" = 'PUBLIC';
