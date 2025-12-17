-- CreateTable
CREATE TABLE "ProfessionalFavorite" (
    "id" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfessionalFavorite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProfessionalFavorite_professionalId_createdAt_idx" ON "ProfessionalFavorite"("professionalId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProfessionalFavorite_professionalId_userId_key" ON "ProfessionalFavorite"("professionalId", "userId");

-- AddForeignKey
ALTER TABLE "ProfessionalFavorite" ADD CONSTRAINT "ProfessionalFavorite_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "ProfessionalProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalFavorite" ADD CONSTRAINT "ProfessionalFavorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
