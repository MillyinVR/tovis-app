-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "depositAmount" DECIMAL(10,2),
ADD COLUMN     "discountAmount" DECIMAL(10,2),
ADD COLUMN     "taxAmount" DECIMAL(10,2),
ADD COLUMN     "tipAmount" DECIMAL(10,2),
ADD COLUMN     "totalAmount" DECIMAL(10,2);
