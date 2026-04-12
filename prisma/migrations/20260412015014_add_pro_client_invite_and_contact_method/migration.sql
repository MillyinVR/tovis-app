/*
  Warnings:

  - You are about to alter the column `phone` on the `ClientProfile` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(32)`.
  - You are about to alter the column `email` on the `User` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(320)`.
  - A unique constraint covering the columns `[email]` on the table `ClientProfile` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[phone]` on the table `ClientProfile` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "ClientClaimStatus" AS ENUM ('UNCLAIMED', 'CLAIMED');

-- DropForeignKey
ALTER TABLE "ClientProfile" DROP CONSTRAINT "ClientProfile_userId_fkey";

-- AlterTable
ALTER TABLE "ClientProfile" ADD COLUMN     "claimStatus" "ClientClaimStatus" NOT NULL DEFAULT 'UNCLAIMED',
ADD COLUMN     "claimedAt" TIMESTAMP(3),
ADD COLUMN     "email" VARCHAR(320),
ALTER COLUMN "userId" DROP NOT NULL,
ALTER COLUMN "phone" SET DATA TYPE VARCHAR(32);

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "email" DROP NOT NULL,
ALTER COLUMN "email" SET DATA TYPE VARCHAR(320);

-- CreateIndex
CREATE UNIQUE INDEX "ClientProfile_email_key" ON "ClientProfile"("email");

-- CreateIndex
CREATE UNIQUE INDEX "ClientProfile_phone_key" ON "ClientProfile"("phone");

-- CreateIndex
CREATE INDEX "ClientProfile_claimStatus_idx" ON "ClientProfile"("claimStatus");

-- AddForeignKey
ALTER TABLE "ClientProfile" ADD CONSTRAINT "ClientProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
