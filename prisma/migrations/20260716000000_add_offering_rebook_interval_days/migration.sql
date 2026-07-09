-- Per-offering "typical rebook interval" (in days), set by the pro. Drives the
-- session-wrap-up (aftercare) auto-suggested rebook window: service date + this
-- many days. Additive + nullable → back-compat; null means no suggestion (the
-- rebook recommendation stays "None", the pre-existing behavior).

-- AlterTable
ALTER TABLE "ProfessionalServiceOffering" ADD COLUMN     "rebookIntervalDays" INTEGER;
