-- CreateTable
CREATE TABLE "LookTag" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "display" TEXT NOT NULL,
    "bannedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LookTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_LookPostTags" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_LookPostTags_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "LookTag_slug_key" ON "LookTag"("slug");

-- CreateIndex
CREATE INDEX "LookTag_bannedAt_idx" ON "LookTag"("bannedAt");

-- CreateIndex
CREATE INDEX "_LookPostTags_B_index" ON "_LookPostTags"("B");

-- AddForeignKey
ALTER TABLE "_LookPostTags" ADD CONSTRAINT "_LookPostTags_A_fkey" FOREIGN KEY ("A") REFERENCES "LookPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_LookPostTags" ADD CONSTRAINT "_LookPostTags_B_fkey" FOREIGN KEY ("B") REFERENCES "LookTag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

