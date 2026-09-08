-- Founding 100 is permanent recognition for the first professional accounts.
-- It is deliberately separate from the invite-only Founder research program.
ALTER TABLE "ProfessionalProfile"
  ADD COLUMN "foundingMemberNumber" INTEGER,
  ADD COLUMN "foundingMemberAwardedAt" TIMESTAMP(3);

-- Existing professional accounts are the beginning of the chronological
-- Founding 100. A stable id tie-breaker makes the assignment deterministic.
WITH ranked_professionals AS (
  SELECT
    professional."id",
    account."createdAt",
    ROW_NUMBER() OVER (
      ORDER BY account."createdAt" ASC, professional."id" ASC
    ) AS founding_number
  FROM "ProfessionalProfile" AS professional
  INNER JOIN "User" AS account ON account."id" = professional."userId"
)
UPDATE "ProfessionalProfile" AS professional
SET
  "foundingMemberNumber" = ranked.founding_number,
  "foundingMemberAwardedAt" = ranked."createdAt"
FROM ranked_professionals AS ranked
WHERE
  professional."id" = ranked."id"
  AND ranked.founding_number <= 100;

CREATE UNIQUE INDEX "ProfessionalProfile_foundingMemberNumber_key"
  ON "ProfessionalProfile"("foundingMemberNumber");

ALTER TABLE "ProfessionalProfile"
  ADD CONSTRAINT "ProfessionalProfile_foundingMemberNumber_range"
  CHECK (
    "foundingMemberNumber" IS NULL
    OR "foundingMemberNumber" BETWEEN 1 AND 100
  );

CREATE TABLE "FoundingProfessionalProgram" (
  "id" TEXT NOT NULL,
  "nextNumber" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "FoundingProfessionalProgram_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FoundingProfessionalProgram_nextNumber_range"
    CHECK ("nextNumber" BETWEEN 1 AND 101)
);

-- The app reaches this table only through its privileged server connection.
-- Enabling RLS keeps direct/public database roles from reading or advancing
-- the private fulfillment counter, matching every other application table.
ALTER TABLE "FoundingProfessionalProgram" ENABLE ROW LEVEL SECURITY;

INSERT INTO "FoundingProfessionalProgram" (
  "id",
  "nextNumber",
  "createdAt",
  "updatedAt"
)
SELECT
  'founding-100',
  LEAST(COUNT(*), 100)::INTEGER + 1,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "ProfessionalProfile";
