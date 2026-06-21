-- Looks comment section: TikTok/Instagram-style likes + threaded replies.
-- Purely additive (new nullable column, two new counter columns with defaults,
-- one new table, indexes, FKs). No data backfill, no drops, no NOT NULL on
-- existing rows. Threading is flattened to one level — a reply's parent is
-- always a top-level comment (enforced in app code).

-- AlterTable
ALTER TABLE "LookComment" ADD COLUMN     "parentCommentId" TEXT,
ADD COLUMN     "likeCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "replyCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "LookCommentLike" (
    "id" TEXT NOT NULL,
    "lookCommentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LookCommentLike_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LookComment_lookPostId_parentCommentId_createdAt_idx" ON "LookComment"("lookPostId", "parentCommentId", "createdAt");

-- CreateIndex
CREATE INDEX "LookComment_parentCommentId_createdAt_idx" ON "LookComment"("parentCommentId", "createdAt");

-- CreateIndex
CREATE INDEX "LookCommentLike_lookCommentId_createdAt_idx" ON "LookCommentLike"("lookCommentId", "createdAt");

-- CreateIndex
CREATE INDEX "LookCommentLike_userId_createdAt_idx" ON "LookCommentLike"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LookCommentLike_lookCommentId_userId_key" ON "LookCommentLike"("lookCommentId", "userId");

-- AddForeignKey
ALTER TABLE "LookComment" ADD CONSTRAINT "LookComment_parentCommentId_fkey" FOREIGN KEY ("parentCommentId") REFERENCES "LookComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LookCommentLike" ADD CONSTRAINT "LookCommentLike_lookCommentId_fkey" FOREIGN KEY ("lookCommentId") REFERENCES "LookComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LookCommentLike" ADD CONSTRAINT "LookCommentLike_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
