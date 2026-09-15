-- ViralRequestProOffer — a pro saying "I can do this" about an approved viral look.
--
-- Deliberately a new table rather than a status on "ViralRequestApprovalFanOut":
-- that model records whether we managed to NOTIFY a pro, which is a different
-- fact from whether the pro agreed. The client home already counted fan-out rows
-- and told clients "N pros now offer this" about pros who had never opted in.

-- CreateTable
CREATE TABLE "ViralRequestProOffer" (
    "id" TEXT NOT NULL,
    "viralServiceRequestId" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "withdrawnAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ViralRequestProOffer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ViralRequestProOffer_viralServiceRequestId_professionalId_key" ON "ViralRequestProOffer"("viralServiceRequestId", "professionalId");

-- CreateIndex
CREATE INDEX "ViralRequestProOffer_viralServiceRequestId_withdrawnAt_idx" ON "ViralRequestProOffer"("viralServiceRequestId", "withdrawnAt");

-- CreateIndex
CREATE INDEX "ViralRequestProOffer_professionalId_withdrawnAt_createdAt_idx" ON "ViralRequestProOffer"("professionalId", "withdrawnAt", "createdAt");

-- AddForeignKey
ALTER TABLE "ViralRequestProOffer" ADD CONSTRAINT "ViralRequestProOffer_viralServiceRequestId_fkey" FOREIGN KEY ("viralServiceRequestId") REFERENCES "ViralServiceRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ViralRequestProOffer" ADD CONSTRAINT "ViralRequestProOffer_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "ProfessionalProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 🔴 RLS does NOT inherit: 20260901000000 enabled it on the tables that existed
-- THEN, so every new table needs its own statement here. Deny-all with no
-- policies, matching that migration — the app connects as a BYPASSRLS role.
-- tests/integration/database-hardening.test.ts is the only thing that catches a
-- miss, and it needs a live Postgres: typecheck, lint, the static guards and the
-- default unit suite are all blind to it.
ALTER TABLE "ViralRequestProOffer" ENABLE ROW LEVEL SECURITY;
