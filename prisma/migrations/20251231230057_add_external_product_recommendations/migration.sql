-- DropForeignKey
ALTER TABLE "ProductRecommendation" DROP CONSTRAINT "ProductRecommendation_productId_fkey";

-- AlterTable
ALTER TABLE "ProductRecommendation" ADD COLUMN     "externalName" TEXT,
ADD COLUMN     "externalUrl" TEXT,
ALTER COLUMN "productId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "ProductRecommendation_aftercareSummaryId_idx" ON "ProductRecommendation"("aftercareSummaryId");

-- CreateIndex
CREATE INDEX "ProductRecommendation_productId_idx" ON "ProductRecommendation"("productId");

-- AddForeignKey
ALTER TABLE "ProductRecommendation" ADD CONSTRAINT "ProductRecommendation_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
