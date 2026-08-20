-- Per-viewer person block (App Store guideline 1.2). Additive: one new table,
-- shaped like the per-viewer LookHide but keyed on User↔User instead of
-- User↔LookPost. No changes to existing tables, so it applies cleanly on the
-- next production migrate-deploy.

-- CreateTable
CREATE TABLE "UserBlock" (
    "id" TEXT NOT NULL,
    "blockerUserId" TEXT NOT NULL,
    "blockedUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserBlock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- One block per ordered pair: a re-block is idempotent, not a second row.
CREATE UNIQUE INDEX "UserBlock_blockerUserId_blockedUserId_key" ON "UserBlock"("blockerUserId", "blockedUserId");

-- CreateIndex
-- Both directions are read on every feed and comment query (the block is stored
-- one-way and enforced symmetrically), so both directions are indexed.
CREATE INDEX "UserBlock_blockerUserId_createdAt_idx" ON "UserBlock"("blockerUserId", "createdAt");

-- CreateIndex
CREATE INDEX "UserBlock_blockedUserId_createdAt_idx" ON "UserBlock"("blockedUserId", "createdAt");

-- AddForeignKey
ALTER TABLE "UserBlock" ADD CONSTRAINT "UserBlock_blockerUserId_fkey" FOREIGN KEY ("blockerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBlock" ADD CONSTRAINT "UserBlock_blockedUserId_fkey" FOREIGN KEY ("blockedUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 🔴 Blocking yourself is not a state the product has any meaning for, and it
-- would silently erase your own content from your own feeds. Refused at the
-- database so no future writer can create one.
ALTER TABLE "UserBlock"
  ADD CONSTRAINT "UserBlock_not_self"
  CHECK ("blockerUserId" <> "blockedUserId");

-- 🔴 Every table in this database carries RLS; a new one that omits it is
-- readable by any role the app's connection can assume. No policy is added: all
-- access goes through the app's own scoping (the Prisma service role bypasses
-- RLS), matching LookHide and the sibling user-owned tables.
ALTER TABLE "UserBlock" ENABLE ROW LEVEL SECURITY;
