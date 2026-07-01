-- Pro Finance tab: tracked business expenses (income is derived from bookings,
-- so only expenses need their own table). Additive — no existing data touched.

-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('SUPPLIES_PRODUCTS', 'TOOLS_EQUIPMENT', 'BOOTH_SUITE_RENT', 'SOFTWARE_APPS', 'EDUCATION_TRAINING', 'LICENSING_INSURANCE', 'MARKETING', 'MILEAGE', 'HOME_OFFICE', 'CLOTHING_APPEARANCE', 'OTHER');

-- CreateEnum
CREATE TYPE "ExpenseSource" AS ENUM ('MANUAL', 'RECEIPT_UPLOAD', 'COSMOPROF', 'SALON_CENTRIC');

-- CreateTable
CREATE TABLE "ProfessionalExpense" (
    "id" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "category" "ExpenseCategory" NOT NULL,
    "source" "ExpenseSource" NOT NULL DEFAULT 'MANUAL',
    "amountCents" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "notes" TEXT,
    "spentAt" TIMESTAMP(3) NOT NULL,
    "monthKey" VARCHAR(7) NOT NULL,
    "receiptMediaId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProfessionalExpense_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProfessionalExpense_professionalId_monthKey_spentAt_idx" ON "ProfessionalExpense"("professionalId", "monthKey", "spentAt");

-- CreateIndex
CREATE INDEX "ProfessionalExpense_professionalId_category_monthKey_idx" ON "ProfessionalExpense"("professionalId", "category", "monthKey");

-- CreateIndex
CREATE INDEX "ProfessionalExpense_receiptMediaId_idx" ON "ProfessionalExpense"("receiptMediaId");

-- AddForeignKey
ALTER TABLE "ProfessionalExpense" ADD CONSTRAINT "ProfessionalExpense_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "ProfessionalProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalExpense" ADD CONSTRAINT "ProfessionalExpense_receiptMediaId_fkey" FOREIGN KEY ("receiptMediaId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
