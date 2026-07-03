-- Admin-granted complimentary membership (additive). Comp state lives beside
-- the paid Stripe fields so webhooks never clobber it; the comp-expiry job
-- sweeps rows via the compUntil index.
ALTER TABLE "ProfessionalSubscription" ADD COLUMN "compPlanKey" TEXT;
ALTER TABLE "ProfessionalSubscription" ADD COLUMN "compUntil" TIMESTAMP(3);
ALTER TABLE "ProfessionalSubscription" ADD COLUMN "compNote" TEXT;
ALTER TABLE "ProfessionalSubscription" ADD COLUMN "compGrantedByUserId" TEXT;

CREATE INDEX "ProfessionalSubscription_compUntil_idx" ON "ProfessionalSubscription"("compUntil");
