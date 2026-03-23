-- CreateTable
CREATE TABLE "BookingCheckoutProductItem" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "recommendationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BookingCheckoutProductItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BookingCheckoutProductItem_bookingId_idx" ON "BookingCheckoutProductItem"("bookingId");

-- CreateIndex
CREATE INDEX "BookingCheckoutProductItem_recommendationId_idx" ON "BookingCheckoutProductItem"("recommendationId");

-- CreateIndex
CREATE INDEX "BookingCheckoutProductItem_productId_idx" ON "BookingCheckoutProductItem"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "BookingCheckoutProductItem_bookingId_recommendationId_key" ON "BookingCheckoutProductItem"("bookingId", "recommendationId");

-- AddForeignKey
ALTER TABLE "BookingCheckoutProductItem" ADD CONSTRAINT "BookingCheckoutProductItem_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingCheckoutProductItem" ADD CONSTRAINT "BookingCheckoutProductItem_recommendationId_fkey" FOREIGN KEY ("recommendationId") REFERENCES "ProductRecommendation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingCheckoutProductItem" ADD CONSTRAINT "BookingCheckoutProductItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
