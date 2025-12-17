/*
  Warnings:

  - A unique constraint covering the columns `[professionalId,serviceId]` on the table `ProfessionalServiceOffering` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "ProfessionalServiceOffering_professionalId_serviceId_key" ON "ProfessionalServiceOffering"("professionalId", "serviceId");
