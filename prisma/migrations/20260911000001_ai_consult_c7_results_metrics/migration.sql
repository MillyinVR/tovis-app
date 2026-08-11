-- The application serializes both writes on ConsultSession. This database
-- invariant is the final concurrency backstop: retries and simultaneous RSC /
-- API loads cannot create two singular product facts.
ALTER TABLE "ConsultAuditEvent" DROP CONSTRAINT "ConsultAuditEvent_shape";
ALTER TABLE "ConsultAuditEvent"
  ADD CONSTRAINT "ConsultAuditEvent_shape" CHECK (
    ("action" = 'SESSION_CREATED' AND "fromStatus" IS NULL AND "toStatus" IS NOT NULL)
    OR ("action" = 'AGREEMENT_ACCEPTED' AND "agreementAcceptanceId" IS NOT NULL)
    OR ("action" = 'AGREEMENT_REVOKED' AND "agreementAcceptanceId" IS NOT NULL)
    OR ("action" = 'LIFECYCLE_TRANSITIONED' AND "fromStatus" IS NOT NULL AND "toStatus" IS NOT NULL)
    OR ("action" = 'REVISION_CREATED' AND "revisionId" IS NOT NULL)
    OR ("action" = 'CAPTURE_UPLOAD_ISSUED'
      AND "captureId" IS NULL AND "agreementAcceptanceId" IS NULL
      AND "revisionId" IS NULL AND "fromStatus" IS NULL AND "toStatus" IS NULL)
    OR ("action" IN ('CAPTURE_ATTACHED', 'CAPTURE_QUALITY_CHECKED', 'CAPTURE_DELETED')
      AND "captureId" IS NOT NULL AND "agreementAcceptanceId" IS NULL
      AND "revisionId" IS NULL AND "fromStatus" IS NULL AND "toStatus" IS NULL)
    OR ("action" = 'RAW_OBJECT_PURGED'
      AND "agreementAcceptanceId" IS NULL AND "revisionId" IS NULL
      AND "fromStatus" IS NULL AND "toStatus" IS NULL)
    OR ("action" = 'BRIEF_FEEDBACK_RECORDED'
      AND "briefFeedbackId" IS NOT NULL AND "agreementAcceptanceId" IS NULL
      AND "revisionId" IS NULL AND "captureId" IS NULL
      AND "fromStatus" IS NULL AND "toStatus" IS NULL)
    OR ("action" IN ('CLIENT_RESULTS_SERVED', 'ME_CARD_TEASER_TAPPED')
      AND "briefFeedbackId" IS NULL AND "agreementAcceptanceId" IS NULL
      AND "revisionId" IS NULL AND "captureId" IS NULL
      AND "fromStatus" IS NULL AND "toStatus" IS NULL)
  );

CREATE UNIQUE INDEX "ConsultAuditEvent_singular_client_result_action"
  ON "ConsultAuditEvent" ("consultSessionId", "action")
  WHERE "action" IN (
    'CLIENT_RESULTS_SERVED'::"ConsultAuditAction",
    'ME_CARD_TEASER_TAPPED'::"ConsultAuditAction"
  );
