-- Self-serve account deletion (App Store guideline 5.1.1(v)).
--
-- Adds the request row that holds the grace window. Additive only: one new
-- enum, one new table, no changes to existing columns or data.

-- CreateEnum
CREATE TYPE "AccountDeletionRequestStatus" AS ENUM ('PENDING', 'CANCELLED', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "AccountDeletionRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "AccountDeletionRequestStatus" NOT NULL DEFAULT 'PENDING',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "reason" VARCHAR(500),
    "resultJson" JSONB,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "lastFailureAt" TIMESTAMP(3),
    "lastFailureMessage" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountDeletionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccountDeletionRequest_status_scheduledFor_idx" ON "AccountDeletionRequest"("status", "scheduledFor");

-- CreateIndex
CREATE INDEX "AccountDeletionRequest_userId_status_idx" ON "AccountDeletionRequest"("userId", "status");

-- At most one OPEN deletion request per user, enforced in the database rather
-- than by a read-then-write in the route. Prisma cannot express a partial
-- unique index, so this is hand-written and must be preserved if the table is
-- ever regenerated.
CREATE UNIQUE INDEX "AccountDeletionRequest_userId_pending_key"
    ON "AccountDeletionRequest"("userId")
    WHERE "status" = 'PENDING';

-- AddForeignKey
ALTER TABLE "AccountDeletionRequest" ADD CONSTRAINT "AccountDeletionRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
