-- Engagement loop: client-as-creator foundation.
-- Purely additive (new nullable columns, one new table, indexes). No data
-- backfill, no drops, no NOT NULL on existing rows. See PR for design notes.

-- AlterTable
ALTER TABLE "ClientProfile" ADD COLUMN     "handle" TEXT,
ADD COLUMN     "handleNormalized" TEXT,
ADD COLUMN     "isPublicProfile" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "publicBio" TEXT;

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "sourceLookPostId" TEXT;

-- AlterTable
ALTER TABLE "LookPost" ADD COLUMN     "clientAuthorId" TEXT;

-- CreateTable
CREATE TABLE "ClientFollow" (
    "id" TEXT NOT NULL,
    "followerClientId" TEXT NOT NULL,
    "followedClientId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientFollow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClientFollow_followedClientId_createdAt_idx" ON "ClientFollow"("followedClientId", "createdAt");

-- CreateIndex
CREATE INDEX "ClientFollow_followerClientId_createdAt_idx" ON "ClientFollow"("followerClientId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ClientFollow_followerClientId_followedClientId_key" ON "ClientFollow"("followerClientId", "followedClientId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientProfile_handleNormalized_key" ON "ClientProfile"("handleNormalized");

-- CreateIndex
CREATE INDEX "ClientProfile_handleNormalized_idx" ON "ClientProfile"("handleNormalized");

-- CreateIndex
CREATE INDEX "Booking_sourceLookPostId_idx" ON "Booking"("sourceLookPostId");

-- CreateIndex
CREATE INDEX "LookPost_clientAuthorId_status_updatedAt_idx" ON "LookPost"("clientAuthorId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "LookPost_clientAuthorId_visibility_publishedAt_idx" ON "LookPost"("clientAuthorId", "visibility", "publishedAt");

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_sourceLookPostId_fkey" FOREIGN KEY ("sourceLookPostId") REFERENCES "LookPost"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LookPost" ADD CONSTRAINT "LookPost_clientAuthorId_fkey" FOREIGN KEY ("clientAuthorId") REFERENCES "ClientProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientFollow" ADD CONSTRAINT "ClientFollow_followerClientId_fkey" FOREIGN KEY ("followerClientId") REFERENCES "ClientProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientFollow" ADD CONSTRAINT "ClientFollow_followedClientId_fkey" FOREIGN KEY ("followedClientId") REFERENCES "ClientProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

