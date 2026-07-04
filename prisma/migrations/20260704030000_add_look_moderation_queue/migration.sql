-- Social-first AM1: Looks/UGC moderation queue.
-- Additive only. Rides the next `vercel --prod` alongside the four already-queued
-- arc migrations (20260703230000, 20260704000000, 20260704010000, 20260704020000).

-- Admin editorial curation: Feature/Unfeature a look into the Spotlight feed.
ALTER TABLE "LookPost" ADD COLUMN "featuredAt" TIMESTAMP(3);
ALTER TABLE "LookPost" ADD COLUMN "featuredByUserId" TEXT;
CREATE INDEX "LookPost_featuredAt_idx" ON "LookPost"("featuredAt");

-- Report resolution: reports previously had no lifecycle. resolvedAt lets a
-- SUPER_ADMIN dismiss a report without changing the look's moderation status,
-- and drives the queue's "Reported" (unresolved) view.
ALTER TABLE "LookPostReport" ADD COLUMN "resolvedAt" TIMESTAMP(3);
ALTER TABLE "LookPostReport" ADD COLUMN "resolvedByUserId" TEXT;
CREATE INDEX "LookPostReport_resolvedAt_createdAt_idx" ON "LookPostReport"("resolvedAt", "createdAt");

ALTER TABLE "LookCommentReport" ADD COLUMN "resolvedAt" TIMESTAMP(3);
ALTER TABLE "LookCommentReport" ADD COLUMN "resolvedByUserId" TEXT;
CREATE INDEX "LookCommentReport_resolvedAt_createdAt_idx" ON "LookCommentReport"("resolvedAt", "createdAt");
