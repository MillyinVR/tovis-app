-- AlterTable
ALTER TABLE "EmailVerificationToken" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "PhoneVerification" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "tosAcceptedAt" TIMESTAMP(3),
ADD COLUMN     "tosVersion" TEXT;
