-- CreateEnum
CREATE TYPE "ViralServiceRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "Review" ADD COLUMN     "helpfulCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ReviewHelpful" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewHelpful_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceFavorite" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceFavorite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ViralServiceRequest" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "status" "ViralServiceRequestStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ViralServiceRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReviewHelpful_reviewId_createdAt_idx" ON "ReviewHelpful"("reviewId", "createdAt");

-- CreateIndex
CREATE INDEX "ReviewHelpful_userId_createdAt_idx" ON "ReviewHelpful"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewHelpful_reviewId_userId_key" ON "ReviewHelpful"("reviewId", "userId");

-- CreateIndex
CREATE INDEX "ServiceFavorite_userId_createdAt_idx" ON "ServiceFavorite"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ServiceFavorite_serviceId_createdAt_idx" ON "ServiceFavorite"("serviceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceFavorite_serviceId_userId_key" ON "ServiceFavorite"("serviceId", "userId");

-- CreateIndex
CREATE INDEX "ViralServiceRequest_clientId_createdAt_idx" ON "ViralServiceRequest"("clientId", "createdAt");

-- CreateIndex
CREATE INDEX "ViralServiceRequest_status_createdAt_idx" ON "ViralServiceRequest"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "ReviewHelpful" ADD CONSTRAINT "ReviewHelpful_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewHelpful" ADD CONSTRAINT "ReviewHelpful_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceFavorite" ADD CONSTRAINT "ServiceFavorite_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceFavorite" ADD CONSTRAINT "ServiceFavorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ViralServiceRequest" ADD CONSTRAINT "ViralServiceRequest_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "ClientProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
