-- Appointment prep ("Before you go") + a profession-neutral care plan.
--
-- Additive only. Four new empty tables, two new nullable columns, no backfill
-- and no existing row rewritten — so this is safe to run ahead of the code that
-- reads it (expand-phase discipline). A pro who has written nothing simply has
-- no prep rows, which is the correct rendering.
--
-- WHAT THIS BACKS
--   ProPrepItem          the pro's "Before you go" rows. `offeringId IS NULL`
--                        is their default list; a row with `offeringId` set
--                        REPLACES that default for that one service.
--   BookingPrepCheck     the CLIENT's tick. Existence is the tick — unticking
--                        deletes the row, so there is no false-valued column to
--                        disagree with a missing one.
--   BookingBoardShare    a client handing an inspiration board to the pro FOR
--                        ONE BOOKING. Deliberately does NOT touch
--                        Board.visibility: a private board stays private to
--                        everyone else, and deleting this row revokes it.
--   AftercareCareSection the care plan's labelled blocks. The label is the
--                        pro's own words in a TEXT column, never an enum —
--                        "Wash"/"Heat & styling" are meaningless to a nail tech
--                        or a lash artist, and adding a profession must never
--                        need a migration here.

-- AlterTable
ALTER TABLE "ProfessionalProfile" ADD COLUMN     "prepNote" TEXT;

-- AlterTable
ALTER TABLE "ProfessionalServiceOffering" ADD COLUMN     "prepNote" TEXT;

-- CreateTable
CREATE TABLE "ProPrepItem" (
    "id" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "offeringId" TEXT,
    "text" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProPrepItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingPrepCheck" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "prepItemId" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingPrepCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingBoardShare" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "sharedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingBoardShare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AftercareCareSection" (
    "id" TEXT NOT NULL,
    "aftercareSummaryId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AftercareCareSection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProPrepItem_professionalId_offeringId_isActive_sortOrder_idx" ON "ProPrepItem"("professionalId", "offeringId", "isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "ProPrepItem_offeringId_idx" ON "ProPrepItem"("offeringId");

-- CreateIndex
CREATE INDEX "BookingPrepCheck_bookingId_idx" ON "BookingPrepCheck"("bookingId");

-- CreateIndex
CREATE INDEX "BookingPrepCheck_prepItemId_idx" ON "BookingPrepCheck"("prepItemId");

-- CreateIndex
CREATE UNIQUE INDEX "BookingPrepCheck_bookingId_prepItemId_key" ON "BookingPrepCheck"("bookingId", "prepItemId");

-- CreateIndex
CREATE INDEX "BookingBoardShare_bookingId_idx" ON "BookingBoardShare"("bookingId");

-- CreateIndex
CREATE INDEX "BookingBoardShare_boardId_idx" ON "BookingBoardShare"("boardId");

-- CreateIndex
CREATE UNIQUE INDEX "BookingBoardShare_bookingId_boardId_key" ON "BookingBoardShare"("bookingId", "boardId");

-- CreateIndex
CREATE INDEX "AftercareCareSection_aftercareSummaryId_sortOrder_idx" ON "AftercareCareSection"("aftercareSummaryId", "sortOrder");

-- AddForeignKey
ALTER TABLE "ProPrepItem" ADD CONSTRAINT "ProPrepItem_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "ProfessionalProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProPrepItem" ADD CONSTRAINT "ProPrepItem_offeringId_fkey" FOREIGN KEY ("offeringId") REFERENCES "ProfessionalServiceOffering"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingPrepCheck" ADD CONSTRAINT "BookingPrepCheck_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingPrepCheck" ADD CONSTRAINT "BookingPrepCheck_prepItemId_fkey" FOREIGN KEY ("prepItemId") REFERENCES "ProPrepItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingBoardShare" ADD CONSTRAINT "BookingBoardShare_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingBoardShare" ADD CONSTRAINT "BookingBoardShare_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AftercareCareSection" ADD CONSTRAINT "AftercareCareSection_aftercareSummaryId_fkey" FOREIGN KEY ("aftercareSummaryId") REFERENCES "AftercareSummary"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- 🔴 Every table in this database carries RLS, and a new one that omits it is
-- readable by any role the app's connection can assume. No static check catches
-- this — it has to be written by hand, per table, every time. No policies are
-- added: all access goes through the app's own scoping and the Prisma service
-- role bypasses RLS, matching every sibling table.
ALTER TABLE "ProPrepItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BookingPrepCheck" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BookingBoardShare" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AftercareCareSection" ENABLE ROW LEVEL SECURITY;

-- A prep row with no text is not a checklist item, and a care section with no
-- label is an unheaded paragraph. Constrain at the database rather than trusting
-- every future writer to trim before insert.
ALTER TABLE "ProPrepItem"
  ADD CONSTRAINT "ProPrepItem_text_not_blank" CHECK (btrim("text") <> '');

ALTER TABLE "AftercareCareSection"
  ADD CONSTRAINT "AftercareCareSection_label_not_blank" CHECK (btrim("label") <> '');

ALTER TABLE "AftercareCareSection"
  ADD CONSTRAINT "AftercareCareSection_body_not_blank" CHECK (btrim("body") <> '');
