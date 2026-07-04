-- View tracking (social-first plan B2):
--  - LookPost.viewCount   → denormalized, sampled view total (feed impressions
--                           + detail opens), written only via the job below.
--  - APPLY_LOOK_VIEWS      → LooksSocialJob type that applies batched view-count
--                           increments flushed from the client.
--
-- Additive enum value + additive column; safe on a live database. The new enum
-- value is not used within this migration, so it is safe alongside the ALTER
-- TABLE in a single transaction.
ALTER TYPE "LooksSocialJobType" ADD VALUE IF NOT EXISTS 'APPLY_LOOK_VIEWS';

ALTER TABLE "LookPost" ADD COLUMN "viewCount" INTEGER NOT NULL DEFAULT 0;
