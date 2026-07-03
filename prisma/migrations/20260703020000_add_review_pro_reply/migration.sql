-- Single public response from the reviewed pro on a review (additive).
ALTER TABLE "Review" ADD COLUMN "proReplyBody" TEXT;
ALTER TABLE "Review" ADD COLUMN "proReplyAt" TIMESTAMP(3);
