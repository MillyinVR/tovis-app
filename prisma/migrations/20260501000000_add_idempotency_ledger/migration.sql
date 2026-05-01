-- Durable idempotency ledger for replay-safe dangerous writes.
-- This is separate from Booking.creationIdempotencyKey, which only dedupes booking creation.
-- Ledger scope: one actor + one route + one idempotency key = one replayable response.

CREATE TYPE "IdempotencyStatus" AS ENUM ('STARTED', 'COMPLETED', 'FAILED');

CREATE TABLE "IdempotencyKey" (
  "id" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "actorRole" "Role" NOT NULL,
  "route" VARCHAR(191) NOT NULL,
  "key" VARCHAR(191) NOT NULL,
  "requestHash" VARCHAR(128) NOT NULL,
  "responseStatus" INTEGER,
  "responseBodyJson" JSONB,
  "status" "IdempotencyStatus" NOT NULL DEFAULT 'STARTED',
  "lockedUntil" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),

  CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IdempotencyKey_actorUserId_route_key_key"
  ON "IdempotencyKey"("actorUserId", "route", "key");

CREATE INDEX "IdempotencyKey_status_lockedUntil_idx"
  ON "IdempotencyKey"("status", "lockedUntil");

CREATE INDEX "IdempotencyKey_actorUserId_createdAt_idx"
  ON "IdempotencyKey"("actorUserId", "createdAt");

ALTER TABLE "IdempotencyKey"
  ADD CONSTRAINT "IdempotencyKey_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
