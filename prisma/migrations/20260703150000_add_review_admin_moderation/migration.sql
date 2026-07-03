-- Admin soft-moderation for reviews (additive). A hidden review keeps its row
-- but is filtered out of review lists and rating aggregates; unhide clears all
-- three columns.
ALTER TABLE "Review" ADD COLUMN "hiddenAt" TIMESTAMP(3);
ALTER TABLE "Review" ADD COLUMN "hiddenByAdminUserId" TEXT;
ALTER TABLE "Review" ADD COLUMN "hiddenReason" TEXT;
