/*
  Warnings:

  - The values [EXPIRED] on the enum `ProClientInviteStatus` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `expiresAt` on the `ProClientInvite` table. All the data in the column will be lost.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "ProClientInviteStatus_new" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED');

ALTER TABLE "public"."ProClientInvite" ALTER COLUMN "status" DROP DEFAULT;

UPDATE "ProClientInvite"
SET "status" = 'PENDING'
WHERE "status" = 'EXPIRED';

ALTER TABLE "ProClientInvite"
ALTER COLUMN "status" TYPE "ProClientInviteStatus_new"
USING ("status"::text::"ProClientInviteStatus_new");

ALTER TYPE "ProClientInviteStatus" RENAME TO "ProClientInviteStatus_old";
ALTER TYPE "ProClientInviteStatus_new" RENAME TO "ProClientInviteStatus";
DROP TYPE "public"."ProClientInviteStatus_old";

ALTER TABLE "ProClientInvite" ALTER COLUMN "status" SET DEFAULT 'PENDING';
COMMIT;

-- DropIndex
DROP INDEX "ProClientInvite_status_expiresAt_idx";

-- AlterTable
ALTER TABLE "ProClientInvite" DROP COLUMN "expiresAt",
ADD COLUMN     "revokeReason" TEXT,
ADD COLUMN     "revokedAt" TIMESTAMP(3),
ADD COLUMN     "revokedByUserId" TEXT;

-- CreateIndex
CREATE INDEX "ProClientInvite_status_createdAt_idx" ON "ProClientInvite"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ProClientInvite_acceptedByUserId_idx" ON "ProClientInvite"("acceptedByUserId");

-- CreateIndex
CREATE INDEX "ProClientInvite_revokedByUserId_idx" ON "ProClientInvite"("revokedByUserId");

-- AddForeignKey
ALTER TABLE "ProClientInvite" ADD CONSTRAINT "ProClientInvite_acceptedByUserId_fkey" FOREIGN KEY ("acceptedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProClientInvite" ADD CONSTRAINT "ProClientInvite_revokedByUserId_fkey" FOREIGN KEY ("revokedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
