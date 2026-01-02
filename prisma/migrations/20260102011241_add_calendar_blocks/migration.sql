-- CreateTable
CREATE TABLE "CalendarBlock" (
    "id" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarBlock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CalendarBlock_professionalId_startsAt_idx" ON "CalendarBlock"("professionalId", "startsAt");

-- CreateIndex
CREATE INDEX "CalendarBlock_professionalId_endsAt_idx" ON "CalendarBlock"("professionalId", "endsAt");

-- AddForeignKey
ALTER TABLE "CalendarBlock" ADD CONSTRAINT "CalendarBlock_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "ProfessionalProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
