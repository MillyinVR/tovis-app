-- CreateEnum
CREATE TYPE "AftercareRebookMode" AS ENUM ('NONE', 'BOOKED_NEXT_APPOINTMENT', 'RECOMMENDED_WINDOW');

-- AlterTable
ALTER TABLE "AftercareSummary" ADD COLUMN     "rebookMode" "AftercareRebookMode" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "rebookWindowEnd" TIMESTAMP(3),
ADD COLUMN     "rebookWindowStart" TIMESTAMP(3);
