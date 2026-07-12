-- Make ProClientInvite's pro/booking links optional so a claim invite can be
-- pro-less (cold self-serve — no pro in context) and/or booking-less (a
-- directory-created or migration-imported client with no appointment). The
-- `ProClientInvite_bookingId_key` unique index stays: Postgres treats NULLs as
-- distinct, so it still enforces one invite per real booking while allowing many
-- booking-less invites. Both FKs switch ON DELETE CASCADE -> SET NULL so deleting
-- a pro/booking demotes the invite rather than destroying a still-valid claim link.

-- DropForeignKey
ALTER TABLE "ProClientInvite" DROP CONSTRAINT "ProClientInvite_professionalId_fkey";

-- DropForeignKey
ALTER TABLE "ProClientInvite" DROP CONSTRAINT "ProClientInvite_bookingId_fkey";

-- AlterTable
ALTER TABLE "ProClientInvite" ALTER COLUMN "professionalId" DROP NOT NULL,
ALTER COLUMN "bookingId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "ProClientInvite" ADD CONSTRAINT "ProClientInvite_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "ProfessionalProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProClientInvite" ADD CONSTRAINT "ProClientInvite_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;
