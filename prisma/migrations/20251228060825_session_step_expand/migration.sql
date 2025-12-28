/*
  Warnings:

  - The values [CONSULTATION_DRAFT,AWAITING_CLIENT_APPROVAL,READY_TO_FINISH,FINISH_DETAILS] on the enum `SessionStep` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "SessionStep_new" AS ENUM ('NONE', 'CONSULTATION', 'CONSULTATION_PENDING_CLIENT', 'BEFORE_PHOTOS', 'SERVICE_IN_PROGRESS', 'FINISH_REVIEW', 'AFTER_PHOTOS', 'DONE');
ALTER TABLE "public"."Booking" ALTER COLUMN "sessionStep" DROP DEFAULT;
ALTER TABLE "Booking" ALTER COLUMN "sessionStep" TYPE "SessionStep_new" USING ("sessionStep"::text::"SessionStep_new");
ALTER TYPE "SessionStep" RENAME TO "SessionStep_old";
ALTER TYPE "SessionStep_new" RENAME TO "SessionStep";
DROP TYPE "public"."SessionStep_old";
ALTER TABLE "Booking" ALTER COLUMN "sessionStep" SET DEFAULT 'NONE';
COMMIT;
