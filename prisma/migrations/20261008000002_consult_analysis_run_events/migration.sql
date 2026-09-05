-- P4b: the two notifications a background analysis run can send.
--
-- PostgreSQL requires new enum values to commit before later migrations may
-- reference them in constraints, triggers, or data. Keep this expansion alone,
-- and ahead of 20261009000000_consult_analysis_run_lifecycle.
ALTER TYPE "NotificationEventKey" ADD VALUE 'AI_CONSULT_ANALYSIS_READY';
ALTER TYPE "NotificationEventKey" ADD VALUE 'AI_CONSULT_ANALYSIS_FAILED';
