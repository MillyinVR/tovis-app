-- CreateTable
CREATE TABLE "ProfessionalMonthlyAnalytics" (
    "id" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "monthKey" VARCHAR(7) NOT NULL,
    "timeZone" VARCHAR(64) NOT NULL,
    "periodStartUtc" TIMESTAMP(3) NOT NULL,
    "periodEndUtc" TIMESTAMP(3) NOT NULL,
    "serviceRevenueCents" INTEGER NOT NULL DEFAULT 0,
    "productRevenueCents" INTEGER NOT NULL DEFAULT 0,
    "revenueTotalCents" INTEGER NOT NULL DEFAULT 0,
    "tipCents" INTEGER NOT NULL DEFAULT 0,
    "completedBookingCount" INTEGER NOT NULL DEFAULT 0,
    "uniqueClientCount" INTEGER NOT NULL DEFAULT 0,
    "newClientCount" INTEGER NOT NULL DEFAULT 0,
    "repeatClientCount" INTEGER NOT NULL DEFAULT 0,
    "futureRebookedClientCount" INTEGER NOT NULL DEFAULT 0,
    "noFutureRebookClientCount" INTEGER NOT NULL DEFAULT 0,
    "requestedNewBookingCount" INTEGER NOT NULL DEFAULT 0,
    "requestedRepeatBookingCount" INTEGER NOT NULL DEFAULT 0,
    "discoveryNewBookingCount" INTEGER NOT NULL DEFAULT 0,
    "discoveryRepeatBookingCount" INTEGER NOT NULL DEFAULT 0,
    "aftercareBookingCount" INTEGER NOT NULL DEFAULT 0,
    "reviewCount" INTEGER NOT NULL DEFAULT 0,
    "ratingSum" INTEGER NOT NULL DEFAULT 0,
    "averageRating" DECIMAL(3,2),
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProfessionalMonthlyAnalytics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfessionalMonthlyServiceAnalytics" (
    "id" TEXT NOT NULL,
    "analyticsId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "serviceNameSnapshot" TEXT NOT NULL,
    "bookingCount" INTEGER NOT NULL DEFAULT 0,
    "revenueCents" INTEGER NOT NULL DEFAULT 0,
    "rank" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProfessionalMonthlyServiceAnalytics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfessionalMonthlyProductAnalytics" (
    "id" TEXT NOT NULL,
    "analyticsId" TEXT NOT NULL,
    "productId" TEXT,
    "productNameSnapshot" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "revenueCents" INTEGER NOT NULL DEFAULT 0,
    "rank" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProfessionalMonthlyProductAnalytics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProfessionalMonthlyAnalytics_professionalId_periodStartUtc_idx" ON "ProfessionalMonthlyAnalytics"("professionalId", "periodStartUtc");

-- CreateIndex
CREATE INDEX "ProfessionalMonthlyAnalytics_monthKey_idx" ON "ProfessionalMonthlyAnalytics"("monthKey");

-- CreateIndex
CREATE INDEX "ProfessionalMonthlyAnalytics_computedAt_idx" ON "ProfessionalMonthlyAnalytics"("computedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProfessionalMonthlyAnalytics_professionalId_monthKey_key" ON "ProfessionalMonthlyAnalytics"("professionalId", "monthKey");

-- CreateIndex
CREATE INDEX "ProfessionalMonthlyServiceAnalytics_analyticsId_rank_idx" ON "ProfessionalMonthlyServiceAnalytics"("analyticsId", "rank");

-- CreateIndex
CREATE INDEX "ProfessionalMonthlyServiceAnalytics_serviceId_idx" ON "ProfessionalMonthlyServiceAnalytics"("serviceId");

-- CreateIndex
CREATE UNIQUE INDEX "ProfessionalMonthlyServiceAnalytics_analyticsId_serviceId_key" ON "ProfessionalMonthlyServiceAnalytics"("analyticsId", "serviceId");

-- CreateIndex
CREATE INDEX "ProfessionalMonthlyProductAnalytics_analyticsId_rank_idx" ON "ProfessionalMonthlyProductAnalytics"("analyticsId", "rank");

-- CreateIndex
CREATE INDEX "ProfessionalMonthlyProductAnalytics_productId_idx" ON "ProfessionalMonthlyProductAnalytics"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "ProfessionalMonthlyProductAnalytics_analyticsId_productId_key" ON "ProfessionalMonthlyProductAnalytics"("analyticsId", "productId");

-- AddForeignKey
ALTER TABLE "ProfessionalMonthlyAnalytics" ADD CONSTRAINT "ProfessionalMonthlyAnalytics_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "ProfessionalProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalMonthlyServiceAnalytics" ADD CONSTRAINT "ProfessionalMonthlyServiceAnalytics_analyticsId_fkey" FOREIGN KEY ("analyticsId") REFERENCES "ProfessionalMonthlyAnalytics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalMonthlyServiceAnalytics" ADD CONSTRAINT "ProfessionalMonthlyServiceAnalytics_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalMonthlyProductAnalytics" ADD CONSTRAINT "ProfessionalMonthlyProductAnalytics_analyticsId_fkey" FOREIGN KEY ("analyticsId") REFERENCES "ProfessionalMonthlyAnalytics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalMonthlyProductAnalytics" ADD CONSTRAINT "ProfessionalMonthlyProductAnalytics_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
