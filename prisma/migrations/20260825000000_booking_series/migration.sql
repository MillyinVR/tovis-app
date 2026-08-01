-- K18: recurring appointments — the series RULE, and the exceptions it records.
--
-- 🔴 The appointments a series produces are ordinary "Booking" rows. There is no
-- occurrence table and no stored RRULE expansion, because a virtual occurrence
-- is invisible to "Booking_no_active_professional_overlap", to holds, deposits,
-- reminders and closeout — it would not block a double-booking, which is the
-- entire point of a standing appointment. Membership is two additive columns on
-- "Booking" plus the unique pair that makes re-materialization idempotent.
--
-- 🔴 Nothing here touches "BookingStatus". That enum sits in the GIST overlap
-- predicate, in closeout, in refunds and in every write guard; series state is
-- its own columns, exactly as K11's client-confirmation timestamps had to be.
--
-- Additive and inert on arrival: every existing booking gets NULL on both new
-- columns, no table has a row until a pro creates a series, and series creation
-- is dark behind ENABLE_RECURRING_APPOINTMENTS in application code.

CREATE TYPE "BookingSeriesStatus" AS ENUM ('ACTIVE', 'ENDED', 'CANCELLED');

CREATE TYPE "BookingSeriesExceptionReason" AS ENUM (
  'SLOT_UNAVAILABLE',
  'NONEXISTENT_LOCAL_TIME',
  'REFUSED'
);

CREATE TABLE "BookingSeries" (
  "id"        TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  "professionalId"  TEXT NOT NULL,
  "clientId"        TEXT NOT NULL,
  "offeringId"      TEXT NOT NULL,
  "locationId"      TEXT NOT NULL,
  "locationType"    "ServiceLocationType" NOT NULL,
  "clientAddressId" TEXT,

  -- Add-ons chosen for every occurrence, as ids. Re-resolved and re-priced by
  -- the write boundary at each materialization exactly like a hand-created
  -- booking, so this records the pro's CHOICE, never a price snapshot.
  "addOnIds" TEXT[],

  -- The recurrence anchor: occurrence 0's UTC instant, plus the zone whose
  -- CALENDAR weeks the pattern steps through.
  --
  -- 🔴 Occurrence i is the anchor's local date + 7 * intervalWeeks * i days at
  -- the anchor's local time-of-day, resolved back to UTC in this zone — never
  -- anchor + i * 7 * 24h. Across a DST boundary those differ by an hour, and
  -- "every Friday at 9am" means 9am on both sides of it.
  "timeZone" VARCHAR(64) NOT NULL,
  "anchorAt" TIMESTAMP(3) NOT NULL,

  "intervalWeeks" INTEGER NOT NULL,
  -- Total planned occurrences, or NULL for open-ended. Until K20's roll-forward
  -- cron exists an open-ended series simply stops at the materialization
  -- horizon; it never promises appointments nobody will create.
  "occurrenceCount" INTEGER,

  "status" "BookingSeriesStatus" NOT NULL DEFAULT 'ACTIVE',

  -- The next index the materializer should attempt. Bookkeeping only: the
  -- durable idempotency is the unique (seriesId, seriesOccurrenceIndex) pair on
  -- "Booking" plus this series' own exception rows.
  "nextOccurrenceIndex" INTEGER NOT NULL DEFAULT 0,

  -- D7 (settled by Tori): a recurring occurrence's deposit is pro-configurable,
  -- chosen at creation. "depositRequested" is the gate; "depositPerOccurrence"
  -- picks first-occurrence-only vs every-occurrence. Two columns because they
  -- are two independent facts — a series can collect nothing at all.
  "depositRequested"     BOOLEAN NOT NULL DEFAULT false,
  "depositPerOccurrence" BOOLEAN NOT NULL DEFAULT false,

  "requestedBufferMinutes"        INTEGER,
  "requestedTotalDurationMinutes" INTEGER,

  -- The booking-rule overrides the pro authorized when creating the series.
  -- Stored rather than re-decided per occurrence, so K20's unattended cron can
  -- never grant an override the pro did not ask for.
  "allowOutsideWorkingHours" BOOLEAN NOT NULL DEFAULT false,
  "allowShortNotice"         BOOLEAN NOT NULL DEFAULT false,
  "allowFarFuture"           BOOLEAN NOT NULL DEFAULT false,
  "overrideReason"           TEXT,

  "internalNotes" TEXT,

  "createdByUserId" TEXT NOT NULL,

  CONSTRAINT "BookingSeries_pkey" PRIMARY KEY ("id")
);

-- An occurrence the materializer did NOT create, and why.
--
-- 🔴 The conflict policy decided in K18: a collision SKIPS that occurrence and
-- records it here. It never aborts the rest of the series, and it never silently
-- double-books. Occurrence 5 landing on an existing appointment must still leave
-- 6…12 standing, which is why each occurrence is materialized in its OWN
-- transaction — a refusal inside one Postgres transaction poisons every later
-- statement in it.
CREATE TABLE "BookingSeriesException" (
  "id"        TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  "seriesId"        TEXT NOT NULL,
  "occurrenceIndex" INTEGER NOT NULL,

  -- The UTC instant the occurrence would have taken. NULL only for
  -- NONEXISTENT_LOCAL_TIME, where there is no such instant — "detail" then
  -- carries the wall-clock time that does not exist.
  "intendedStart" TIMESTAMP(3),

  "reason" "BookingSeriesExceptionReason" NOT NULL,
  "detail" VARCHAR(500),

  CONSTRAINT "BookingSeriesException_pkey" PRIMARY KEY ("id")
);

-- Series membership on the appointment itself.
ALTER TABLE "Booking" ADD COLUMN "seriesId" TEXT;
ALTER TABLE "Booking" ADD COLUMN "seriesOccurrenceIndex" INTEGER;

-- One booking per occurrence index. This is the materializer's idempotency key:
-- re-running it cannot double-fill an index it already filled, whatever the
-- application-level bookkeeping says. NULLs are distinct in a Postgres unique
-- index, so every non-series booking is unaffected.
CREATE UNIQUE INDEX "Booking_seriesId_seriesOccurrenceIndex_key"
  ON "Booking" ("seriesId", "seriesOccurrenceIndex");

CREATE INDEX "Booking_seriesId_idx" ON "Booking" ("seriesId");

CREATE INDEX "BookingSeries_professionalId_status_idx"
  ON "BookingSeries" ("professionalId", "status");
CREATE INDEX "BookingSeries_clientId_idx" ON "BookingSeries" ("clientId");
CREATE INDEX "BookingSeries_offeringId_idx" ON "BookingSeries" ("offeringId");
CREATE INDEX "BookingSeries_locationId_idx" ON "BookingSeries" ("locationId");
CREATE INDEX "BookingSeries_clientAddressId_idx"
  ON "BookingSeries" ("clientAddressId");
CREATE INDEX "BookingSeries_createdByUserId_idx"
  ON "BookingSeries" ("createdByUserId");
-- K20's roll-forward cron sweeps ACTIVE series by how far they have been
-- materialized.
CREATE INDEX "BookingSeries_status_nextOccurrenceIndex_idx"
  ON "BookingSeries" ("status", "nextOccurrenceIndex");

-- One outcome per index: an occurrence is either a Booking or an exception,
-- never both and never twice.
CREATE UNIQUE INDEX "BookingSeriesException_seriesId_occurrenceIndex_key"
  ON "BookingSeriesException" ("seriesId", "occurrenceIndex");
CREATE INDEX "BookingSeriesException_seriesId_createdAt_idx"
  ON "BookingSeriesException" ("seriesId", "createdAt");

-- SET NULL, never CASCADE: removing a series must not take real appointments
-- with it. A detached booking is an ordinary appointment, which is exactly what
-- an occurrence always was.
ALTER TABLE "Booking"
  ADD CONSTRAINT "Booking_seriesId_fkey"
  FOREIGN KEY ("seriesId") REFERENCES "BookingSeries" ("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- CASCADE on both parties: a series is one pro's standing appointment for one
-- client and is meaningless once either is gone.
ALTER TABLE "BookingSeries"
  ADD CONSTRAINT "BookingSeries_professionalId_fkey"
  FOREIGN KEY ("professionalId") REFERENCES "ProfessionalProfile" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BookingSeries"
  ADD CONSTRAINT "BookingSeries_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "ClientProfile" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- RESTRICT on the offering and the location: both are re-read at every
-- materialization, so deleting one out from under a live series would silently
-- change what the client is booked for.
ALTER TABLE "BookingSeries"
  ADD CONSTRAINT "BookingSeries_offeringId_fkey"
  FOREIGN KEY ("offeringId") REFERENCES "ProfessionalServiceOffering" ("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BookingSeries"
  ADD CONSTRAINT "BookingSeries_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "ProfessionalLocation" ("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- SET NULL on the mobile destination, mirroring "Booking"."clientAddressId":
-- the next occurrence is then REFUSED and recorded as an exception, which is
-- visible, unlike a silent relocation.
ALTER TABLE "BookingSeries"
  ADD CONSTRAINT "BookingSeries_clientAddressId_fkey"
  FOREIGN KEY ("clientAddressId") REFERENCES "ClientAddress" ("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- RESTRICT on the author: the series carries an authorization (which booking
-- overrides the pro granted it), so it must not outlive the account that gave it.
ALTER TABLE "BookingSeries"
  ADD CONSTRAINT "BookingSeries_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BookingSeriesException"
  ADD CONSTRAINT "BookingSeriesException_seriesId_fkey"
  FOREIGN KEY ("seriesId") REFERENCES "BookingSeries" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
