-- A service in more than one category without duplicating the row.
--
-- Additive: one pure join table. `Service.categoryId` is unchanged and stays the
-- PRIMARY category every existing reader uses (consult packs, commitment tier,
-- category booking policy, search index); a link only adds the service to a
-- second category's list in the library picker. Old code never reads this
-- table, so a code rollback leaves it installed and harmless.

CREATE TABLE "ServiceCategoryLink" (
  "serviceId" TEXT NOT NULL,
  "categoryId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ServiceCategoryLink_pkey" PRIMARY KEY ("serviceId", "categoryId")
);

CREATE INDEX "ServiceCategoryLink_categoryId_idx" ON "ServiceCategoryLink"("categoryId");

ALTER TABLE "ServiceCategoryLink"
  ADD CONSTRAINT "ServiceCategoryLink_serviceId_fkey"
  FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ServiceCategoryLink"
  ADD CONSTRAINT "ServiceCategoryLink_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "ServiceCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Server-only like every other table here: RLS on, no policies (the deny-all
-- posture tests/integration/database-hardening.test.ts enforces on every
-- public table — a table created after 20260901000000 does not inherit it).
ALTER TABLE "ServiceCategoryLink" ENABLE ROW LEVEL SECURITY;
