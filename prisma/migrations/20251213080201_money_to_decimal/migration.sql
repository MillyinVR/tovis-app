/*
  Warnings:

  - You are about to drop the column `consultationPriceCents` on the `Booking` table. All the data in the column will be lost.
  - You are about to alter the column `priceSnapshot` on the `Booking` table. The data in that column could be lost. The data in that column will be cast from `Integer` to `Decimal(10,2)`.
  - You are about to alter the column `retailPrice` on the `Product` table. The data in that column could be lost. The data in that column will be cast from `Integer` to `Decimal(10,2)`.
  - You are about to alter the column `wholesalePrice` on the `Product` table. The data in that column could be lost. The data in that column will be cast from `Integer` to `Decimal(10,2)`.
  - You are about to alter the column `price` on the `ProfessionalServiceOffering` table. The data in that column could be lost. The data in that column will be cast from `Integer` to `Decimal(10,2)`.
  - You are about to alter the column `minPrice` on the `Service` table. The data in that column could be lost. The data in that column will be cast from `Integer` to `Decimal(10,2)`.

*/
-- AlterTable
ALTER TABLE "Booking" DROP COLUMN "consultationPriceCents",
ADD COLUMN     "consultationPrice" DECIMAL(10,2),
ALTER COLUMN "priceSnapshot" SET DATA TYPE DECIMAL(10,2);

-- AlterTable
ALTER TABLE "Product" ALTER COLUMN "retailPrice" SET DATA TYPE DECIMAL(10,2),
ALTER COLUMN "wholesalePrice" SET DATA TYPE DECIMAL(10,2);

-- AlterTable
ALTER TABLE "ProfessionalServiceOffering" ALTER COLUMN "price" SET DATA TYPE DECIMAL(10,2);

-- AlterTable
ALTER TABLE "Service" ALTER COLUMN "minPrice" SET DATA TYPE DECIMAL(10,2);
