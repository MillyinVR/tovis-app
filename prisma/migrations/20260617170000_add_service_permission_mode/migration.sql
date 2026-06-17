-- CreateEnum
CREATE TYPE "ServicePermissionMode" AS ENUM ('ALLOW', 'DENY');

-- AlterTable
ALTER TABLE "ServicePermission" ADD COLUMN     "mode" "ServicePermissionMode" NOT NULL DEFAULT 'ALLOW';
