CREATE TYPE "FounderAudience" AS ENUM ('PRO', 'CLIENT');
CREATE TYPE "FounderMemberRole" AS ENUM ('MEMBER', 'MODERATOR', 'OWNER');
CREATE TYPE "FounderMemberStatus" AS ENUM ('ACTIVE', 'REMOVED');
CREATE TYPE "FounderSpecialty" AS ENUM (
  'HAIR',
  'NAILS',
  'LASHES_BROWS',
  'SKINCARE',
  'MAKEUP',
  'PERMANENT_MAKEUP',
  'EXTENSIONS',
  'WAXING_SPRAY_TAN',
  'BARBER'
);
CREATE TYPE "FounderRoomKey" AS ENUM (
  'PRO_ALL',
  'PRO_HAIR',
  'PRO_NAILS',
  'PRO_LASHES_BROWS',
  'PRO_SKINCARE',
  'PRO_MAKEUP',
  'PRO_PERMANENT_MAKEUP',
  'PRO_EXTENSIONS',
  'PRO_WAXING_SPRAY_TAN',
  'PRO_BARBER',
  'CLIENT_ONE',
  'CLIENT_TWO',
  'CLIENT_THREE'
);
CREATE TYPE "FounderMessageKind" AS ENUM ('CHAT', 'QUESTION', 'BUG', 'IDEA', 'LOVE', 'ANNOUNCEMENT');
CREATE TYPE "FounderMessageReportReason" AS ENUM ('SPAM', 'HARASSMENT', 'PRIVATE_INFORMATION', 'OTHER');

CREATE TABLE "FounderProgram" (
  "id" TEXT NOT NULL,
  "proSeatsUsed" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FounderProgram_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FounderProgram_proSeatsUsed_check" CHECK ("proSeatsUsed" BETWEEN 0 AND 100)
);

CREATE TABLE "FounderMember" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "audience" "FounderAudience" NOT NULL,
  "role" "FounderMemberRole" NOT NULL DEFAULT 'MEMBER',
  "status" "FounderMemberStatus" NOT NULL DEFAULT 'ACTIVE',
  "specialty" "FounderSpecialty",
  "clientSlot" INTEGER,
  "professionalId" TEXT,
  "clientId" TEXT,
  "sponsorProfessionalId" TEXT,
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "removedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FounderMember_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FounderMember_shape_check" CHECK (
    (
      "audience" = 'PRO'
      AND "professionalId" IS NOT NULL
      AND "specialty" IS NOT NULL
      AND "clientId" IS NULL
      AND "sponsorProfessionalId" IS NULL
      AND "clientSlot" IS NULL
    )
    OR
    (
      "audience" = 'CLIENT'
      AND "professionalId" IS NULL
      AND "specialty" IS NULL
      AND "clientId" IS NOT NULL
      AND "sponsorProfessionalId" IS NOT NULL
      AND "clientSlot" BETWEEN 1 AND 3
    )
  )
);

CREATE TABLE "FounderMessage" (
  "id" TEXT NOT NULL,
  "room" "FounderRoomKey" NOT NULL,
  "kind" "FounderMessageKind" NOT NULL DEFAULT 'CHAT',
  "senderUserId" TEXT NOT NULL,
  "body" VARCHAR(4000) NOT NULL,
  "replyToId" TEXT,
  "answeredAt" TIMESTAMP(3),
  "answeredByUserId" TEXT,
  "hiddenAt" TIMESTAMP(3),
  "hiddenByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FounderMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FounderRoomRead" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "room" "FounderRoomKey" NOT NULL,
  "lastReadAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FounderRoomRead_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FounderMessageReport" (
  "id" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "reporterUserId" TEXT NOT NULL,
  "reason" "FounderMessageReportReason" NOT NULL,
  "details" VARCHAR(1000),
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FounderMessageReport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FounderMember_userId_key" ON "FounderMember"("userId");
CREATE UNIQUE INDEX "FounderMember_professionalId_key" ON "FounderMember"("professionalId");
CREATE UNIQUE INDEX "FounderMember_clientId_key" ON "FounderMember"("clientId");
CREATE UNIQUE INDEX "FounderMember_sponsorProfessionalId_clientSlot_key" ON "FounderMember"("sponsorProfessionalId", "clientSlot");
CREATE INDEX "FounderMember_audience_status_joinedAt_idx" ON "FounderMember"("audience", "status", "joinedAt");
CREATE INDEX "FounderMember_specialty_status_idx" ON "FounderMember"("specialty", "status");
CREATE INDEX "FounderMember_sponsorProfessionalId_status_idx" ON "FounderMember"("sponsorProfessionalId", "status");

CREATE INDEX "FounderMessage_room_createdAt_idx" ON "FounderMessage"("room", "createdAt");
CREATE INDEX "FounderMessage_kind_answeredAt_createdAt_idx" ON "FounderMessage"("kind", "answeredAt", "createdAt");
CREATE INDEX "FounderMessage_senderUserId_createdAt_idx" ON "FounderMessage"("senderUserId", "createdAt");
CREATE INDEX "FounderMessage_replyToId_createdAt_idx" ON "FounderMessage"("replyToId", "createdAt");
CREATE INDEX "FounderMessage_hiddenAt_createdAt_idx" ON "FounderMessage"("hiddenAt", "createdAt");

CREATE UNIQUE INDEX "FounderRoomRead_userId_room_key" ON "FounderRoomRead"("userId", "room");
CREATE INDEX "FounderRoomRead_room_lastReadAt_idx" ON "FounderRoomRead"("room", "lastReadAt");

CREATE UNIQUE INDEX "FounderMessageReport_messageId_reporterUserId_key" ON "FounderMessageReport"("messageId", "reporterUserId");
CREATE INDEX "FounderMessageReport_resolvedAt_createdAt_idx" ON "FounderMessageReport"("resolvedAt", "createdAt");
CREATE INDEX "FounderMessageReport_reporterUserId_createdAt_idx" ON "FounderMessageReport"("reporterUserId", "createdAt");

ALTER TABLE "FounderMember" ADD CONSTRAINT "FounderMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FounderMember" ADD CONSTRAINT "FounderMember_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "ProfessionalProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FounderMember" ADD CONSTRAINT "FounderMember_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "ClientProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FounderMember" ADD CONSTRAINT "FounderMember_sponsorProfessionalId_fkey" FOREIGN KEY ("sponsorProfessionalId") REFERENCES "ProfessionalProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FounderMessage" ADD CONSTRAINT "FounderMessage_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FounderMessage" ADD CONSTRAINT "FounderMessage_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES "FounderMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FounderMessage" ADD CONSTRAINT "FounderMessage_answeredByUserId_fkey" FOREIGN KEY ("answeredByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FounderMessage" ADD CONSTRAINT "FounderMessage_hiddenByUserId_fkey" FOREIGN KEY ("hiddenByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "FounderRoomRead" ADD CONSTRAINT "FounderRoomRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FounderMessageReport" ADD CONSTRAINT "FounderMessageReport_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "FounderMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FounderMessageReport" ADD CONSTRAINT "FounderMessageReport_reporterUserId_fkey" FOREIGN KEY ("reporterUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "FounderProgram" ("id", "proSeatsUsed") VALUES ('founders-2026', 0);

ALTER TABLE "FounderProgram" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FounderMember" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FounderMessage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FounderRoomRead" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FounderMessageReport" ENABLE ROW LEVEL SECURITY;
