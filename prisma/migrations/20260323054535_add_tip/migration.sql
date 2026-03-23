-- CreateEnum
CREATE TYPE "BookingCheckoutStatus" AS ENUM ('NOT_READY', 'READY', 'PARTIALLY_PAID', 'PAID', 'WAIVED');

-- CreateEnum
CREATE TYPE "PaymentCollectionTiming" AS ENUM ('AT_BOOKING', 'AFTER_SERVICE');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'CARD_ON_FILE', 'TAP_TO_PAY', 'VENMO', 'ZELLE', 'APPLE_CASH');

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "checkoutStatus" "BookingCheckoutStatus" NOT NULL DEFAULT 'NOT_READY',
ADD COLUMN     "paymentAuthorizedAt" TIMESTAMP(3),
ADD COLUMN     "paymentCollectedAt" TIMESTAMP(3),
ADD COLUMN     "productSubtotalSnapshot" DECIMAL(10,2),
ADD COLUMN     "selectedPaymentMethod" "PaymentMethod",
ADD COLUMN     "serviceSubtotalSnapshot" DECIMAL(10,2);

-- CreateTable
CREATE TABLE "ProfessionalPaymentSettings" (
    "id" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "collectPaymentAt" "PaymentCollectionTiming" NOT NULL DEFAULT 'AFTER_SERVICE',
    "acceptCash" BOOLEAN NOT NULL DEFAULT true,
    "acceptCardOnFile" BOOLEAN NOT NULL DEFAULT false,
    "acceptTapToPay" BOOLEAN NOT NULL DEFAULT false,
    "acceptVenmo" BOOLEAN NOT NULL DEFAULT false,
    "acceptZelle" BOOLEAN NOT NULL DEFAULT false,
    "acceptAppleCash" BOOLEAN NOT NULL DEFAULT false,
    "tipsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "allowCustomTip" BOOLEAN NOT NULL DEFAULT true,
    "tipSuggestions" JSONB,
    "venmoHandle" TEXT,
    "zelleHandle" TEXT,
    "appleCashHandle" TEXT,
    "paymentNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProfessionalPaymentSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProfessionalPaymentSettings_professionalId_key" ON "ProfessionalPaymentSettings"("professionalId");

-- CreateIndex
CREATE INDEX "ProfessionalPaymentSettings_professionalId_idx" ON "ProfessionalPaymentSettings"("professionalId");

-- AddForeignKey
ALTER TABLE "ProfessionalPaymentSettings" ADD CONSTRAINT "ProfessionalPaymentSettings_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "ProfessionalProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
