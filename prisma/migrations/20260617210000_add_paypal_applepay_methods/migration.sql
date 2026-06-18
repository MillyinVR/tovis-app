-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PaymentMethod" ADD VALUE 'PAYPAL';
ALTER TYPE "PaymentMethod" ADD VALUE 'APPLE_PAY';

-- AlterTable
ALTER TABLE "ProfessionalPaymentSettings" ADD COLUMN     "acceptApplePay" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "acceptPaypal" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "paypalHandle" TEXT;

