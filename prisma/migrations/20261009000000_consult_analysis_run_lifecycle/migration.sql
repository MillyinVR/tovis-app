-- P4b: the analysis run lifecycle and the provider-call meter.
--
-- Two new tables, no change to any existing one. The consult lifecycle
-- triggers, the one-analysis-per-session index, and the one-claim-transition
-- index are all deliberately UNTOUCHED: a retry stays inside ANALYZING and
-- takes a new run row, so nothing here needs the claim to happen twice.

CREATE TYPE "ConsultAnalysisRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');
CREATE TYPE "ConsultAnalysisRunStage" AS ENUM ('QUEUED', 'READING_PHOTOS', 'UNDERSTANDING_REFERENCE', 'BUILDING_PLAN', 'FINALIZING', 'DONE');
CREATE TYPE "ConsultProviderCallKind" AS ENUM ('CAPTURE_GATE', 'INSPIRATION_READ', 'ANALYSIS_PROFILE', 'ANALYSIS_DIRECTION');
CREATE TYPE "ConsultProviderCallOutcome" AS ENUM ('OK', 'REFUSED', 'BAD_OUTPUT', 'UNAVAILABLE');

CREATE TABLE "ConsultAnalysisRun" (
    "id" TEXT NOT NULL,
    "consultSessionId" TEXT NOT NULL,
    "status" "ConsultAnalysisRunStatus" NOT NULL DEFAULT 'QUEUED',
    "stage" "ConsultAnalysisRunStage" NOT NULL DEFAULT 'QUEUED',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "idempotencyKey" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "photoCount" INTEGER NOT NULL DEFAULT 0,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "failureCode" TEXT,
    "lastError" TEXT,
    "analysisRevisionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConsultAnalysisRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ConsultProviderCall" (
    "id" TEXT NOT NULL,
    "consultSessionId" TEXT NOT NULL,
    "analysisRunId" TEXT,
    "kind" "ConsultProviderCallKind" NOT NULL,
    "outcome" "ConsultProviderCallOutcome" NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheCreationInputTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheReadInputTokens" INTEGER NOT NULL DEFAULT 0,
    "latencyMs" INTEGER NOT NULL,
    "costMicroUsd" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsultProviderCall_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ConsultAnalysisRun_status_runAt_createdAt_id_idx" ON "ConsultAnalysisRun"("status", "runAt", "createdAt", "id");
CREATE INDEX "ConsultAnalysisRun_consultSessionId_createdAt_idx" ON "ConsultAnalysisRun"("consultSessionId", "createdAt");
CREATE INDEX "ConsultProviderCall_consultSessionId_createdAt_idx" ON "ConsultProviderCall"("consultSessionId", "createdAt");
CREATE INDEX "ConsultProviderCall_analysisRunId_createdAt_idx" ON "ConsultProviderCall"("analysisRunId", "createdAt");
CREATE INDEX "ConsultProviderCall_createdAt_idx" ON "ConsultProviderCall"("createdAt");

ALTER TABLE "ConsultAnalysisRun" ADD CONSTRAINT "ConsultAnalysisRun_consultSessionId_fkey" FOREIGN KEY ("consultSessionId") REFERENCES "ConsultSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConsultProviderCall" ADD CONSTRAINT "ConsultProviderCall_consultSessionId_fkey" FOREIGN KEY ("consultSessionId") REFERENCES "ConsultSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConsultProviderCall" ADD CONSTRAINT "ConsultProviderCall_analysisRunId_fkey" FOREIGN KEY ("analysisRunId") REFERENCES "ConsultAnalysisRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Structural rules the application must not be the only thing enforcing ──

-- A run's counters and lease are only ever meaningful within these bounds.
ALTER TABLE "ConsultAnalysisRun"
  ADD CONSTRAINT "ConsultAnalysisRun_attempts_sane"
  CHECK (
    "maxAttempts" BETWEEN 1 AND 10
    AND "attemptCount" >= 0
    AND "attemptCount" <= "maxAttempts"
    AND "photoCount" >= 0
    AND "photoCount" <= 7
  );

-- Terminal runs are finished; live runs are not. A COMPLETED run that never
-- recorded a finish, or a QUEUED run that claims one, is a bookkeeping bug —
-- and this is the column the client's "is it done?" poll trusts.
ALTER TABLE "ConsultAnalysisRun"
  ADD CONSTRAINT "ConsultAnalysisRun_terminal_is_finished"
  CHECK (
    CASE "status"
      WHEN 'QUEUED' THEN "finishedAt" IS NULL
      WHEN 'RUNNING' THEN "finishedAt" IS NULL AND "startedAt" IS NOT NULL
      WHEN 'COMPLETED' THEN "finishedAt" IS NOT NULL AND "startedAt" IS NOT NULL
      WHEN 'FAILED' THEN "finishedAt" IS NOT NULL
    END
  );

-- A COMPLETED run points at the artefact it wrote; a FAILED one names why.
-- Without this the client could be shown "ready" with nothing to open, or
-- "we couldn't finish" with no code to drive the retry copy.
ALTER TABLE "ConsultAnalysisRun"
  ADD CONSTRAINT "ConsultAnalysisRun_outcome_is_explained"
  CHECK (
    ("status" <> 'COMPLETED' OR "analysisRevisionId" IS NOT NULL)
    AND ("status" <> 'FAILED' OR "failureCode" IS NOT NULL)
  );

-- Only ONE live run per consult. Two workers holding two runs for one session
-- would both pay for a full analysis and race on the finalize; the second
-- would lose to `one_analysis_per_session` after spending the money. A retry
-- is therefore only possible once the previous run has actually stopped.
CREATE UNIQUE INDEX "ConsultAnalysisRun_one_live_run_per_session"
  ON "ConsultAnalysisRun" ("consultSessionId")
  WHERE "status" IN ('QUEUED', 'RUNNING');

-- The meter's own arithmetic. Token counts and latency are never negative,
-- and a priced row is priced in whole millionths of a dollar.
ALTER TABLE "ConsultProviderCall"
  ADD CONSTRAINT "ConsultProviderCall_measurements_sane"
  CHECK (
    "inputTokens" >= 0
    AND "outputTokens" >= 0
    AND "cacheCreationInputTokens" >= 0
    AND "cacheReadInputTokens" >= 0
    AND "latencyMs" >= 0
    AND ("costMicroUsd" IS NULL OR "costMicroUsd" >= 0)
  );

-- A metered call belongs to the session its run belongs to. Without this the
-- per-consult cost roll-up could silently attribute one client's spend to
-- another's consult.
CREATE OR REPLACE FUNCTION "consult_provider_call_run_matches_session"()
RETURNS TRIGGER AS $$
DECLARE
  run_session TEXT;
BEGIN
  IF NEW."analysisRunId" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT "consultSessionId" INTO run_session
  FROM public."ConsultAnalysisRun"
  WHERE "id" = NEW."analysisRunId";

  IF run_session IS DISTINCT FROM NEW."consultSessionId" THEN
    RAISE EXCEPTION 'provider call % is attributed to a run from another consult', NEW."id"
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION "consult_provider_call_run_matches_session"() SET search_path = '';

CREATE TRIGGER "consult_provider_call_run_matches_session_trigger"
  BEFORE INSERT OR UPDATE ON "ConsultProviderCall"
  FOR EACH ROW EXECUTE FUNCTION "consult_provider_call_run_matches_session"();

-- Every new public table needs its OWN grant. RLS propagates from nowhere; only
-- tests/integration/database-hardening.test.ts catches the omission. Neither
-- table is reachable by the anon role at all — both are written and read
-- exclusively through the server's service-role client — so deny-by-default
-- with no policy is the correct posture, not an unfinished one.
ALTER TABLE "ConsultAnalysisRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ConsultProviderCall" ENABLE ROW LEVEL SECURITY;
