-- Board creation-context signals (personalization spec §7–8).
-- `type` = what the board is for (drives the creation question set + the
-- For You occasion boost); `eventDate` = the calendar date the board counts
-- down to (bridal/prom — plain DATE, no time-of-day/timezone semantics);
-- `answers` = the skippable creation-question chip answers, validated against
-- lib/boards/context.ts. All backfill-free: existing boards are GENERAL with
-- no event date and no answers.

CREATE TYPE "BoardType" AS ENUM ('GENERAL', 'BRIDAL', 'PROM', 'SKINCARE', 'PERMANENT_MAKEUP', 'COLOR_TRANSFORMATION', 'NAILS');

ALTER TABLE "Board" ADD COLUMN "type" "BoardType" NOT NULL DEFAULT 'GENERAL';
ALTER TABLE "Board" ADD COLUMN "eventDate" DATE;
ALTER TABLE "Board" ADD COLUMN "answers" JSONB;
