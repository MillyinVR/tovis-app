-- AI Consult Phase 0 lifecycle, revision, and legal foundation.
--
-- Scope is deliberately narrow: booking-attached hair color only. This adds
-- no intake questions, upload/capture route, analysis engine, UI, or billing.
-- The permanent ConsultPhoto scaffold from C1 is removed before it can be
-- wired: raw consult photos are transient processing inputs, not a durable
-- hair-history record. The guard below aborts instead of deleting an
-- unexpected row.

-- Replace the coarse C1 lifecycle with the explicit consent-first lifecycle.
CREATE TYPE "ConsultSessionStatus_new" AS ENUM (
  'CONSENT_REQUIRED',
  'INTAKE_READY',
  'INTAKE_IN_PROGRESS',
  'MEDIA_READY',
  'ANALYSIS_PENDING',
  'ANALYZING',
  'COMPLETED',
  'CONSENT_REVOKED',
  'CANCELLED'
);

ALTER TABLE "ConsultSession" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "ConsultSession"
  ALTER COLUMN "status" TYPE "ConsultSessionStatus_new"
  USING (
    CASE "status"::text
      WHEN 'CREATED' THEN 'CONSENT_REQUIRED'
      WHEN 'INTAKE' THEN 'CONSENT_REQUIRED'
      -- C1 had no legal-evidence model. Never grandfather an active/sensitive
      -- state that cannot prove consent and 18+ attestation preceded it.
      WHEN 'ANALYZING' THEN 'CONSENT_REQUIRED'
      WHEN 'READY' THEN 'CONSENT_REQUIRED'
      WHEN 'CANCELLED' THEN 'CANCELLED'
    END
  )::"ConsultSessionStatus_new";
DROP TYPE "ConsultSessionStatus";
ALTER TYPE "ConsultSessionStatus_new" RENAME TO "ConsultSessionStatus";
ALTER TABLE "ConsultSession"
  ALTER COLUMN "status" SET DEFAULT 'CONSENT_REQUIRED';

-- The founder pilot is booking-attached only. C1's route has always populated
-- all three anchors; abort instead of inventing values for an unexpected
-- standalone/manual row.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public."ConsultSession"
    WHERE "bookingId" IS NULL
       OR "professionalId" IS NULL
       OR "serviceCategoryId" IS NULL
  ) THEN
    RAISE EXCEPTION 'ConsultSession contains an unanchored row; Phase 0 requires booking/category/professional';
  END IF;
END;
$$;

ALTER TABLE "ConsultSession"
  ALTER COLUMN "bookingId" SET NOT NULL,
  ALTER COLUMN "professionalId" SET NOT NULL,
  ALTER COLUMN "serviceCategoryId" SET NOT NULL;

ALTER TABLE "ConsultSession" DROP CONSTRAINT "ConsultSession_bookingId_fkey";
ALTER TABLE "ConsultSession" DROP CONSTRAINT "ConsultSession_professionalId_fkey";
ALTER TABLE "ConsultSession" DROP CONSTRAINT "ConsultSession_serviceCategoryId_fkey";
ALTER TABLE "ConsultSession"
  ADD CONSTRAINT "ConsultSession_bookingId_fkey"
  FOREIGN KEY ("bookingId") REFERENCES "Booking" ("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConsultSession"
  ADD CONSTRAINT "ConsultSession_professionalId_fkey"
  FOREIGN KEY ("professionalId") REFERENCES "ProfessionalProfile" ("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConsultSession"
  ADD CONSTRAINT "ConsultSession_serviceCategoryId_fkey"
  FOREIGN KEY ("serviceCategoryId") REFERENCES "ServiceCategory" ("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Prove every existing C1 row came through the booking-derived hair-color
-- route before installing the same rule as a permanent database invariant.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public."ConsultSession" AS session
    JOIN public."Booking" AS booking ON booking."id" = session."bookingId"
    JOIN public."Service" AS service ON service."id" = booking."serviceId"
    JOIN public."ServiceCategory" AS category ON category."id" = service."categoryId"
    WHERE booking."clientId" <> session."clientId"
       OR booking."professionalId" <> session."professionalId"
       OR service."categoryId" <> session."serviceCategoryId"
       OR category."slug" <> 'hair-color'
  ) THEN
    RAISE EXCEPTION 'ConsultSession contains a row outside the booking-attached hair-color pilot';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION "consult_session_scope_guard"()
RETURNS TRIGGER AS $$
DECLARE
  scope_matches BOOLEAN;
BEGIN
  SELECT
    booking."clientId" = NEW."clientId"
    AND booking."professionalId" = NEW."professionalId"
    AND service."categoryId" = NEW."serviceCategoryId"
    AND category."slug" = 'hair-color'
  INTO scope_matches
  FROM public."Booking" AS booking
  JOIN public."Service" AS service ON service."id" = booking."serviceId"
  JOIN public."ServiceCategory" AS category ON category."id" = service."categoryId"
  WHERE booking."id" = NEW."bookingId";

  IF scope_matches IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'consult session must match its booking client, professional, and hair-color category'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION "consult_session_scope_guard"() SET search_path = '';

CREATE TRIGGER "ConsultSession_scope_guard"
  BEFORE INSERT OR UPDATE OF "clientId", "bookingId", "professionalId", "serviceCategoryId"
  ON "ConsultSession"
  FOR EACH ROW EXECUTE FUNCTION "consult_session_scope_guard"();

CREATE TYPE "ConsultRevisionKind" AS ENUM ('INTAKE', 'ANALYSIS', 'BRIEF');
CREATE TYPE "ConsultAgreementKind" AS ENUM (
  'SENSITIVE_DATA_CONSENT',
  'ADULT_18_PLUS_ATTESTATION'
);
CREATE TYPE "ConsultActorType" AS ENUM ('CLIENT', 'PROFESSIONAL', 'SYSTEM');
CREATE TYPE "ConsultAuditAction" AS ENUM (
  'SESSION_CREATED',
  'AGREEMENT_ACCEPTED',
  'AGREEMENT_REVOKED',
  'LIFECYCLE_TRANSITIONED',
  'REVISION_CREATED'
);

ALTER TABLE "ConsultSession"
  ADD COLUMN "revisionSequence" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ConsultSession"
  ADD CONSTRAINT "ConsultSession_revisionSequence_nonnegative"
  CHECK ("revisionSequence" >= 0);

-- Immutable/versioned payloads replace mutable JSON on ConsultSession.
CREATE TABLE "ConsultRevision" (
  "id" TEXT NOT NULL,
  "consultSessionId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "kind" "ConsultRevisionKind" NOT NULL,
  "payload" JSONB NOT NULL,
  "schemaVersion" INTEGER NOT NULL,
  "model" TEXT,
  "promptVersion" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ConsultRevision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ConsultRevision_positive_versions" CHECK (
    "revision" > 0 AND "schemaVersion" > 0
  )
);

CREATE UNIQUE INDEX "ConsultRevision_consultSessionId_revision_key"
  ON "ConsultRevision" ("consultSessionId", "revision");
CREATE INDEX "ConsultRevision_consultSessionId_createdAt_idx"
  ON "ConsultRevision" ("consultSessionId", "createdAt");

ALTER TABLE "ConsultRevision"
  ADD CONSTRAINT "ConsultRevision_consultSessionId_fkey"
  FOREIGN KEY ("consultSessionId") REFERENCES "ConsultSession" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- No C1 application route collected these fields. Abort if an out-of-band
-- writer did: silently blessing consentless sensitive content would violate
-- the new prerequisite and is less safe than requiring manual remediation.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public."ConsultSession"
    WHERE "intakeAnswers" IS NOT NULL
       OR "analysis" IS NOT NULL
       OR "brief" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'ConsultSession contains legacy sensitive content without consent evidence';
  END IF;
END;
$$;

ALTER TABLE "ConsultSession"
  DROP COLUMN "intakeAnswers",
  DROP COLUMN "analysis",
  DROP COLUMN "schemaVersion",
  DROP COLUMN "model",
  DROP COLUMN "promptVersion",
  DROP COLUMN "brief";

-- Exact, immutable wording for both required legal acknowledgements.
CREATE TABLE "ConsultAgreementVersion" (
  "id" TEXT NOT NULL,
  "kind" "ConsultAgreementKind" NOT NULL,
  "version" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ConsultAgreementVersion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ConsultAgreementVersion_content" CHECK (
    "version" > 0 AND length(btrim("title")) > 0 AND length(btrim("body")) > 0
  )
);

CREATE UNIQUE INDEX "ConsultAgreementVersion_kind_version_key"
  ON "ConsultAgreementVersion" ("kind", "version");
CREATE INDEX "ConsultAgreementVersion_kind_publishedAt_idx"
  ON "ConsultAgreementVersion" ("kind", "publishedAt");

CREATE TABLE "ConsultAgreementAcceptance" (
  "id" TEXT NOT NULL,
  "consultSessionId" TEXT NOT NULL,
  "agreementVersionId" TEXT NOT NULL,
  "kind" "ConsultAgreementKind" NOT NULL,
  "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "acceptedByType" "ConsultActorType" NOT NULL,
  "acceptedById" TEXT NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "revokedByType" "ConsultActorType",
  "revokedById" TEXT,
  "revocationReason" VARCHAR(500),

  CONSTRAINT "ConsultAgreementAcceptance_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ConsultAgreementAcceptance_revocation_complete" CHECK (
    ("revokedAt" IS NULL AND "revokedByType" IS NULL AND "revokedById" IS NULL AND "revocationReason" IS NULL)
    OR
    ("revokedAt" IS NOT NULL AND "revokedByType" IS NOT NULL AND "revokedById" IS NOT NULL AND "revocationReason" IS NOT NULL)
  ),
  CONSTRAINT "ConsultAgreementAcceptance_revocation_order" CHECK (
    "revokedAt" IS NULL OR "revokedAt" >= "acceptedAt"
  ),
  CONSTRAINT "ConsultAgreementAcceptance_actor_evidence" CHECK (
    length(btrim("acceptedById")) > 0
    AND ("revokedById" IS NULL OR length(btrim("revokedById")) > 0)
    AND ("revocationReason" IS NULL OR length(btrim("revocationReason")) > 0)
  )
);

CREATE INDEX "ConsultAgreementAcceptance_consultSessionId_kind_revokedAt_idx"
  ON "ConsultAgreementAcceptance" ("consultSessionId", "kind", "revokedAt");
CREATE INDEX "ConsultAgreementAcceptance_agreementVersionId_idx"
  ON "ConsultAgreementAcceptance" ("agreementVersionId");
CREATE UNIQUE INDEX "ConsultAgreementAcceptance_one_active_kind"
  ON "ConsultAgreementAcceptance" ("consultSessionId", "kind")
  WHERE "revokedAt" IS NULL;

ALTER TABLE "ConsultAgreementAcceptance"
  ADD CONSTRAINT "ConsultAgreementAcceptance_consultSessionId_fkey"
  FOREIGN KEY ("consultSessionId") REFERENCES "ConsultSession" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConsultAgreementAcceptance"
  ADD CONSTRAINT "ConsultAgreementAcceptance_agreementVersionId_fkey"
  FOREIGN KEY ("agreementVersionId") REFERENCES "ConsultAgreementVersion" ("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Content-free audit trail for legal and lifecycle transitions.
CREATE TABLE "ConsultAuditEvent" (
  "id" TEXT NOT NULL,
  "consultSessionId" TEXT NOT NULL,
  "action" "ConsultAuditAction" NOT NULL,
  "actorType" "ConsultActorType" NOT NULL,
  "actorId" TEXT,
  "fromStatus" "ConsultSessionStatus",
  "toStatus" "ConsultSessionStatus",
  "agreementAcceptanceId" TEXT,
  "revisionId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ConsultAuditEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ConsultAuditEvent_shape" CHECK (
    ("action" = 'SESSION_CREATED' AND "fromStatus" IS NULL AND "toStatus" IS NOT NULL)
    OR
    ("action" = 'AGREEMENT_ACCEPTED' AND "agreementAcceptanceId" IS NOT NULL)
    OR
    ("action" = 'AGREEMENT_REVOKED' AND "agreementAcceptanceId" IS NOT NULL)
    OR
    ("action" = 'LIFECYCLE_TRANSITIONED' AND "fromStatus" IS NOT NULL AND "toStatus" IS NOT NULL)
    OR
    ("action" = 'REVISION_CREATED' AND "revisionId" IS NOT NULL)
  )
);

CREATE INDEX "ConsultAuditEvent_consultSessionId_createdAt_idx"
  ON "ConsultAuditEvent" ("consultSessionId", "createdAt");
CREATE INDEX "ConsultAuditEvent_agreementAcceptanceId_idx"
  ON "ConsultAuditEvent" ("agreementAcceptanceId");
CREATE INDEX "ConsultAuditEvent_revisionId_idx"
  ON "ConsultAuditEvent" ("revisionId");

ALTER TABLE "ConsultAuditEvent"
  ADD CONSTRAINT "ConsultAuditEvent_consultSessionId_fkey"
  FOREIGN KEY ("consultSessionId") REFERENCES "ConsultSession" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConsultAuditEvent"
  ADD CONSTRAINT "ConsultAuditEvent_agreementAcceptanceId_fkey"
  FOREIGN KEY ("agreementAcceptanceId") REFERENCES "ConsultAgreementAcceptance" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConsultAuditEvent"
  ADD CONSTRAINT "ConsultAuditEvent_revisionId_fkey"
  FOREIGN KEY ("revisionId") REFERENCES "ConsultRevision" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "ConsultAuditEvent" (
  "id", "consultSessionId", "action", "actorType", "toStatus", "createdAt"
)
SELECT
  'legacy-created-' || "id", "id", 'SESSION_CREATED', 'SYSTEM', "status", "createdAt"
FROM "ConsultSession";

-- Database-enforced append-only/versioning and consent prerequisites.
CREATE OR REPLACE FUNCTION "consult_immutable_row"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; insert a new record instead', TG_TABLE_NAME
    USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION "consult_immutable_row"() SET search_path = '';

CREATE TRIGGER "ConsultRevision_immutable"
  BEFORE UPDATE ON "ConsultRevision"
  FOR EACH ROW EXECUTE FUNCTION "consult_immutable_row"();
CREATE TRIGGER "ConsultAgreementVersion_immutable"
  BEFORE UPDATE ON "ConsultAgreementVersion"
  FOR EACH ROW EXECUTE FUNCTION "consult_immutable_row"();
CREATE TRIGGER "ConsultAuditEvent_immutable"
  BEFORE UPDATE ON "ConsultAuditEvent"
  FOR EACH ROW EXECUTE FUNCTION "consult_immutable_row"();

CREATE OR REPLACE FUNCTION "consult_acceptance_guard"()
RETURNS TRIGGER AS $$
DECLARE
  version_kind public."ConsultAgreementKind";
  session_client_user_id TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT version."kind" INTO version_kind
    FROM public."ConsultAgreementVersion" AS version
    WHERE version."id" = NEW."agreementVersionId";

    IF version_kind IS NULL OR version_kind <> NEW."kind" THEN
      RAISE EXCEPTION 'agreement acceptance kind must match its immutable version'
        USING ERRCODE = '23514';
    END IF;

    SELECT client."userId" INTO session_client_user_id
    FROM public."ConsultSession" AS session
    JOIN public."ClientProfile" AS client ON client."id" = session."clientId"
    WHERE session."id" = NEW."consultSessionId";

    IF NEW."acceptedByType" <> 'CLIENT'
      OR NEW."acceptedById" IS DISTINCT FROM session_client_user_id
    THEN
      RAISE EXCEPTION 'consult agreements must be accepted by the owning client'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."revokedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'a revoked agreement acceptance is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."id" <> OLD."id"
    OR NEW."consultSessionId" <> OLD."consultSessionId"
    OR NEW."agreementVersionId" <> OLD."agreementVersionId"
    OR NEW."kind" <> OLD."kind"
    OR NEW."acceptedAt" <> OLD."acceptedAt"
    OR NEW."acceptedByType" <> OLD."acceptedByType"
    OR NEW."acceptedById" <> OLD."acceptedById"
    OR NEW."revokedAt" IS NULL
  THEN
    RAISE EXCEPTION 'agreement acceptance evidence is immutable; only one-way revocation is allowed'
      USING ERRCODE = '23514';
  END IF;

  SELECT client."userId" INTO session_client_user_id
  FROM public."ConsultSession" AS session
  JOIN public."ClientProfile" AS client ON client."id" = session."clientId"
  WHERE session."id" = OLD."consultSessionId";

  IF NEW."revokedByType" <> 'CLIENT'
    OR NEW."revokedById" IS DISTINCT FROM session_client_user_id
  THEN
    RAISE EXCEPTION 'consult agreements must be revoked by the owning client'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION "consult_acceptance_guard"() SET search_path = '';

CREATE TRIGGER "ConsultAgreementAcceptance_guard"
  BEFORE INSERT OR UPDATE ON "ConsultAgreementAcceptance"
  FOR EACH ROW EXECUTE FUNCTION "consult_acceptance_guard"();

CREATE OR REPLACE FUNCTION "consult_revision_requires_agreements"()
RETURNS TRIGGER AS $$
DECLARE
  active_kinds INTEGER;
  session_status public."ConsultSessionStatus";
  session_sequence INTEGER;
BEGIN
  SELECT session."status", session."revisionSequence"
    INTO session_status, session_sequence
  FROM public."ConsultSession" AS session
  WHERE session."id" = NEW."consultSessionId";

  SELECT count(DISTINCT acceptance."kind")::integer INTO active_kinds
  FROM public."ConsultAgreementAcceptance" AS acceptance
  WHERE acceptance."consultSessionId" = NEW."consultSessionId"
    AND acceptance."revokedAt" IS NULL;

  IF active_kinds <> 2 THEN
    RAISE EXCEPTION 'active consent and 18+ attestation are required before sensitive consult revisions'
      USING ERRCODE = '23514';
  END IF;

  IF session_status IN ('CONSENT_REQUIRED', 'CONSENT_REVOKED', 'CANCELLED') THEN
    RAISE EXCEPTION 'consult lifecycle does not permit sensitive revisions in state %', session_status
      USING ERRCODE = '23514';
  END IF;

  IF NEW."revision" <> session_sequence THEN
    RAISE EXCEPTION 'revision number must match the session revision sequence'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION "consult_revision_requires_agreements"() SET search_path = '';

CREATE TRIGGER "ConsultRevision_requires_agreements"
  BEFORE INSERT ON "ConsultRevision"
  FOR EACH ROW EXECUTE FUNCTION "consult_revision_requires_agreements"();

CREATE OR REPLACE FUNCTION "consult_lifecycle_guard"()
RETURNS TRIGGER AS $$
DECLARE
  allowed BOOLEAN;
  active_kinds INTEGER;
BEGIN
  IF NEW."status" = OLD."status" THEN
    RETURN NEW;
  END IF;

  allowed := CASE OLD."status"
    WHEN 'CONSENT_REQUIRED' THEN NEW."status" IN ('INTAKE_READY', 'CANCELLED')
    WHEN 'INTAKE_READY' THEN NEW."status" IN ('INTAKE_IN_PROGRESS', 'CONSENT_REVOKED', 'CANCELLED')
    WHEN 'INTAKE_IN_PROGRESS' THEN NEW."status" IN ('MEDIA_READY', 'CONSENT_REVOKED', 'CANCELLED')
    WHEN 'MEDIA_READY' THEN NEW."status" IN ('ANALYSIS_PENDING', 'CONSENT_REVOKED', 'CANCELLED')
    WHEN 'ANALYSIS_PENDING' THEN NEW."status" IN ('ANALYZING', 'CONSENT_REVOKED', 'CANCELLED')
    WHEN 'ANALYZING' THEN NEW."status" IN ('ANALYSIS_PENDING', 'COMPLETED', 'CONSENT_REVOKED', 'CANCELLED')
    WHEN 'COMPLETED' THEN NEW."status" = 'CONSENT_REVOKED'
    WHEN 'CONSENT_REVOKED' THEN NEW."status" IN ('CONSENT_REQUIRED', 'CANCELLED')
    WHEN 'CANCELLED' THEN FALSE
  END;

  IF NOT allowed THEN
    RAISE EXCEPTION 'invalid consult lifecycle transition: % -> %', OLD."status", NEW."status"
      USING ERRCODE = '23514';
  END IF;

  IF NEW."status" IN (
    'INTAKE_READY', 'INTAKE_IN_PROGRESS', 'MEDIA_READY',
    'ANALYSIS_PENDING', 'ANALYZING', 'COMPLETED'
  ) THEN
    SELECT count(DISTINCT acceptance."kind")::integer INTO active_kinds
    FROM public."ConsultAgreementAcceptance" AS acceptance
    WHERE acceptance."consultSessionId" = NEW."id"
      AND acceptance."revokedAt" IS NULL;

    IF active_kinds <> 2 THEN
      RAISE EXCEPTION 'active consent and 18+ attestation are required for lifecycle transition'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION "consult_lifecycle_guard"() SET search_path = '';

CREATE TRIGGER "ConsultSession_lifecycle_guard"
  BEFORE UPDATE OF "status" ON "ConsultSession"
  FOR EACH ROW EXECUTE FUNCTION "consult_lifecycle_guard"();

-- Raw photo persistence is not part of this foundation. The C1 table was never
-- wired to a writer; fail closed if that assumption is false in any target DB.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public."ConsultPhoto" LIMIT 1) THEN
    RAISE EXCEPTION 'ConsultPhoto contains rows; refusing to drop potentially sensitive raw media';
  END IF;
END;
$$;
DROP TABLE "ConsultPhoto";

-- Same deny-all RLS boundary as every Prisma-backed public table. The app's
-- server role bypasses RLS; anon/authenticated Supabase roles receive no policy.
ALTER TABLE "ConsultRevision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ConsultAgreementVersion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ConsultAgreementAcceptance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ConsultAuditEvent" ENABLE ROW LEVEL SECURITY;
