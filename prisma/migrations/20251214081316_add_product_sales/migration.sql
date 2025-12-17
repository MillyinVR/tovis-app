-- CreateTable
CREATE TABLE "ProductSale" (
    "id" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "bookingId" TEXT,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductSale_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductSale_professionalId_createdAt_idx" ON "ProductSale"("professionalId", "createdAt");

-- CreateIndex
CREATE INDEX "ProductSale_productId_createdAt_idx" ON "ProductSale"("productId", "createdAt");

-- AddForeignKey
ALTER TABLE "ProductSale" ADD CONSTRAINT "ProductSale_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "ProfessionalProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductSale" ADD CONSTRAINT "ProductSale_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductSale" ADD CONSTRAINT "ProductSale_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
