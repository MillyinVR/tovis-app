-- P4, slice 1 of 2: the enum label only.
--
-- PostgreSQL requires a new enum label to COMMIT before any later migration
-- may name it in a table, constraint, trigger, or function. The C10-W2
-- inspiration work split for the same reason
-- (20260913000000_ai_consult_c10_w2_enums); this keeps that convention.
ALTER TYPE "ConsultRevisionKind" ADD VALUE 'INSPIRATION_ANALYSIS' BEFORE 'ANALYSIS';
