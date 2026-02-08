/*
  Warnings:

  - The values [PRIVATE] on the enum `MediaVisibility` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "MediaVisibility_new" AS ENUM ('PUBLIC', 'PRO_CLIENT');
ALTER TABLE "public"."MediaAsset" ALTER COLUMN "visibility" DROP DEFAULT;
ALTER TABLE "MediaAsset" ALTER COLUMN "visibility" TYPE "MediaVisibility_new" USING ("visibility"::text::"MediaVisibility_new");
ALTER TYPE "MediaVisibility" RENAME TO "MediaVisibility_old";
ALTER TYPE "MediaVisibility_new" RENAME TO "MediaVisibility";
DROP TYPE "public"."MediaVisibility_old";
ALTER TABLE "MediaAsset" ALTER COLUMN "visibility" SET DEFAULT 'PUBLIC';
COMMIT;
