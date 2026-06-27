-- CreateTable
CREATE TABLE "DeviceSessionRevocation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceId" VARCHAR(128) NOT NULL,
    "revokedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeviceSessionRevocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeviceSessionRevocation_userId_idx" ON "DeviceSessionRevocation"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceSessionRevocation_userId_deviceId_key" ON "DeviceSessionRevocation"("userId", "deviceId");

-- AddForeignKey
ALTER TABLE "DeviceSessionRevocation" ADD CONSTRAINT "DeviceSessionRevocation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
