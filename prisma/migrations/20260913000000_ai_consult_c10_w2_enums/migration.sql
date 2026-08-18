-- PostgreSQL requires new enum labels to commit before later migrations may
-- reference them in tables, constraints, triggers, or functions.
ALTER TYPE "ConsultRevisionKind" ADD VALUE 'INSPIRATION' BEFORE 'ANALYSIS';
ALTER TYPE "ConsultAuditAction" ADD VALUE 'INSPIRATION_SOURCE_SELECTED';
ALTER TYPE "ConsultAuditAction" ADD VALUE 'INSPIRATION_UPLOAD_ISSUED';
ALTER TYPE "ConsultAuditAction" ADD VALUE 'INSPIRATION_UPLOAD_ATTACHED';
ALTER TYPE "ConsultAuditAction" ADD VALUE 'INSPIRATION_REMOVED';
ALTER TYPE "ConsultAuditAction" ADD VALUE 'INSPIRATION_RAW_PURGED';
CREATE TYPE "ConsultInspirationSource" AS ENUM ('PLATFORM_LOOK', 'BOOKED_PRO_LOOK', 'EXTERNAL_UPLOAD');
CREATE TYPE "ConsultInspirationStatus" AS ENUM ('UPLOAD_PENDING', 'ATTACHED', 'REPLACED', 'REMOVED');
