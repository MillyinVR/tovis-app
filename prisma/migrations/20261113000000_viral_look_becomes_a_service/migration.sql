-- A viral look becomes a real catalog Service, linked to the work underneath it.
--
-- Tori, 2026-09-15: "say 'bubble gum nails' is requested by a client — the admin
-- sees the request, decides what type of pro would offer that service, we figure
-- out how the service is done, give the description to the pro, they choose to
-- add it to their menu or not, then the client can book that service. that way
-- the client and the pro are speaking the same language when it comes to what is
-- trending on other platforms."
--
-- Three additions, no rewrites:
--
--   1. "Service"."proBreakdown" — how the work is DONE, in professional terms.
--      A third description alongside the client-facing "description" and the
--      engine-facing "consultSummary", because the client and the pro need
--      different things: "the client should only see the name and description of
--      the viral service. the pro gets the full breakdown."
--
--   2. "ViralServiceBaseService" — the trending NAME and the real service(s)
--      underneath it. "A wolf cut is a viral name for a layered cut … that
--      service is still a haircut." Many-to-many because a look may need a cut
--      AND a style. The "at least one" minimum is a write-path rule
--      (lib/services/viralBaseServiceLinks.ts) — a composite-key join table
--      cannot express it.
--
--   3. "ViralServiceRequest"."serviceId" — the service a look became.
--      NULLABLE on purpose: "no service, no approval" is a rule about the
--      APPROVAL TRANSITION, not a column constraint. Three dev requests are
--      already APPROVED with no service, and a NOT NULL column would refuse
--      them. A guard that cannot be deployed is not a guard.
--
-- Statements below are Prisma's own (`prisma migrate diff`), not hand-written.
-- ⚠️ That diff also wanted to drop and re-add foreign keys on four Consult
-- tables — pre-existing drift between prisma/migrations and prisma/schema.prisma
-- on main, nothing to do with this change. Deliberately NOT included here.

-- AlterTable
ALTER TABLE "Service" ADD COLUMN     "proBreakdown" TEXT;

-- AlterTable
ALTER TABLE "ViralServiceRequest" ADD COLUMN     "serviceId" TEXT;

-- CreateTable
CREATE TABLE "ViralServiceBaseService" (
    "viralServiceId" TEXT NOT NULL,
    "baseServiceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ViralServiceBaseService_pkey" PRIMARY KEY ("viralServiceId","baseServiceId")
);

-- CreateIndex
CREATE INDEX "ViralServiceBaseService_baseServiceId_idx" ON "ViralServiceBaseService"("baseServiceId");

-- CreateIndex
CREATE INDEX "ViralServiceRequest_serviceId_idx" ON "ViralServiceRequest"("serviceId");

-- AddForeignKey
ALTER TABLE "ViralServiceBaseService" ADD CONSTRAINT "ViralServiceBaseService_viralServiceId_fkey" FOREIGN KEY ("viralServiceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ViralServiceBaseService" ADD CONSTRAINT "ViralServiceBaseService_baseServiceId_fkey" FOREIGN KEY ("baseServiceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ViralServiceRequest" ADD CONSTRAINT "ViralServiceRequest_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 🔴 RLS does NOT inherit: 20260901000000 enabled it on the tables that existed
-- THEN, so every new table needs its own statement here. Deny-all with no
-- policies, matching that migration — the app connects as a BYPASSRLS role.
-- tests/integration/database-hardening.test.ts is the only thing that catches a
-- miss, and it needs a live Postgres: typecheck, lint, the static guards and the
-- default unit suite are all blind to it.
ALTER TABLE "ViralServiceBaseService" ENABLE ROW LEVEL SECURITY;
