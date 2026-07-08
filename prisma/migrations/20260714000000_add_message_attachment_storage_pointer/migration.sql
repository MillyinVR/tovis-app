-- Private message attachments store a media-private storage pointer that the
-- thread read routes sign at fetch time (the bytes are never world-readable).
-- `url` becomes optional: private attachments rely on the pointer, legacy/public
-- ones keep a directly-renderable URL. Additive + nullable → back-compat.

ALTER TABLE "MessageAttachment" ALTER COLUMN "url" DROP NOT NULL;
ALTER TABLE "MessageAttachment" ADD COLUMN "storageBucket" TEXT;
ALTER TABLE "MessageAttachment" ADD COLUMN "storagePath" TEXT;
