-- AlterTable: AEAD-encrypted email envelope (expand phase; plaintext column retained).
ALTER TABLE "User" ADD COLUMN     "emailEncrypted" JSONB;

-- AlterTable
ALTER TABLE "ClientProfile" ADD COLUMN     "emailEncrypted" JSONB;
