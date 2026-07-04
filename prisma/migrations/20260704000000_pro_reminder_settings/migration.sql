-- Configurable appointment reminders (Phase 2.3 revenue protection). Additive:
-- one new per-pro settings table controlling WHICH client reminders fire ahead of
-- a booking. No existing data touched. Pros without a row fall back to the code
-- default cadence (one week + three days + day before), so reminders keep working
-- for everyone the moment this ships — the row only records customizations.

-- CreateTable
CREATE TABLE "ProReminderSettings" (
    "id" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "offsetDays" INTEGER[] DEFAULT ARRAY[7, 3, 1]::INTEGER[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProReminderSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProReminderSettings_professionalId_key" ON "ProReminderSettings"("professionalId");

-- CreateIndex
CREATE INDEX "ProReminderSettings_professionalId_idx" ON "ProReminderSettings"("professionalId");

-- AddForeignKey
ALTER TABLE "ProReminderSettings" ADD CONSTRAINT "ProReminderSettings_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "ProfessionalProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
