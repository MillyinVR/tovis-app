-- CreateEnum
CREATE TYPE "ReminderType" AS ENUM ('GENERAL', 'AFTERCARE', 'REBOOK', 'PRODUCT_FOLLOWUP', 'LICENSE');

-- CreateTable
CREATE TABLE "Reminder" (
    "id" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "clientId" TEXT,
    "bookingId" TEXT,
    "type" "ReminderType" NOT NULL DEFAULT 'GENERAL',
    "title" TEXT NOT NULL,
    "body" TEXT,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Reminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Reminder_professionalId_dueAt_idx" ON "Reminder"("professionalId", "dueAt");

-- CreateIndex
CREATE INDEX "Reminder_clientId_dueAt_idx" ON "Reminder"("clientId", "dueAt");

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "ProfessionalProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "ClientProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;
