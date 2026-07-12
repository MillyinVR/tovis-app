-- Per-viewer explicit "not for me" hide (spec §2.2). Additive: a new table only,
-- shaped like LookLike (per-user, unique per look). No changes to existing
-- tables, so it applies cleanly on the next `vercel --prod` migrate-deploy.

-- CreateTable
CREATE TABLE "LookHide" (
    "id" TEXT NOT NULL,
    "lookPostId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LookHide_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LookHide_lookPostId_createdAt_idx" ON "LookHide"("lookPostId", "createdAt");

-- CreateIndex
CREATE INDEX "LookHide_userId_createdAt_idx" ON "LookHide"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LookHide_lookPostId_userId_key" ON "LookHide"("lookPostId", "userId");

-- AddForeignKey
ALTER TABLE "LookHide" ADD CONSTRAINT "LookHide_lookPostId_fkey" FOREIGN KEY ("lookPostId") REFERENCES "LookPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LookHide" ADD CONSTRAINT "LookHide_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
