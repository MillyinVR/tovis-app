-- CreateTable
CREATE TABLE "LastMinuteSettings" (
    "id" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "windowSameDayPct" INTEGER NOT NULL DEFAULT 20,
    "window24hPct" INTEGER NOT NULL DEFAULT 10,
    "minPrice" DECIMAL(10,2),
    "disableMon" BOOLEAN NOT NULL DEFAULT false,
    "disableTue" BOOLEAN NOT NULL DEFAULT false,
    "disableWed" BOOLEAN NOT NULL DEFAULT false,
    "disableThu" BOOLEAN NOT NULL DEFAULT false,
    "disableFri" BOOLEAN NOT NULL DEFAULT false,
    "disableSat" BOOLEAN NOT NULL DEFAULT false,
    "disableSun" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LastMinuteSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LastMinuteServiceRule" (
    "id" TEXT NOT NULL,
    "settingsId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "minPrice" DECIMAL(10,2),

    CONSTRAINT "LastMinuteServiceRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LastMinuteBlock" (
    "id" TEXT NOT NULL,
    "settingsId" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,

    CONSTRAINT "LastMinuteBlock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LastMinuteSettings_professionalId_key" ON "LastMinuteSettings"("professionalId");

-- CreateIndex
CREATE UNIQUE INDEX "LastMinuteServiceRule_settingsId_serviceId_key" ON "LastMinuteServiceRule"("settingsId", "serviceId");

-- CreateIndex
CREATE INDEX "LastMinuteBlock_settingsId_startAt_idx" ON "LastMinuteBlock"("settingsId", "startAt");

-- AddForeignKey
ALTER TABLE "LastMinuteSettings" ADD CONSTRAINT "LastMinuteSettings_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "ProfessionalProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LastMinuteServiceRule" ADD CONSTRAINT "LastMinuteServiceRule_settingsId_fkey" FOREIGN KEY ("settingsId") REFERENCES "LastMinuteSettings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LastMinuteServiceRule" ADD CONSTRAINT "LastMinuteServiceRule_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LastMinuteBlock" ADD CONSTRAINT "LastMinuteBlock_settingsId_fkey" FOREIGN KEY ("settingsId") REFERENCES "LastMinuteSettings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
