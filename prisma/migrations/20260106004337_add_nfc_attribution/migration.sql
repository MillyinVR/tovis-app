-- CreateEnum
CREATE TYPE "NfcCardType" AS ENUM ('CLIENT_REFERRAL', 'PRO_BOOKING', 'SALON_WHITE_LABEL');

-- AlterEnum
ALTER TYPE "VerificationStatus" ADD VALUE 'NEEDS_INFO';

-- AlterTable
ALTER TABLE "ClientProfile" ADD COLUMN     "phoneVerifiedAt" TIMESTAMP(3),
ALTER COLUMN "firstName" SET DEFAULT '',
ALTER COLUMN "lastName" SET DEFAULT '';

-- CreateTable
CREATE TABLE "NfcCard" (
    "id" TEXT NOT NULL,
    "type" "NfcCardType" NOT NULL,
    "claimedAt" TIMESTAMP(3),
    "claimedByUserId" TEXT,
    "referralCount" INTEGER NOT NULL DEFAULT 0,
    "professionalId" TEXT,
    "salonSlug" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NfcCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TapIntent" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "userId" TEXT,
    "intentType" TEXT NOT NULL,
    "payloadJson" JSONB,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TapIntent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttributionEvent" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "eventType" TEXT NOT NULL,
    "cardId" TEXT,
    "actorUserId" TEXT,
    "creditedUserId" TEXT,
    "metaJson" JSONB,

    CONSTRAINT "AttributionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NfcCard_type_idx" ON "NfcCard"("type");

-- CreateIndex
CREATE INDEX "NfcCard_claimedByUserId_idx" ON "NfcCard"("claimedByUserId");

-- CreateIndex
CREATE INDEX "NfcCard_professionalId_idx" ON "NfcCard"("professionalId");

-- CreateIndex
CREATE INDEX "NfcCard_salonSlug_idx" ON "NfcCard"("salonSlug");

-- CreateIndex
CREATE INDEX "TapIntent_cardId_idx" ON "TapIntent"("cardId");

-- CreateIndex
CREATE INDEX "TapIntent_userId_idx" ON "TapIntent"("userId");

-- CreateIndex
CREATE INDEX "TapIntent_expiresAt_idx" ON "TapIntent"("expiresAt");

-- CreateIndex
CREATE INDEX "AttributionEvent_cardId_idx" ON "AttributionEvent"("cardId");

-- CreateIndex
CREATE INDEX "AttributionEvent_actorUserId_idx" ON "AttributionEvent"("actorUserId");

-- CreateIndex
CREATE INDEX "AttributionEvent_creditedUserId_idx" ON "AttributionEvent"("creditedUserId");

-- AddForeignKey
ALTER TABLE "NfcCard" ADD CONSTRAINT "NfcCard_claimedByUserId_fkey" FOREIGN KEY ("claimedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NfcCard" ADD CONSTRAINT "NfcCard_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "ProfessionalProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TapIntent" ADD CONSTRAINT "TapIntent_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "NfcCard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TapIntent" ADD CONSTRAINT "TapIntent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttributionEvent" ADD CONSTRAINT "AttributionEvent_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "NfcCard"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttributionEvent" ADD CONSTRAINT "AttributionEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttributionEvent" ADD CONSTRAINT "AttributionEvent_creditedUserId_fkey" FOREIGN KEY ("creditedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
