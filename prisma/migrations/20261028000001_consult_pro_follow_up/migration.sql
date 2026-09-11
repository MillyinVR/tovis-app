-- C2-4 — a professional asks the client one follow-up question from the Brief.
--
-- Additive: one new table, one new nullable column on the audit trail, and the
-- audit whitelist re-issued with one more arm. Historical rows, ANALYSIS/BRIEF
-- JSON and every existing wire shape are unchanged. Old code keeps running
-- against this schema (it never reads the new table), so a code rollback
-- leaves it installed.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. The question
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "ConsultProFollowUpQuestion" (
  "id" TEXT NOT NULL,
  "consultSessionId" TEXT NOT NULL,
  "professionalId" TEXT NOT NULL,
  "questionKey" TEXT NOT NULL,
  "priority" "ConsultProFollowUpPriority" NOT NULL,
  "proIntent" TEXT NOT NULL,
  "clientText" TEXT NOT NULL,
  "options" JSONB NOT NULL,
  "planVersion" INTEGER NOT NULL,
  "selectedValue" TEXT,
  "answeredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ConsultProFollowUpQuestion_pkey" PRIMARY KEY ("id"),

  -- The `pro_` prefix is the routing signal the shared answer route reads;
  -- the digits keep it unique per session under the session lock.
  CONSTRAINT "ConsultProFollowUpQuestion_key_shape"
    CHECK (("questionKey" ~ '^pro_[1-9][0-9]{0,3}$') IS TRUE),
  CONSTRAINT "ConsultProFollowUpQuestion_text_length"
    CHECK ((length("proIntent") BETWEEN 1 AND 300 AND length("clientText") BETWEEN 1 AND 300) IS TRUE),
  CONSTRAINT "ConsultProFollowUpQuestion_options_shape"
    CHECK ((jsonb_typeof("options") = 'array' AND jsonb_array_length("options") BETWEEN 2 AND 6) IS TRUE),
  CONSTRAINT "ConsultProFollowUpQuestion_options_length"
    CHECK ((length("options"::text) <= 3000) IS TRUE),
  -- The same key ban every consult JSON column carries: a professional's
  -- typed options must never become a place a secret or a storage pointer is
  -- smuggled into a row the client reads.
  CONSTRAINT "ConsultProFollowUpQuestion_no_secret_keys"
    CHECK (("options"::text !~* '"(base64|bytes|signedUrl|token|storagePath|storageBucket|rawPath|providerRequest|providerResponse|hiddenReasoning)"[[:space:]]*:') IS TRUE),
  CONSTRAINT "ConsultProFollowUpQuestion_plan_version"
    CHECK (("planVersion" >= 0) IS TRUE),
  -- An answer is a value AND a time, or neither.
  CONSTRAINT "ConsultProFollowUpQuestion_answer_pair"
    CHECK ((("selectedValue" IS NULL) = ("answeredAt" IS NULL)) IS TRUE),
  CONSTRAINT "ConsultProFollowUpQuestion_answered_after_asked"
    CHECK (("answeredAt" IS NULL OR "answeredAt" >= "createdAt") IS TRUE)
);

ALTER TABLE "ConsultProFollowUpQuestion"
  ADD CONSTRAINT "ConsultProFollowUpQuestion_consultSessionId_fkey"
  FOREIGN KEY ("consultSessionId") REFERENCES "ConsultSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConsultProFollowUpQuestion"
  ADD CONSTRAINT "ConsultProFollowUpQuestion_professionalId_fkey"
  FOREIGN KEY ("professionalId") REFERENCES "ProfessionalProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "ConsultProFollowUpQuestion_consultSessionId_questionKey_key"
  ON "ConsultProFollowUpQuestion"("consultSessionId", "questionKey");
CREATE INDEX "ConsultProFollowUpQuestion_consultSessionId_createdAt_idx"
  ON "ConsultProFollowUpQuestion"("consultSessionId", "createdAt");
CREATE INDEX "ConsultProFollowUpQuestion_professionalId_createdAt_idx"
  ON "ConsultProFollowUpQuestion"("professionalId", "createdAt");

-- Server-only, like every consult table: no policies, RLS on.
ALTER TABLE "ConsultProFollowUpQuestion" ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. The guard: scope on the way in, write-once on the way through
-- ─────────────────────────────────────────────────────────────────────────────
-- INSERT: the session must be COMPLETED (a Brief exists — that is the only
-- surface a professional asks from) and belong to this professional; the row
-- arrives UNANSWERED; every option is an object with exactly {value, label},
-- values are the server's own grammar and distinct, labels are 1–120 chars.
--
-- UPDATE: the ONLY change the row ever accepts is the answer, set exactly once,
-- and it must be one of the row's own option values. Everything else is
-- immutable — the question a client answered must be the question she saw.
CREATE OR REPLACE FUNCTION public.consult_pro_follow_up_question_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path TO '' AS $function$
DECLARE
  session_professional_id TEXT;
  session_status public."ConsultSessionStatus";
  item JSONB;
  seen TEXT[] := '{}';
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT "professionalId", "status" INTO session_professional_id, session_status
    FROM public."ConsultSession" WHERE "id" = NEW."consultSessionId";
    IF session_status IS DISTINCT FROM 'COMPLETED'
      OR NEW."professionalId" IS DISTINCT FROM session_professional_id THEN
      RAISE EXCEPTION 'invalid consult pro follow-up scope' USING ERRCODE = '23514';
    END IF;
    IF NEW."selectedValue" IS NOT NULL OR NEW."answeredAt" IS NOT NULL THEN
      RAISE EXCEPTION 'a consult pro follow-up is asked before it is answered' USING ERRCODE = '23514';
    END IF;
    FOR item IN SELECT value FROM jsonb_array_elements(NEW."options") LOOP
      IF jsonb_typeof(item) IS DISTINCT FROM 'object'
        OR NOT (item ?& ARRAY['value', 'label'])
        OR item - ARRAY['value', 'label'] <> '{}'::jsonb
        OR jsonb_typeof(item -> 'value') IS DISTINCT FROM 'string'
        OR jsonb_typeof(item -> 'label') IS DISTINCT FROM 'string'
        OR (item ->> 'value') !~ '^option-[1-6]$'
        OR length(item ->> 'label') NOT BETWEEN 1 AND 120
        OR (item ->> 'value') = ANY (seen) THEN
        RAISE EXCEPTION 'invalid consult pro follow-up options' USING ERRCODE = '23514';
      END IF;
      seen := seen || (item ->> 'value');
    END LOOP;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."consultSessionId" IS DISTINCT FROM OLD."consultSessionId"
    OR NEW."professionalId" IS DISTINCT FROM OLD."professionalId"
    OR NEW."questionKey" IS DISTINCT FROM OLD."questionKey"
    OR NEW."priority" IS DISTINCT FROM OLD."priority"
    OR NEW."proIntent" IS DISTINCT FROM OLD."proIntent"
    OR NEW."clientText" IS DISTINCT FROM OLD."clientText"
    OR NEW."options" IS DISTINCT FROM OLD."options"
    OR NEW."planVersion" IS DISTINCT FROM OLD."planVersion"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'a consult pro follow-up question is immutable once asked' USING ERRCODE = '23514';
  END IF;
  IF OLD."selectedValue" IS NOT NULL OR OLD."answeredAt" IS NOT NULL THEN
    RAISE EXCEPTION 'a consult pro follow-up is answered once' USING ERRCODE = '23514';
  END IF;
  IF NEW."selectedValue" IS NULL OR NEW."answeredAt" IS NULL THEN
    RAISE EXCEPTION 'a consult pro follow-up answer is a value and a time together' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(OLD."options") AS option
    WHERE option ->> 'value' = NEW."selectedValue"
  ) THEN
    RAISE EXCEPTION 'a consult pro follow-up answer must be one of its own options' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER "ConsultProFollowUpQuestion_guard"
  BEFORE INSERT OR UPDATE ON "ConsultProFollowUpQuestion"
  FOR EACH ROW EXECUTE FUNCTION public.consult_pro_follow_up_question_guard();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. The audit trail: a new pointer column, and the whitelist learns two actions
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "ConsultAuditEvent" ADD COLUMN "proFollowUpQuestionId" TEXT;
ALTER TABLE "ConsultAuditEvent"
  ADD CONSTRAINT "ConsultAuditEvent_proFollowUpQuestionId_fkey"
  FOREIGN KEY ("proFollowUpQuestionId") REFERENCES "ConsultProFollowUpQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- At most one ASKED and one ANSWERED row per question — the same shape the
-- capture and inspiration pointers already have.
CREATE UNIQUE INDEX "ConsultAuditEvent_proFollowUpQuestionId_action_key"
  ON "ConsultAuditEvent"("proFollowUpQuestionId", "action");
CREATE INDEX "ConsultAuditEvent_proFollowUpQuestionId_idx"
  ON "ConsultAuditEvent"("proFollowUpQuestionId");

-- 🔴 `ConsultAuditEvent_shape` is a whitelist (see 20261015000001 §3b): an
-- action it does not list can never be inserted. Every arm below is
-- byte-for-byte the shipped constraint; the LAST one is the new arm, and it
-- requires the pointer to this table and nothing else.
ALTER TABLE "ConsultAuditEvent" DROP CONSTRAINT IF EXISTS "ConsultAuditEvent_shape";
ALTER TABLE "ConsultAuditEvent" ADD CONSTRAINT "ConsultAuditEvent_shape" CHECK (
  (action = 'SESSION_CREATED' AND "fromStatus" IS NULL AND "toStatus" IS NOT NULL)
  OR (action IN ('AGREEMENT_ACCEPTED', 'AGREEMENT_REVOKED') AND "agreementAcceptanceId" IS NOT NULL)
  OR (action = 'LIFECYCLE_TRANSITIONED' AND "fromStatus" IS NOT NULL AND "toStatus" IS NOT NULL)
  OR (action = 'REVISION_CREATED' AND "revisionId" IS NOT NULL)
  OR (action = 'CAPTURE_UPLOAD_ISSUED' AND "captureId" IS NULL AND "agreementAcceptanceId" IS NULL AND "revisionId" IS NULL AND "fromStatus" IS NULL AND "toStatus" IS NULL)
  OR (action IN ('CAPTURE_ATTACHED', 'CAPTURE_QUALITY_CHECKED', 'CAPTURE_DELETED') AND "captureId" IS NOT NULL AND "agreementAcceptanceId" IS NULL AND "revisionId" IS NULL AND "fromStatus" IS NULL AND "toStatus" IS NULL)
  OR (action = 'RAW_OBJECT_PURGED' AND "agreementAcceptanceId" IS NULL AND "revisionId" IS NULL AND "fromStatus" IS NULL AND "toStatus" IS NULL)
  OR (action IN ('INSPIRATION_SOURCE_SELECTED', 'INSPIRATION_UPLOAD_ISSUED', 'INSPIRATION_UPLOAD_ATTACHED', 'INSPIRATION_REMOVED', 'INSPIRATION_RAW_PURGED') AND "inspirationId" IS NOT NULL AND "captureId" IS NULL AND "agreementAcceptanceId" IS NULL AND "revisionId" IS NULL AND "fromStatus" IS NULL AND "toStatus" IS NULL)
  OR (action = 'BRIEF_FEEDBACK_RECORDED' AND "briefFeedbackId" IS NOT NULL AND "agreementAcceptanceId" IS NULL AND "revisionId" IS NULL AND "captureId" IS NULL AND "inspirationId" IS NULL AND "fromStatus" IS NULL AND "toStatus" IS NULL)
  OR (action IN ('CLIENT_RESULTS_SERVED', 'ME_CARD_TEASER_TAPPED') AND "briefFeedbackId" IS NULL AND "agreementAcceptanceId" IS NULL AND "revisionId" IS NULL AND "captureId" IS NULL AND "inspirationId" IS NULL AND "fromStatus" IS NULL AND "toStatus" IS NULL)
  OR (action = 'ANALYSIS_RERUN_REQUESTED' AND "briefFeedbackId" IS NULL AND "agreementAcceptanceId" IS NULL AND "revisionId" IS NULL AND "captureId" IS NULL AND "inspirationId" IS NULL AND "fromStatus" IS NULL AND "toStatus" IS NULL)
  -- C2-4, the only new arm.
  OR (action IN ('PRO_FOLLOW_UP_ASKED', 'PRO_FOLLOW_UP_ANSWERED') AND "proFollowUpQuestionId" IS NOT NULL AND "briefFeedbackId" IS NULL AND "agreementAcceptanceId" IS NULL AND "revisionId" IS NULL AND "captureId" IS NULL AND "inspirationId" IS NULL AND "fromStatus" IS NULL AND "toStatus" IS NULL)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Atomic evidence: no question without its ASKED row, no answer without ANSWERED
-- ─────────────────────────────────────────────────────────────────────────────
-- Deferred constraint triggers, the pattern ConsultBriefFeedback_requires_audit
-- set: the row and its audit event land in one transaction or not at all.
CREATE OR REPLACE FUNCTION public.consult_pro_follow_up_requires_asked_audit() RETURNS trigger
LANGUAGE plpgsql SET search_path TO '' AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public."ConsultAuditEvent"
    WHERE "proFollowUpQuestionId" = NEW."id"
      AND "consultSessionId" = NEW."consultSessionId"
      AND "action" = 'PRO_FOLLOW_UP_ASKED'
      AND "actorType" = 'PROFESSIONAL'
      AND "actorId" = NEW."professionalId"
  ) THEN
    RAISE EXCEPTION 'a consult pro follow-up requires atomic content-free audit evidence' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$function$;

CREATE CONSTRAINT TRIGGER "ConsultProFollowUpQuestion_requires_asked_audit"
  AFTER INSERT ON "ConsultProFollowUpQuestion"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.consult_pro_follow_up_requires_asked_audit();

CREATE OR REPLACE FUNCTION public.consult_pro_follow_up_requires_answered_audit() RETURNS trigger
LANGUAGE plpgsql SET search_path TO '' AS $function$
BEGIN
  IF NEW."selectedValue" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public."ConsultAuditEvent"
    WHERE "proFollowUpQuestionId" = NEW."id"
      AND "consultSessionId" = NEW."consultSessionId"
      AND "action" = 'PRO_FOLLOW_UP_ANSWERED'
      AND "actorType" = 'CLIENT'
  ) THEN
    RAISE EXCEPTION 'a consult pro follow-up answer requires atomic content-free audit evidence' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$function$;

CREATE CONSTRAINT TRIGGER "ConsultProFollowUpQuestion_requires_answered_audit"
  AFTER UPDATE ON "ConsultProFollowUpQuestion"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.consult_pro_follow_up_requires_answered_audit();
