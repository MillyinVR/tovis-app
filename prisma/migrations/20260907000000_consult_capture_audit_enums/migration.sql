-- PostgreSQL requires enum additions to commit before later migrations may
-- reference them in constraints or data. Keep this expansion isolated.
ALTER TYPE "ConsultAuditAction" ADD VALUE 'CAPTURE_UPLOAD_ISSUED';
ALTER TYPE "ConsultAuditAction" ADD VALUE 'CAPTURE_ATTACHED';
ALTER TYPE "ConsultAuditAction" ADD VALUE 'CAPTURE_QUALITY_CHECKED';
ALTER TYPE "ConsultAuditAction" ADD VALUE 'CAPTURE_DELETED';
ALTER TYPE "ConsultAuditAction" ADD VALUE 'RAW_OBJECT_PURGED';
