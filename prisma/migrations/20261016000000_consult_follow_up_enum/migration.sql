-- P5g, slice 1 of 2: the enum labels only.
--
-- PostgreSQL requires a new enum label to COMMIT before any later migration may
-- name it in a table, constraint, trigger, or function, and Prisma wraps each
-- migration in a transaction. Same reason and same shape as
-- 20261015000000_consult_rerun_audit_enum,
-- 20261013000000_consult_early_photo_enum and
-- 20261007000000_consult_inspiration_analysis_enum; this keeps that convention.
--
-- FOLLOW_UP_QUESTIONS is the fifth paid consult call: a small text-only request
-- that reads the look analysis, the client's own photo analysis and everything
-- she has said so far, and answers with the next one to three questions. It is
-- metered like the other four (lib/consult/providerMeter.ts) — the enum in the
-- schema is that file's checklist, and a call kind missing from it is a cost
-- line nobody can find.
ALTER TYPE "ConsultProviderCallKind" ADD VALUE 'FOLLOW_UP_QUESTIONS' AFTER 'ANALYSIS_DIRECTION';

-- One round ends in exactly one of three states, and they are not
-- interchangeable:
--   GENERATED — the model answered and its questions are what she is asked.
--   FALLBACK  — the call failed and she is being asked the pack's own
--               remaining SAFETY questions instead. Part 0 rule 4: never the
--               old static list, never silence.
--   REFUSED   — the model refused, or answered something the sanitizer would
--               not accept. Distinct from FALLBACK's cause so the two can be
--               told apart in the meter without reading logs.
CREATE TYPE "ConsultFollowUpRoundStatus" AS ENUM ('GENERATED', 'FALLBACK', 'REFUSED');
