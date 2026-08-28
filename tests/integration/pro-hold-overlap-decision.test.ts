// tests/integration/pro-hold-overlap-decision.test.ts
//
// The pro's live-hold decision, against real Postgres (Tori, 2026-08-28).
//
// B5 let a pro take minutes a client was mid-checkout on, silently. This suite
// pins the replacement end to end: the first attempt is REFUSED with a payload
// naming the service, the slot, the expiry and whether the held client is NEW
// or RETURNING to this pro — and a second attempt carrying the pro's answer
// books exactly as the silent path used to, with an audit line saying the
// choice was informed.
//
// It also pins what did NOT change, because the friction was scoped on purpose:
// booking over another BOOKING, and booking over a LAPSED hold, both still go
// through with no question asked.
//
// 🔴 The identity assertion is an ABSENCE assertion. Reading the payload and
// seeing the right fields proves nothing about the fields that should not be
// there — a shared DTO would have carried a name, an email and a phone as a
// matter of course. The test walks the serialized payload and fails on any key
// or value that could identify the held client.

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import {
  BookingSource,
  BookingStatus,
  Prisma,
  PrismaClient,
  ProfessionalLocationType,
  Role,
  ServiceLocationType,
} from '@prisma/client'

import { addMinutes } from '@/lib/booking/conflicts'
import { isBookingError, type BookingError } from '@/lib/booking/errors'
import { createProBooking, updateProBooking } from '@/lib/booking/writeBoundary'

vi.setConfig({ hookTimeout: 30_000 })

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error(
    'Missing DATABASE_URL. Run this test with: pnpm test:integration',
  )
}

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

const SERVICE_TITLE = 'Signature Manicure'

type TestClient = { userId: string; clientId: string }

type Fixtures = {
  tenantId: string
  serviceId: string
  proUserId: string
  professionalId: string
  salonLocationId: string
  offeringId: string
  /** No prior bookings with the pro — NEW. */
  newClient: TestClient
  /** Seeded with one COMPLETED booking with the pro — RETURNING. */
  returningClient: TestClient
  /** The client the pro is trying to book in each test. */
  walkIn: TestClient
}

let fixtures: Fixtures | null = null

function futureUtc(daysAhead: number, hour: number, minute = 0): Date {
  const d = new Date()
  d.setUTCSeconds(0, 0)
  d.setUTCMilliseconds(0)
  d.setUTCDate(d.getUTCDate() + daysAhead)
  d.setUTCHours(hour, minute, 0, 0)

  return d
}

function pastUtc(daysAgo: number, hour: number): Date {
  const d = futureUtc(-daysAgo, hour)
  return d
}

function workingHoursJson(): Prisma.InputJsonValue {
  return {
    mon: { enabled: true, start: '00:00', end: '23:59' },
    tue: { enabled: true, start: '00:00', end: '23:59' },
    wed: { enabled: true, start: '00:00', end: '23:59' },
    thu: { enabled: true, start: '00:00', end: '23:59' },
    fri: { enabled: true, start: '00:00', end: '23:59' },
    sat: { enabled: true, start: '00:00', end: '23:59' },
    sun: { enabled: true, start: '00:00', end: '23:59' },
  }
}

/**
 * A committed booking on the pro's calendar. Relation-connect form, matching the
 * sibling overlap suite — `Booking` requires BOTH tenant relations
 * (`proTenant` for revenue attribution, `clientHomeTenant`), which the scalar
 * shape does not satisfy.
 */
function bookingData(args: {
  tenantId: string
  clientId: string
  professionalId: string
  serviceId: string
  offeringId: string
  locationId: string
  start: Date
  status: BookingStatus
}): Prisma.BookingCreateInput {
  return {
    client: { connect: { id: args.clientId } },
    professional: { connect: { id: args.professionalId } },
    proTenant: { connect: { id: args.tenantId } },
    clientHomeTenant: { connect: { id: args.tenantId } },
    service: { connect: { id: args.serviceId } },
    offering: { connect: { id: args.offeringId } },
    location: { connect: { id: args.locationId } },
    scheduledFor: args.start,
    status: args.status,
    source: BookingSource.REQUESTED,
    locationType: ServiceLocationType.SALON,
    locationTimeZone: 'UTC',
    totalDurationMinutes: 60,
    bufferMinutes: 15,
    subtotalSnapshot: new Prisma.Decimal('100.00'),
  }
}

async function cleanupAll(): Promise<void> {
  await db.$executeRawUnsafe(`
    DO $cleanup$
    DECLARE
      r record;
      nonempty text[] := '{}';
      has_rows boolean;
    BEGIN
      FOR r IN
        SELECT tablename
        FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename <> '_prisma_migrations'
      LOOP
        EXECUTE format(
          'SELECT EXISTS (SELECT 1 FROM %I.%I LIMIT 1)', 'public', r.tablename
        ) INTO has_rows;

        IF has_rows THEN
          nonempty := nonempty || format('%I.%I', 'public', r.tablename);
        END IF;
      END LOOP;

      IF array_length(nonempty, 1) > 0 THEN
        EXECUTE 'TRUNCATE TABLE '
          || array_to_string(nonempty, ', ')
          || ' RESTART IDENTITY CASCADE';
      END IF;
    END
    $cleanup$;
  `)
}

/**
 * The identifying details a client profile carries. Every one of these is
 * seeded onto the HELD client so the absence assertion has something real to
 * fail on — a payload that leaked a name would have to leak THIS name.
 */
const HELD_CLIENT_IDENTITY = {
  firstName: 'Marguerite',
  lastName: 'Okonkwo',
  email: 'marguerite.okonkwo@example.com',
  phone: '+15558675309',
}

async function seedClient(args: {
  tag: string
  index: number
  tenantId: string
  identity?: { firstName: string; lastName: string; email: string; phone: string }
}): Promise<TestClient> {
  const user = await db.user.create({
    data: {
      email: args.identity?.email ?? `${args.tag}_client_${args.index}@example.com`,
      password: 'test-password',
      role: Role.CLIENT,
    },
    select: { id: true },
  })

  const client = await db.clientProfile.create({
    data: {
      userId: user.id,
      homeTenantId: args.tenantId,
      firstName: args.identity?.firstName ?? `Client ${args.index}`,
      lastName: args.identity?.lastName ?? 'Hold',
      ...(args.identity?.phone ? { phone: args.identity.phone } : {}),
    },
    select: { id: true },
  })

  return { userId: user.id, clientId: client.id }
}

async function seedFixtures(): Promise<Fixtures> {
  const tag = `hold_decision_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 8)}`

  const tenant = await db.tenant.upsert({
    where: { slug: 'tovis-root' },
    update: {},
    create: { slug: 'tovis-root', name: 'TOVIS', isActive: true },
    select: { id: true },
  })

  const [newClient, returningClient, walkIn] = await Promise.all([
    seedClient({
      tag,
      index: 1,
      tenantId: tenant.id,
      identity: HELD_CLIENT_IDENTITY,
    }),
    seedClient({ tag, index: 2, tenantId: tenant.id }),
    seedClient({ tag, index: 3, tenantId: tenant.id }),
  ])

  const proUser = await db.user.create({
    data: { email: `${tag}_pro@example.com`, password: 'test-password', role: Role.PRO },
    select: { id: true },
  })

  const professional = await db.professionalProfile.create({
    data: {
      userId: proUser.id,
      homeTenantId: tenant.id,
      firstName: 'Hold',
      lastName: 'Decision',
      businessName: 'Hold Decision Studio',
      timeZone: 'UTC',
    },
    select: { id: true },
  })

  const category = await db.serviceCategory.create({
    data: { name: `${tag} Category`, slug: `${tag}-category`, isActive: true },
    select: { id: true },
  })

  const service = await db.service.create({
    data: {
      name: `${tag} Catalog Manicure`,
      categoryId: category.id,
      defaultDurationMinutes: 60,
      minPrice: new Prisma.Decimal('100.00'),
      isActive: true,
    },
    select: { id: true },
  })

  const salonLocation = await db.professionalLocation.create({
    data: {
      professionalId: professional.id,
      type: ProfessionalLocationType.SALON,
      name: 'Main Salon',
      isPrimary: true,
      isBookable: true,
      formattedAddress: '123 Salon St, San Diego, CA 92101',
      addressLine1: '123 Salon St',
      city: 'San Diego',
      state: 'CA',
      postalCode: '92101',
      countryCode: 'US',
      lat: new Prisma.Decimal('32.7157000'),
      lng: new Prisma.Decimal('-117.1611000'),
      timeZone: 'UTC',
      workingHours: workingHoursJson(),
      bufferMinutes: 15,
      stepMinutes: 15,
      advanceNoticeMinutes: 0,
      maxDaysAhead: 365,
    },
    select: { id: true },
  })

  const offering = await db.professionalServiceOffering.create({
    data: {
      professionalId: professional.id,
      serviceId: service.id,
      // The pro's OWN name for it — what the popup must show, not the catalog
      // service name (`offeringDisplayName`).
      title: SERVICE_TITLE,
      isActive: true,
      offersInSalon: true,
      offersMobile: false,
      salonPriceStartingAt: new Prisma.Decimal('100.00'),
      salonDurationMinutes: 60,
    },
    select: { id: true },
  })

  // What makes `returningClient` returning: one prior COMPLETED visit with THIS
  // pro — the canonical `establishedBookingCount` arm.
  await db.booking.create({
    data: bookingData({
      tenantId: tenant.id,
      clientId: returningClient.clientId,
      professionalId: professional.id,
      serviceId: service.id,
      offeringId: offering.id,
      locationId: salonLocation.id,
      start: pastUtc(30, 12),
      status: BookingStatus.COMPLETED,
    }),
  })

  return {
    tenantId: tenant.id,
    serviceId: service.id,
    proUserId: proUser.id,
    professionalId: professional.id,
    salonLocationId: salonLocation.id,
    offeringId: offering.id,
    newClient,
    returningClient,
    walkIn,
  }
}

function requireFixtures(): Fixtures {
  if (!fixtures) throw new Error('Fixtures not initialized')
  return fixtures
}

async function createHold(args: {
  clientId: string | null
  start: Date
  expiresAt: Date
}): Promise<string> {
  const fx = requireFixtures()

  const hold = await db.bookingHold.create({
    data: {
      offeringId: fx.offeringId,
      professionalId: fx.professionalId,
      clientId: args.clientId,
      scheduledFor: args.start,
      expiresAt: args.expiresAt,
      locationType: ServiceLocationType.SALON,
      locationId: fx.salonLocationId,
      locationTimeZone: 'UTC',
      durationMinutesSnapshot: 60,
      bufferMinutesSnapshot: 15,
      endsAtSnapshot: addMinutes(args.start, 75),
    },
    select: { id: true },
  })

  return hold.id
}

function proCreateAttempt(args: { clientId: string; scheduledFor: Date }) {
  const fx = requireFixtures()

  return {
    professionalId: fx.professionalId,
    actorUserId: fx.proUserId,
    clientId: args.clientId,
    offeringId: fx.offeringId,
    locationId: fx.salonLocationId,
    locationType: ServiceLocationType.SALON,
    scheduledFor: args.scheduledFor,
    clientAddressId: null,
    internalNotes: null,
    overrideReason: null,
    requestedBufferMinutes: null,
    requestedTotalDurationMinutes: null,
    allowOutsideWorkingHours: false,
    allowShortNotice: false,
    allowFarFuture: false,
  }
}

async function expectRefusal(promise: Promise<unknown>): Promise<BookingError> {
  const outcome = await promise.then(
    () => null,
    (error: unknown) => error,
  )

  if (!isBookingError(outcome)) {
    throw new Error(
      `expected a BookingError, got: ${
        outcome instanceof Error ? outcome.message : String(outcome)
      }`,
    )
  }

  return outcome
}

/** Every `booking_conflict` line this test's console.warn spy captured. */
function conflictLines(
  warn: ReturnType<typeof vi.spyOn>,
): Array<Record<string, unknown>> {
  return warn.mock.calls
    .map(([first]) => {
      if (typeof first !== 'string') return null
      try {
        return JSON.parse(first) as Record<string, unknown>
      } catch {
        return null
      }
    })
    .filter(
      (parsed): parsed is Record<string, unknown> =>
        parsed !== null && parsed.event === 'booking_conflict',
    )
}

beforeAll(async () => {
  await cleanupAll()
})

afterAll(async () => {
  await cleanupAll()
  await db.$disconnect()
})

beforeEach(async () => {
  await cleanupAll()
  fixtures = await seedFixtures()
})

afterEach(async () => {
  vi.restoreAllMocks()
  fixtures = null
  await cleanupAll()
})

describe('a pro booking over a live client hold', () => {
  it('refuses with the decision payload, and calls a first-time client NEW', async () => {
    const fx = requireFixtures()
    const start = futureUtc(7, 12)
    const expiresAt = addMinutes(new Date(), 9)

    const holdId = await createHold({
      clientId: fx.newClient.clientId,
      start,
      expiresAt,
    })

    const refusal = await expectRefusal(
      createProBooking(
        proCreateAttempt({ clientId: fx.walkIn.clientId, scheduledFor: start }),
      ),
    )

    expect(refusal.code).toBe('HOLD_OVERLAP_NEEDS_CONFIRMATION')
    expect(refusal.httpStatus).toBe(409)
    expect(refusal.heldSlot).toEqual({
      holdId,
      relationship: 'NEW',
      // The PRO's own title for the offering, not the catalog service name.
      serviceName: SERVICE_TITLE,
      startsAt: start.toISOString(),
      endsAt: addMinutes(start, 75).toISOString(),
      expiresAt: expiresAt.toISOString(),
      additionalHeldSlots: 0,
    })

    // Refused means refused: no booking row, and the hold is untouched.
    await expect(
      db.booking.count({
        where: { professionalId: fx.professionalId, scheduledFor: start },
      }),
    ).resolves.toBe(0)
    await expect(
      db.bookingHold.count({ where: { id: holdId } }),
    ).resolves.toBe(1)
  })

  it('calls a client who has booked this pro before RETURNING', async () => {
    const fx = requireFixtures()
    const start = futureUtc(8, 12)

    await createHold({
      clientId: fx.returningClient.clientId,
      start,
      expiresAt: addMinutes(new Date(), 9),
    })

    const refusal = await expectRefusal(
      createProBooking(
        proCreateAttempt({ clientId: fx.walkIn.clientId, scheduledFor: start }),
      ),
    )

    expect(refusal.heldSlot?.relationship).toBe('RETURNING')
  })

  it('says UNKNOWN rather than inventing "new" for a hold with no client', async () => {
    const fx = requireFixtures()
    const start = futureUtc(9, 12)

    await createHold({ clientId: null, start, expiresAt: addMinutes(new Date(), 9) })

    const refusal = await expectRefusal(
      createProBooking(
        proCreateAttempt({ clientId: fx.walkIn.clientId, scheduledFor: start }),
      ),
    )

    expect(refusal.heldSlot?.relationship).toBe('UNKNOWN')
  })

  // 🔴 The whole point of B5's anonymity, asserted as an ABSENCE. The held
  // client's real name, email, phone and profile id are all seeded above; if
  // any of them — or any key that could carry one — reaches the payload, this
  // fails. Serializing first means a value nested anywhere is caught too.
  it('leaks nothing that identifies the held client', async () => {
    const fx = requireFixtures()
    const start = futureUtc(10, 12)

    await createHold({
      clientId: fx.newClient.clientId,
      start,
      expiresAt: addMinutes(new Date(), 9),
    })

    const refusal = await expectRefusal(
      createProBooking(
        proCreateAttempt({ clientId: fx.walkIn.clientId, scheduledFor: start }),
      ),
    )

    const wire = JSON.stringify(refusal.heldSlot)

    for (const secret of [
      HELD_CLIENT_IDENTITY.firstName,
      HELD_CLIENT_IDENTITY.lastName,
      HELD_CLIENT_IDENTITY.email,
      HELD_CLIENT_IDENTITY.phone,
      fx.newClient.clientId,
      fx.newClient.userId,
    ]) {
      expect(wire).not.toContain(secret)
    }

    // ...and the shape is closed, not merely free of today's values: a future
    // field named `clientName` would pass the scan above on a fixture whose
    // name happened to change, but never this.
    expect(Object.keys(refusal.heldSlot ?? {}).sort()).toEqual([
      'additionalHeldSlots',
      'endsAt',
      'expiresAt',
      'holdId',
      'relationship',
      'serviceName',
      'startsAt',
    ])

    // The user-facing message must not name them either — it is rendered
    // verbatim by any surface that does not know the code.
    expect(refusal.userMessage).not.toContain(HELD_CLIENT_IDENTITY.firstName)
  })

  // ⚠️ Reaching TWO live holds takes a WIDENED booking, not two stacked
  // reservations: `BookingHold_no_active_professional_overlap` forbids two live
  // holds from covering the same minutes at all, so the only way one attempt
  // meets several is by asking for a window long enough to span them. That
  // makes `additionalHeldSlots > 0` rare — and worth saying out loud when it
  // happens, because the popup otherwise reads as though one client is in the
  // way when several are.
  it('counts, rather than hides, further live holds the same attempt would cover', async () => {
    const fx = requireFixtures()
    const start = futureUtc(11, 12)

    // 12:00–13:15 and 14:00–15:15 — adjacent, not overlapping, so both live.
    const firstHoldId = await createHold({
      clientId: fx.newClient.clientId,
      start,
      expiresAt: addMinutes(new Date(), 9),
    })
    await createHold({
      clientId: fx.returningClient.clientId,
      start: addMinutes(start, 120),
      expiresAt: addMinutes(new Date(), 9),
    })

    const refusal = await expectRefusal(
      createProBooking({
        ...proCreateAttempt({
          clientId: fx.walkIn.clientId,
          scheduledFor: start,
        }),
        // A three-hour appointment from 12:00 covers both reservations.
        requestedTotalDurationMinutes: 180,
      }),
    )

    // The earliest-starting hold is the one described...
    expect(refusal.heldSlot?.holdId).toBe(firstHoldId)
    // ...and the other is COUNTED, so the popup never implies a single client.
    expect(refusal.heldSlot?.additionalHeldSlots).toBe(1)
  })
})

describe("the pro's explicit confirmation", () => {
  it('books the appointment and records the choice as informed, with the label shown', async () => {
    const fx = requireFixtures()
    const start = futureUtc(12, 12)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const holdId = await createHold({
      clientId: fx.returningClient.clientId,
      start,
      expiresAt: addMinutes(new Date(), 9),
    })

    const result = await createProBooking({
      ...proCreateAttempt({ clientId: fx.walkIn.clientId, scheduledFor: start }),
      confirmHoldOverlap: true,
    })

    const created = await db.booking.findUnique({
      where: { id: result.booking.id },
      select: { status: true, allowsOverlap: true },
    })

    expect(created?.status).toBe(BookingStatus.ACCEPTED)
    // Exempted from the DB EXCLUDE constraint, exactly as the silent path did.
    expect(created?.allowsOverlap).toBe(true)

    const authorized = conflictLines(warn).filter(
      (line) => line.note === 'overlap_authorized',
    )

    expect(authorized).toHaveLength(1)
    const line = authorized[0]
    if (!line) throw new Error('expected an authorized-overlap log line')
    const meta = line.meta as Record<string, unknown>

    // Which pro, which hold, when, the label SHOWN, and that it was informed.
    expect(line.professionalId).toBe(fx.professionalId)
    expect(line.holdId).toBe(holdId)
    expect(line.conflictType).toBe('HOLD')
    expect(typeof line.loggedAt).toBe('string')
    expect(meta.overlapDecisionMode).toBe('PRO_CONFIRMED_HOLD_OVERLAP')
    expect(meta.heldSlotRelationship).toBe('RETURNING')
    expect(meta.informedChoice).toBe(true)
    expect(meta.overlappedHoldIds).toEqual([holdId])

    // 🔴 And the audit line does NOT name the held client either — the holdId
    // is the trace, the pairing stays undisclosed.
    const serialized = JSON.stringify(line)
    expect(serialized).not.toContain(fx.returningClient.clientId)
    expect(serialized).not.toContain(fx.returningClient.userId)
  })

  it('re-derives the label at the write instead of trusting the retry', async () => {
    const fx = requireFixtures()
    const start = futureUtc(13, 12)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    // A hold by a client the pro has never seen: the confirming request carries
    // only a boolean, so the only way the log can say NEW is by asking again.
    await createHold({
      clientId: fx.newClient.clientId,
      start,
      expiresAt: addMinutes(new Date(), 9),
    })

    await createProBooking({
      ...proCreateAttempt({ clientId: fx.walkIn.clientId, scheduledFor: start }),
      confirmHoldOverlap: true,
    })

    const line = conflictLines(warn).find(
      (entry) => entry.note === 'overlap_authorized',
    )

    if (!line) throw new Error('expected an authorized-overlap log line')
    expect((line.meta as Record<string, unknown>).heldSlotRelationship).toBe(
      'NEW',
    )
  })
})

describe('what the decision deliberately does NOT touch', () => {
  it('books over another appointment with no question asked', async () => {
    const fx = requireFixtures()
    const start = futureUtc(14, 12)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await db.booking.create({
      data: bookingData({
        tenantId: fx.tenantId,
        clientId: fx.returningClient.clientId,
        professionalId: fx.professionalId,
        serviceId: fx.serviceId,
        offeringId: fx.offeringId,
        locationId: fx.salonLocationId,
        start,
        status: BookingStatus.ACCEPTED,
      }),
    })

    // No confirmHoldOverlap, and no refusal: B5's pro authority over another
    // appointment is untouched.
    const result = await createProBooking(
      proCreateAttempt({
        clientId: fx.walkIn.clientId,
        scheduledFor: addMinutes(start, 30),
      }),
    )

    const created = await db.booking.findUnique({
      where: { id: result.booking.id },
      select: { allowsOverlap: true },
    })

    expect(created?.allowsOverlap).toBe(true)

    // The gap this closes: the authorized overlap is now RECORDED, and honestly
    // marked as the uninformed kind — nobody was mid-checkout, so nobody was
    // asked.
    const line = conflictLines(warn).find(
      (entry) => entry.note === 'overlap_authorized',
    )

    if (!line) throw new Error('expected an authorized-overlap log line')
    const meta = line.meta as Record<string, unknown>
    expect(meta.overlapDecisionMode).toBe('PRO_AUTHORIZED_OVERLAP')
    expect(meta.informedChoice).toBe(false)
    expect(meta.heldSlotRelationship).toBeUndefined()
    expect(line.conflictType).toBe('BOOKING')
  })

  it('books over a LAPSED hold with no question asked', async () => {
    const fx = requireFixtures()
    const start = futureUtc(15, 12)

    // Expired a minute ago. Every conflict query filters `expiresAt > now`, so
    // these minutes are genuinely free and adding friction here would be
    // friction over nothing.
    await createHold({
      clientId: fx.newClient.clientId,
      start,
      expiresAt: addMinutes(new Date(), -1),
    })

    const result = await createProBooking(
      proCreateAttempt({ clientId: fx.walkIn.clientId, scheduledFor: start }),
    )

    const created = await db.booking.findUnique({
      where: { id: result.booking.id },
      select: { status: true, allowsOverlap: true },
    })

    expect(created?.status).toBe(BookingStatus.ACCEPTED)
    // No conflict at all, so the row stays BOUND by the DB constraint.
    expect(created?.allowsOverlap).toBe(false)
  })

  it('logs nothing extra for an ordinary booking with no conflicts', async () => {
    const fx = requireFixtures()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await createProBooking(
      proCreateAttempt({
        clientId: fx.walkIn.clientId,
        scheduledFor: futureUtc(16, 12),
      }),
    )

    expect(conflictLines(warn)).toHaveLength(0)
  })
})

// The second case Tori asked to cover: the client is mid-checkout on the
// client-facing flow while the pro books them by phone. It needs NO separate
// detection — the conflict query finds every live hold on the pro's minutes,
// whoever placed it — and the label reads RETURNING for a client the pro has
// booked before, which is the useful implicit signal.
//
// ⚠️ It reads NEW for a client the pro has never booked, even though the pro is
// looking at that client's name on their own screen. That is correct: the label
// answers "have I seen this person before?", not "is this the person I am
// booking?". Pinned so nobody later mistakes it for a bug.
describe('a pro booking the very client who holds the slot', () => {
  it('falls out of the ordinary hold check, and reads RETURNING for a known client', async () => {
    const fx = requireFixtures()
    const start = futureUtc(17, 12)

    const holdId = await createHold({
      clientId: fx.returningClient.clientId,
      start,
      expiresAt: addMinutes(new Date(), 9),
    })

    const refusal = await expectRefusal(
      createProBooking(
        proCreateAttempt({
          clientId: fx.returningClient.clientId,
          scheduledFor: start,
        }),
      ),
    )

    expect(refusal.code).toBe('HOLD_OVERLAP_NEEDS_CONFIRMATION')
    expect(refusal.heldSlot?.holdId).toBe(holdId)
    expect(refusal.heldSlot?.relationship).toBe('RETURNING')
  })

  it('reads NEW when the pro has never booked them, hold or no hold', async () => {
    const fx = requireFixtures()
    const start = futureUtc(18, 12)

    await createHold({
      clientId: fx.newClient.clientId,
      start,
      expiresAt: addMinutes(new Date(), 9),
    })

    const refusal = await expectRefusal(
      createProBooking(
        proCreateAttempt({
          clientId: fx.newClient.clientId,
          scheduledFor: start,
        }),
      ),
    )

    expect(refusal.heldSlot?.relationship).toBe('NEW')
  })
})

describe('a pro RESCHEDULING onto a live client hold', () => {
  it('asks the same question, and books on the same confirmation', async () => {
    const fx = requireFixtures()
    const originalStart = futureUtc(19, 8)
    const heldStart = futureUtc(19, 12)

    const booking = await createProBooking(
      proCreateAttempt({
        clientId: fx.walkIn.clientId,
        scheduledFor: originalStart,
      }),
    )

    const holdId = await createHold({
      clientId: fx.returningClient.clientId,
      start: heldStart,
      expiresAt: addMinutes(new Date(), 9),
    })

    const reschedule = {
      professionalId: fx.professionalId,
      actorUserId: fx.proUserId,
      overrideReason: null,
      bookingId: booking.booking.id,
      nextStatus: null,
      notifyClient: false,
      allowOutsideWorkingHours: false,
      allowShortNotice: false,
      allowFarFuture: false,
      nextStart: heldStart,
      nextBuffer: null,
      nextDuration: null,
      parsedRequestedItems: null,
      hasBuffer: false,
      hasDuration: false,
      hasServiceItems: false,
    }

    const refusal = await expectRefusal(updateProBooking(reschedule))

    expect(refusal.code).toBe('HOLD_OVERLAP_NEEDS_CONFIRMATION')
    expect(refusal.heldSlot?.holdId).toBe(holdId)
    expect(refusal.heldSlot?.relationship).toBe('RETURNING')

    // Nothing moved.
    await expect(
      db.booking
        .findUnique({
          where: { id: booking.booking.id },
          select: { scheduledFor: true },
        })
        .then((row) => row?.scheduledFor.toISOString()),
    ).resolves.toBe(originalStart.toISOString())

    await updateProBooking({ ...reschedule, confirmHoldOverlap: true })

    const moved = await db.booking.findUnique({
      where: { id: booking.booking.id },
      select: { scheduledFor: true, allowsOverlap: true },
    })

    expect(moved?.scheduledFor.toISOString()).toBe(heldStart.toISOString())
    expect(moved?.allowsOverlap).toBe(true)
  })
})
