-- AlterTable: client media-use consent (B3b). Additive, nullable (expand phase).
-- When set, the client granted the pro the right to feature this session's media
-- publicly via the aftercare summary — a second public-share unlock alongside
-- review-promotion (lib/media/publicShareGuard.ts). Unlocks the pro's publish
-- action; does NOT auto-make any asset public.
ALTER TABLE "Booking" ADD COLUMN     "mediaUseConsentAt" TIMESTAMP(3);
