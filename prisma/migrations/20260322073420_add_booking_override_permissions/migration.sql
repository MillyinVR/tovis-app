-- CreateEnum
CREATE TYPE "BookingOverridePermissionScope" AS ENUM ('SELF_ONLY', 'PROFESSIONAL_TEAM', 'ANY_PROFESSIONAL');

-- CreateTable
CREATE TABLE "BookingOverridePermission" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "grantedByUserId" TEXT,
    "rule" "BookingOverrideRule" NOT NULL,
    "scope" "BookingOverridePermissionScope" NOT NULL DEFAULT 'SELF_ONLY',
    "professionalId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedByUserId" TEXT,
    "reason" TEXT,
    "metadata" JSONB,

    CONSTRAINT "BookingOverridePermission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BookingOverridePermission_actorUserId_isActive_rule_idx" ON "BookingOverridePermission"("actorUserId", "isActive", "rule");

-- CreateIndex
CREATE INDEX "BookingOverridePermission_professionalId_isActive_rule_idx" ON "BookingOverridePermission"("professionalId", "isActive", "rule");

-- CreateIndex
CREATE INDEX "BookingOverridePermission_rule_isActive_startsAt_expiresAt_idx" ON "BookingOverridePermission"("rule", "isActive", "startsAt", "expiresAt");

-- CreateIndex
CREATE INDEX "BookingOverridePermission_grantedByUserId_createdAt_idx" ON "BookingOverridePermission"("grantedByUserId", "createdAt");

-- CreateIndex
CREATE INDEX "BookingOverridePermission_revokedByUserId_createdAt_idx" ON "BookingOverridePermission"("revokedByUserId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BookingOverridePermission_actorUserId_rule_scope_profession_key" ON "BookingOverridePermission"("actorUserId", "rule", "scope", "professionalId");

-- AddForeignKey
ALTER TABLE "BookingOverridePermission" ADD CONSTRAINT "BookingOverridePermission_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingOverridePermission" ADD CONSTRAINT "BookingOverridePermission_grantedByUserId_fkey" FOREIGN KEY ("grantedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingOverridePermission" ADD CONSTRAINT "BookingOverridePermission_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "ProfessionalProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingOverridePermission" ADD CONSTRAINT "BookingOverridePermission_revokedByUserId_fkey" FOREIGN KEY ("revokedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
