/*
  Warnings:

  - You are about to drop the column `baseDurationMinutes` on the `Service` table. All the data in the column will be lost.
  - You are about to drop the column `basePrice` on the `Service` table. All the data in the column will be lost.
  - You are about to drop the column `category` on the `Service` table. All the data in the column will be lost.
  - Added the required column `categoryId` to the `Service` table without a default value. This is not possible if the table is not empty.
  - Added the required column `defaultDurationMinutes` to the `Service` table without a default value. This is not possible if the table is not empty.
  - Added the required column `minPrice` to the `Service` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "ProfessionalServiceOffering" ADD COLUMN     "customImageUrl" TEXT;

-- AlterTable
ALTER TABLE "Service" DROP COLUMN "baseDurationMinutes",
DROP COLUMN "basePrice",
DROP COLUMN "category",
ADD COLUMN     "allowMobile" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "categoryId" TEXT NOT NULL,
ADD COLUMN     "defaultDurationMinutes" INTEGER NOT NULL,
ADD COLUMN     "defaultImageUrl" TEXT,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "minPrice" INTEGER NOT NULL;

-- CreateTable
CREATE TABLE "ServiceCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "parentId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ServiceCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServicePermission" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "professionType" "ProfessionType" NOT NULL,
    "stateCode" TEXT,

    CONSTRAINT "ServicePermission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ServiceCategory_slug_key" ON "ServiceCategory"("slug");

-- CreateIndex
CREATE INDEX "ServicePermission_professionType_stateCode_idx" ON "ServicePermission"("professionType", "stateCode");

-- AddForeignKey
ALTER TABLE "ServiceCategory" ADD CONSTRAINT "ServiceCategory_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ServiceCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Service" ADD CONSTRAINT "Service_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ServiceCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServicePermission" ADD CONSTRAINT "ServicePermission_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
