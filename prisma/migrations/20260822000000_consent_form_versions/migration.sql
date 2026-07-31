-- K14: consent form templates + APPEND-ONLY versions (Phase 7 opens).
--
-- The whole point of this model is that "the client signed the corrective-color
-- waiver on the 3rd" still means something after the pro edits that waiver on
-- the 5th. Application code can promise that; only the database can enforce it.
-- So ConsentFormVersion rows are immutable AT THE DATABASE, and a version a
-- client signed cannot be deleted (RESTRICT from ClientConsentRecord).
--
-- Additive throughout: ClientConsentRecord."formVersionId" is nullable with no
-- backfill, because every existing row predates forms entirely (free-text
-- serviceScope + encrypted notes) and must keep reading exactly as it does now.

-- 1. The form: identity + ownership. NULL "professionalId" = a platform template.
CREATE TABLE "ConsentForm" (
  "id"               TEXT NOT NULL,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  "professionalId"   TEXT,
  "kind"             "ClientConsentKind" NOT NULL,
  "isActive"         BOOLEAN NOT NULL DEFAULT true,
  "sourceTemplateId" TEXT,

  CONSTRAINT "ConsentForm_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ConsentForm_professionalId_kind_isActive_idx"
  ON "ConsentForm" ("professionalId", "kind", "isActive");
CREATE INDEX "ConsentForm_sourceTemplateId_idx"
  ON "ConsentForm" ("sourceTemplateId");

ALTER TABLE "ConsentForm"
  ADD CONSTRAINT "ConsentForm_professionalId_fkey"
  FOREIGN KEY ("professionalId") REFERENCES "ProfessionalProfile" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ConsentForm"
  ADD CONSTRAINT "ConsentForm_sourceTemplateId_fkey"
  FOREIGN KEY ("sourceTemplateId") REFERENCES "ConsentForm" ("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 2. The version: title + body, both immutable once published.
CREATE TABLE "ConsentFormVersion" (
  "id"                        TEXT NOT NULL,
  "createdAt"                 TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "formId"                    TEXT NOT NULL,
  "version"                   INTEGER NOT NULL,
  "title"                     TEXT NOT NULL,
  "body"                      TEXT NOT NULL,
  "publishedAt"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "publishedByProfessionalId" TEXT,
  "sourceTemplateVersionId"   TEXT,
  "verbatimFromTemplate"      BOOLEAN NOT NULL DEFAULT false,

  CONSTRAINT "ConsentFormVersion_pkey" PRIMARY KEY ("id")
);

-- Two sessions publishing at once cannot both claim version n.
CREATE UNIQUE INDEX "ConsentFormVersion_formId_version_key"
  ON "ConsentFormVersion" ("formId", "version");
CREATE INDEX "ConsentFormVersion_sourceTemplateVersionId_idx"
  ON "ConsentFormVersion" ("sourceTemplateVersionId");

ALTER TABLE "ConsentFormVersion"
  ADD CONSTRAINT "ConsentFormVersion_formId_fkey"
  FOREIGN KEY ("formId") REFERENCES "ConsentForm" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ConsentFormVersion"
  ADD CONSTRAINT "ConsentFormVersion_sourceTemplateVersionId_fkey"
  FOREIGN KEY ("sourceTemplateVersionId") REFERENCES "ConsentFormVersion" ("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 3. 🔴 APPEND-ONLY, enforced by the database.
--
-- Every UPDATE on a published version is refused, whatever issues it — the app,
-- a migration, a psql session, an admin with a hunch. There is no legitimate
-- reason to change a published version: retiring a form is ConsentForm.isActive,
-- and changing the words is publishing version n+1.
--
-- DELETE is deliberately NOT blocked here. A version nobody signed is ordinary
-- draft debris (and test fixtures need to clean up); a version somebody DID sign
-- is protected by the RESTRICT foreign key below, which is the case that matters
-- and is enforced by referential integrity rather than by a trigger's opinion.
CREATE OR REPLACE FUNCTION "consent_form_version_is_append_only"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'ConsentFormVersion is append-only: version % of form % cannot be modified. Publish a new version instead.',
    OLD."version", OLD."formId"
    USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ConsentFormVersion_append_only"
  BEFORE UPDATE ON "ConsentFormVersion"
  FOR EACH ROW
  EXECUTE FUNCTION "consent_form_version_is_append_only"();

-- 4. The signature's pointer at the exact text it attests to.
ALTER TABLE "ClientConsentRecord"
  ADD COLUMN "formVersionId" TEXT;

CREATE INDEX "ClientConsentRecord_formVersionId_idx"
  ON "ClientConsentRecord" ("formVersionId");

-- RESTRICT, not SET NULL: silently blanking the pointer would leave a record
-- claiming a client agreed to text that no longer exists anywhere.
ALTER TABLE "ClientConsentRecord"
  ADD CONSTRAINT "ClientConsentRecord_formVersionId_fkey"
  FOREIGN KEY ("formVersionId") REFERENCES "ConsentFormVersion" ("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
