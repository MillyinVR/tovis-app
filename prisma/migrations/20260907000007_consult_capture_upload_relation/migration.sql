-- A capture cannot outlive or be forged independently from its server-minted
-- upload row. Cascading through the upload still executes the capture's
-- verified-purge delete guard.
ALTER TABLE "ConsultCapture"
  ADD CONSTRAINT "ConsultCapture_uploadSessionId_fkey"
  FOREIGN KEY ("uploadSessionId") REFERENCES "UploadSession"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
