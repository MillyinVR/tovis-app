/*
  Warnings:

  - You are about to drop the column `serviceNotes` on the `AftercareSummary` table. All the data in the column will be lost.
  - Added the required column `updatedAt` to the `AftercareSummary` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "AftercareSummary" DROP CONSTRAINT "AftercareSummary_bookingId_fkey";

-- AlterTable
ALTER TABLE "AftercareSummary" DROP COLUMN "serviceNotes",
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "draftSavedAt" TIMESTAMP(3),
ADD COLUMN     "lastEditedAt" TIMESTAMP(3),
ADD COLUMN     "sentToClientAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AddForeignKey
ALTER TABLE "AftercareSummary" ADD CONSTRAINT "AftercareSummary_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
