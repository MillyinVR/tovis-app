-- W7: explicit, per-location "publish this address" consent.
--
-- `/api/v1/search/pros` and `/api/v1/pros/nearby` are unauthenticated, so they
-- redact every location they return — address and placeId nulled, coordinates
-- coarsened to ~1.1km. Discover's Navigate button was then built on top of that
-- deliberately-inaccurate point, which is why it routed to "a random address":
-- Maps received a fuzzed lat/lng with no address and snapped to the nearest
-- building. For a mobile-only pro the only location with coordinates is their
-- MOBILE_BASE, so Navigate pointed at a fuzzed version of their home.
--
-- DEFAULT false for EVERY location, SALON included. Nothing becomes public as a
-- result of this migration — a pro whose "salon" is really a home studio must
-- not be exposed by an inference about their location type. Publishing is the
-- pro's explicit act, made in `app/pro/locations`.
ALTER TABLE "ProfessionalLocation"
  ADD COLUMN "isAddressPublic" BOOLEAN NOT NULL DEFAULT false;
