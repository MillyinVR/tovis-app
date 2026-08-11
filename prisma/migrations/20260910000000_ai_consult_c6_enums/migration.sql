-- PostgreSQL requires new enum values to commit before later migrations may
-- reference them in constraints, triggers, or data. Keep this expansion alone.
ALTER TYPE "NotificationEventKey" ADD VALUE 'AI_CONSULT_INVITATION';
ALTER TYPE "ConsultAuditAction" ADD VALUE 'BRIEF_FEEDBACK_RECORDED';
