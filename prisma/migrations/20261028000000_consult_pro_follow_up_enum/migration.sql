-- C2-4 — the labels, on their own.
--
-- Labels only, in their own migration, for the reason 20261017000000 and
-- 20261016000000 give: Postgres requires a new enum label to COMMIT before a
-- later statement can name it, and a migration is one transaction. The table,
-- its guards and the audit whitelist that USE these labels follow in
-- 20261028000001.
CREATE TYPE "ConsultProFollowUpPriority" AS ENUM ('NEED_BEFORE_APPOINTMENT', 'HELPFUL_FOR_PREP');

ALTER TYPE "ConsultAuditAction" ADD VALUE 'PRO_FOLLOW_UP_ASKED';
ALTER TYPE "ConsultAuditAction" ADD VALUE 'PRO_FOLLOW_UP_ANSWERED';

ALTER TYPE "NotificationEventKey" ADD VALUE 'CONSULT_PRO_FOLLOW_UP' AFTER 'CONSULT_PREP_REMINDER';
