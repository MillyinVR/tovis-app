-- CreateEnum
CREATE TYPE "LooksSocialJobType" AS ENUM ('RECOMPUTE_LOOK_COUNTS', 'RECOMPUTE_LOOK_SPOTLIGHT_SCORE', 'RECOMPUTE_LOOK_RANK_SCORE', 'FAN_OUT_VIRAL_REQUEST_APPROVAL_NOTIFICATIONS', 'INDEX_LOOK_POST_DOCUMENT', 'MODERATION_SCAN_LOOK_POST', 'MODERATION_SCAN_COMMENT');

-- CreateEnum
CREATE TYPE "LooksSocialJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "LooksSocialJob" (
    "id" TEXT NOT NULL,
    "type" "LooksSocialJobType" NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "LooksSocialJobStatus" NOT NULL DEFAULT 'PENDING',
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LooksSocialJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LooksSocialJob_dedupeKey_key" ON "LooksSocialJob"("dedupeKey");

-- CreateIndex
CREATE INDEX "LooksSocialJob_status_runAt_createdAt_id_idx" ON "LooksSocialJob"("status", "runAt", "createdAt", "id");

-- CreateIndex
CREATE INDEX "LooksSocialJob_type_status_runAt_idx" ON "LooksSocialJob"("type", "status", "runAt");
