-- CreateTable
CREATE TABLE "LookPostReport" (
    "id" TEXT NOT NULL,
    "lookPostId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LookPostReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LookCommentReport" (
    "id" TEXT NOT NULL,
    "lookCommentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LookCommentReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LookPostReport_lookPostId_createdAt_idx" ON "LookPostReport"("lookPostId", "createdAt");

-- CreateIndex
CREATE INDEX "LookPostReport_userId_createdAt_idx" ON "LookPostReport"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "LookPostReport_createdAt_idx" ON "LookPostReport"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LookPostReport_lookPostId_userId_key" ON "LookPostReport"("lookPostId", "userId");

-- CreateIndex
CREATE INDEX "LookCommentReport_lookCommentId_createdAt_idx" ON "LookCommentReport"("lookCommentId", "createdAt");

-- CreateIndex
CREATE INDEX "LookCommentReport_userId_createdAt_idx" ON "LookCommentReport"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "LookCommentReport_createdAt_idx" ON "LookCommentReport"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LookCommentReport_lookCommentId_userId_key" ON "LookCommentReport"("lookCommentId", "userId");

-- AddForeignKey
ALTER TABLE "LookPostReport" ADD CONSTRAINT "LookPostReport_lookPostId_fkey" FOREIGN KEY ("lookPostId") REFERENCES "LookPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LookPostReport" ADD CONSTRAINT "LookPostReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LookCommentReport" ADD CONSTRAINT "LookCommentReport_lookCommentId_fkey" FOREIGN KEY ("lookCommentId") REFERENCES "LookComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LookCommentReport" ADD CONSTRAINT "LookCommentReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
