-- P7a-5 — pro opt-in for spark booking, plus per-category deposits.
--
-- ONE new table and ONE new enum. Nothing existing is altered: no column on
-- ProfessionalPaymentSettings changes, no deposit already configured moves, and
-- a pro with no row here books exactly as they book today. That is the whole
-- safety argument for this migration — it is additive, and the absence of a row
-- IS the current behaviour rather than a case some branch has to remember.
--
-- 🔴 The deposit columns override the AMOUNT only. Whether a booking owes a
-- deposit at all stays with ProfessionalPaymentSettings.depositEnabled +
-- depositScope, read through the single gate in
-- lib/booking/depositRequirement.ts, which this slice does not touch. The write
-- route refuses to store a category amount while the account switch is off, so
-- this table can never become a registered policy with no call site (K10-A).
--
-- 🔴 serviceCategoryId is the category the Service row points at, as stored —
-- leaf, no tree walking, no inheritance (Tori, 2026-09-07). Booking and
-- ConsultSession already agree that a service's category is Service.categoryId,
-- so the consult's gate and the booking's deposit read one row.
--
-- ON DELETE CASCADE on both sides: a deleted pro or a deleted category leaves
-- no policy behind to be resolved against a row that is gone. Deposits are read
-- through the professional, so an orphan here would be unreachable anyway --
-- cascading makes that explicit instead of leaving dead money configuration.

CREATE TYPE "ProCategoryBookingGate" AS ENUM ('INSTANT', 'AFTER_PREP');

CREATE TABLE "ProCategoryBookingPolicy" (
  "id"                TEXT NOT NULL,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  "professionalId"    TEXT NOT NULL,
  "serviceCategoryId" TEXT NOT NULL,
  "bookingGate"       "ProCategoryBookingGate" NOT NULL DEFAULT 'INSTANT',
  "depositType"       "DepositType",
  "depositFlatAmount" DECIMAL(10,2),
  "depositPercent"    INTEGER,

  CONSTRAINT "ProCategoryBookingPolicy_pkey" PRIMARY KEY ("id")
);

-- One policy per (pro, category). A second row would make "the deposit for this
-- category" ambiguous on a money path, which is not a state any reader should
-- have to resolve.
CREATE UNIQUE INDEX "ProCategoryBookingPolicy_professionalId_serviceCategoryId_key"
  ON "ProCategoryBookingPolicy" ("professionalId", "serviceCategoryId");

CREATE INDEX "ProCategoryBookingPolicy_serviceCategoryId_idx"
  ON "ProCategoryBookingPolicy" ("serviceCategoryId");

ALTER TABLE "ProCategoryBookingPolicy"
  ADD CONSTRAINT "ProCategoryBookingPolicy_professionalId_fkey"
  FOREIGN KEY ("professionalId") REFERENCES "ProfessionalProfile"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProCategoryBookingPolicy"
  ADD CONSTRAINT "ProCategoryBookingPolicy_serviceCategoryId_fkey"
  FOREIGN KEY ("serviceCategoryId") REFERENCES "ServiceCategory"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- The deny-all posture every table has carried since
-- 20260901000000_enable_rls_and_pin_function_search_path: RLS ON, no policies.
-- A table created after that migration does not inherit it, and
-- `tests/integration/database-hardening.test.ts` fails the build until it is
-- set here. The app connects as the owner and bypasses RLS; this is what stops
-- the anon role reading a pro's booking gates and deposit amounts directly.
ALTER TABLE "ProCategoryBookingPolicy" ENABLE ROW LEVEL SECURITY;
