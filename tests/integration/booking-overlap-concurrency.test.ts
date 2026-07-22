import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest'
import {
  BookingSource,
  BookingStatus,
  ClientAddressKind,
  Prisma,
  PrismaClient,
  ProfessionalLocationType,
  Role,
  ServiceLocationType,
} from '@prisma/client'

import { addMinutes } from '@/lib/booking/conflicts'
import {
  findBookingAndHoldConflicts,
  getTimeRangeConflict,
} from '@/lib/booking/conflictQueries'
import {
  BOOKING_BLOCKING_STATUSES,
  BOOKING_OVERLAP_CONSTRAINT_NAME,
  HOLD_OVERLAP_CONSTRAINT_NAME,
} from '@/lib/booking/constants'
import { createProBooking } from '@/lib/booking/writeBoundary'
import { deleteExpiredHoldsForProfessional } from '@/lib/booking/holdCleanup'
import { lockProfessionalSchedule } from '@/lib/booking/scheduleLock'

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error(
    'Missing DATABASE_URL. Run this test with: pnpm test:integration',
  )
}

const db = new PrismaClient({
  datasources: {
    db: {
      url: databaseUrl,
    },
  },
})

const BOOKING_OVERLAP_CONSTRAINT = BOOKING_OVERLAP_CONSTRAINT_NAME

type TestClient = {
  userId: string
  clientId: string
  clientAddressId: string
}

type Fixtures = {
  tenantId: string
  categoryId: string
  serviceId: string
  proUserId: string
  professionalId: string
  salonLocationId: string
  suiteLocationId: string
  mobileBaseLocationId: string
  offeringId: string
  clients: [TestClient, TestClient]
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

function workingHoursJson(): Prisma.InputJsonValue {
  return {
    mon: { enabled: true, start: '09:00', end: '18:00' },
    tue: { enabled: true, start: '09:00', end: '18:00' },
    wed: { enabled: true, start: '09:00', end: '18:00' },
    thu: { enabled: true, start: '09:00', end: '18:00' },
    fri: { enabled: true, start: '09:00', end: '18:00' },
    sat: { enabled: true, start: '09:00', end: '18:00' },
    sun: { enabled: true, start: '09:00', end: '18:00' },
  }
}

/**
 * Wipe the test database between tests.
 *
 * This used to be a hand-ordered chain of ~30 unfiltered `deleteMany({})` calls
 * walking the FK graph leaf-first. That chain rotted silently as the schema
 * grew: it deleted `Service` before `ServicePermission` and `ClientProfile`
 * before `ClientAllergy`, so against any database that had been through
 * `pnpm db:test:seed` every test in this file died in `beforeEach` on a foreign
 * key violation — and because `test:integration` runs in no CI workflow, nothing
 * caught it. (See docs/design/scheduling-conflict-audit-fix-plan.md, F11.)
 *
 * A generated `TRUNCATE ... CASCADE` cannot drift: new tables are picked up
 * automatically and CASCADE resolves the ordering. This is no more destructive
 * than what it replaces — the old chain already wiped `User`/`Service`/
 * `ClientProfile` unfiltered, so this suite has always assumed it owns the
 * database. Only ever point DATABASE_URL at a throwaway test DB.
 */
async function cleanupAll(): Promise<void> {
  // Table names come from pg_tables, never from test input, so interpolating
  // them into the TRUNCATE is safe — identifiers cannot be parameterized.
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename <> '_prisma_migrations'
  `

  if (tables.length === 0) return

  const quoted = tables
    .map((row) => `"public"."${row.tablename}"`)
    .join(', ')

  await db.$executeRawUnsafe(
    `TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`,
  )
}

async function seedClient(
  tag: string,
  index: number,
  tenantId: string,
): Promise<TestClient> {
  const user = await db.user.create({
    data: {
      email: `${tag}_client_${index}@example.com`,
      password: 'test-password',
      role: Role.CLIENT,
    },
    select: { id: true },
  })

  const client = await db.clientProfile.create({
    data: {
      userId: user.id,
      homeTenantId: tenantId,
      firstName: `Client ${index}`,
      lastName: 'Overlap',
    },
    select: { id: true },
  })

  const address = await db.clientAddress.create({
    data: {
      clientId: client.id,
      kind: ClientAddressKind.SERVICE_ADDRESS,
      label: 'Home',
      formattedAddress: `${index} Client Ave, San Diego, CA 92101`,
      addressLine1: `${index} Client Ave`,
      city: 'San Diego',
      state: 'CA',
      postalCode: '92101',
      countryCode: 'US',
      lat: new Prisma.Decimal('32.7157000'),
      lng: new Prisma.Decimal('-117.1611000'),
    },
    select: { id: true },
  })

  return {
    userId: user.id,
    clientId: client.id,
    clientAddressId: address.id,
  }
}

async function seedFixtures(): Promise<Fixtures> {
  const tag = `booking_overlap_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 8)}`

  const tenant = await db.tenant.upsert({
    where: { slug: 'tovis-root' },
    update: {},
    create: { slug: 'tovis-root', name: 'TOVIS', isActive: true },
    select: { id: true },
  })

  const clients = await Promise.all([
    seedClient(tag, 1, tenant.id),
    seedClient(tag, 2, tenant.id),
  ])

  const proUser = await db.user.create({
    data: {
      email: `${tag}_pro@example.com`,
      password: 'test-password',
      role: Role.PRO,
    },
    select: { id: true },
  })

  const professional = await db.professionalProfile.create({
    data: {
      userId: proUser.id,
      homeTenantId: tenant.id,
      firstName: 'Concurrency',
      lastName: 'Pro',
      businessName: 'Concurrency Studio',
      timeZone: 'America/Los_Angeles',
    },
    select: { id: true },
  })

  const category = await db.serviceCategory.create({
    data: {
      name: `${tag} Category`,
      slug: `${tag}-category`,
      isActive: true,
    },
    select: { id: true },
  })

  const service = await db.service.create({
    data: {
      name: `${tag} Haircut`,
      categoryId: category.id,
      defaultDurationMinutes: 60,
      minPrice: new Prisma.Decimal('100.00'),
      allowMobile: true,
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
      timeZone: 'America/Los_Angeles',
      workingHours: workingHoursJson(),
      bufferMinutes: 15,
      stepMinutes: 15,
      advanceNoticeMinutes: 0,
      maxDaysAhead: 365,
    },
    select: { id: true },
  })

  const suiteLocation = await db.professionalLocation.create({
    data: {
      professionalId: professional.id,
      type: ProfessionalLocationType.SUITE,
      name: 'Suite Room',
      isPrimary: false,
      isBookable: true,
      formattedAddress: '456 Suite Ave, San Diego, CA 92101',
      addressLine1: '456 Suite Ave',
      city: 'San Diego',
      state: 'CA',
      postalCode: '92101',
      countryCode: 'US',
      lat: new Prisma.Decimal('32.7160000'),
      lng: new Prisma.Decimal('-117.1620000'),
      timeZone: 'America/Los_Angeles',
      workingHours: workingHoursJson(),
      bufferMinutes: 15,
      stepMinutes: 15,
      advanceNoticeMinutes: 0,
      maxDaysAhead: 365,
    },
    select: { id: true },
  })

  const mobileBaseLocation = await db.professionalLocation.create({
    data: {
      professionalId: professional.id,
      type: ProfessionalLocationType.MOBILE_BASE,
      name: 'Mobile Base',
      isPrimary: false,
      isBookable: true,
      formattedAddress: '999 Mobile Base, San Diego, CA 92101',
      addressLine1: '999 Mobile Base',
      city: 'San Diego',
      state: 'CA',
      postalCode: '92101',
      countryCode: 'US',
      lat: new Prisma.Decimal('32.7170000'),
      lng: new Prisma.Decimal('-117.1630000'),
      timeZone: 'America/Los_Angeles',
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
      isActive: true,
      offersInSalon: true,
      offersMobile: true,
      salonPriceStartingAt: new Prisma.Decimal('100.00'),
      mobilePriceStartingAt: new Prisma.Decimal('120.00'),
      salonDurationMinutes: 60,
      mobileDurationMinutes: 60,
    },
    select: { id: true },
  })

  return {
    tenantId: tenant.id,
    categoryId: category.id,
    serviceId: service.id,
    proUserId: proUser.id,
    professionalId: professional.id,
    salonLocationId: salonLocation.id,
    suiteLocationId: suiteLocation.id,
    mobileBaseLocationId: mobileBaseLocation.id,
    offeringId: offering.id,
    clients,
  }
}

function bookingData(args: {
  tenantId: string
  clientId: string
  professionalId: string
  serviceId: string
  offeringId: string
  start: Date
  locationId: string
  locationType: ServiceLocationType
  clientAddressId?: string | null
  status?: BookingStatus
  durationMinutes?: number
  bufferMinutes?: number
  allowsOverlap?: boolean
}): Prisma.BookingCreateInput {
  const durationMinutes = args.durationMinutes ?? 60
  const bufferMinutes = args.bufferMinutes ?? 15
  const isMobile = args.locationType === ServiceLocationType.MOBILE

  return {
    allowsOverlap: args.allowsOverlap ?? false,
    client: {
      connect: {
        id: args.clientId,
      },
    },
    professional: {
      connect: {
        id: args.professionalId,
      },
    },
    proTenant: {
      connect: {
        id: args.tenantId,
      },
    },
    clientHomeTenant: {
      connect: {
        id: args.tenantId,
      },
    },
    service: {
      connect: {
        id: args.serviceId,
      },
    },
    offering: {
      connect: {
        id: args.offeringId,
      },
    },
    scheduledFor: args.start,
    status: args.status ?? BookingStatus.ACCEPTED,
    source: BookingSource.REQUESTED,
    locationType: args.locationType,
    location: {
      connect: {
        id: args.locationId,
      },
    },
    locationTimeZone: 'America/Los_Angeles',
    locationAddressSnapshot:
      args.locationType === ServiceLocationType.SALON
        ? { formattedAddress: '123 Salon St, San Diego, CA 92101' }
        : { formattedAddress: '999 Mobile Base, San Diego, CA 92101' },
    locationLatSnapshot: 32.7157,
    locationLngSnapshot: -117.1611,
    clientAddress: isMobile
      ? {
          connect: {
            id: args.clientAddressId ?? '',
          },
        }
      : undefined,
    clientAddressSnapshot: isMobile
      ? { formattedAddress: '1 Client Ave, San Diego, CA 92101' }
      : Prisma.JsonNull,
    clientAddressLatSnapshot: isMobile ? 32.7157 : null,
    clientAddressLngSnapshot: isMobile ? -117.1611 : null,
    subtotalSnapshot: new Prisma.Decimal('100.00'),
    serviceSubtotalSnapshot: new Prisma.Decimal('100.00'),
    totalAmount: new Prisma.Decimal('100.00'),
    totalDurationMinutes: durationMinutes,
    bufferMinutes,
  }
}

async function createDirectBooking(args: {
  clientId: string
  start: Date
  locationId: string
  locationType: ServiceLocationType
  clientAddressId?: string | null
  professionalId?: string
  serviceId?: string
  offeringId?: string
  status?: BookingStatus
  durationMinutes?: number
  bufferMinutes?: number
  allowsOverlap?: boolean
}): Promise<string> {
  if (!fixtures) throw new Error('Fixtures not initialized')

  const fx = fixtures
  const isMobile = args.locationType === ServiceLocationType.MOBILE

  const booking = await db.booking.create({
    data: bookingData({
      tenantId: fx.tenantId,
      clientId: args.clientId,
      professionalId: args.professionalId ?? fx.professionalId,
      serviceId: args.serviceId ?? fx.serviceId,
      offeringId: args.offeringId ?? fx.offeringId,
      start: args.start,
      locationId: args.locationId,
      locationType: args.locationType,
      clientAddressId: isMobile
        ? (args.clientAddressId ?? fx.clients[0].clientAddressId)
        : null,
      status: args.status,
      durationMinutes: args.durationMinutes,
      bufferMinutes: args.bufferMinutes,
      allowsOverlap: args.allowsOverlap,
    }),
    select: { id: true },
  })

  return booking.id
}

async function createLockedBooking(args: {
  clientId: string
  start: Date
  locationId: string
  locationType: ServiceLocationType
  clientAddressId?: string | null
  durationMinutes?: number
  bufferMinutes?: number
  sleepSecondsAfterCheck?: number
}): Promise<string> {
  if (!fixtures) throw new Error('Fixtures not initialized')

  const fx = fixtures
  const durationMinutes = args.durationMinutes ?? 60
  const bufferMinutes = args.bufferMinutes ?? 15
  const requestedEnd = addMinutes(args.start, durationMinutes + bufferMinutes)

  return db.$transaction(async (tx) => {
    await lockProfessionalSchedule(tx, fx.professionalId)

    const conflict = await getTimeRangeConflict({
      tx,
      professionalId: fx.professionalId,
      locationId: args.locationId,
      requestedStart: args.start,
      requestedEnd,
      defaultBufferMinutes: bufferMinutes,
      fallbackDurationMinutes: durationMinutes,
    })

    if (conflict) {
      throw new Error(conflict)
    }

    if (args.sleepSecondsAfterCheck && args.sleepSecondsAfterCheck > 0) {
      await tx.$executeRaw`SELECT pg_sleep(${args.sleepSecondsAfterCheck})`
    }

    const booking = await tx.booking.create({
      data: bookingData({
        tenantId: fx.tenantId,
        clientId: args.clientId,
        professionalId: fx.professionalId,
        serviceId: fx.serviceId,
        offeringId: fx.offeringId,
        start: args.start,
        locationId: args.locationId,
        locationType: args.locationType,
        clientAddressId:
          args.locationType === ServiceLocationType.MOBILE
            ? (args.clientAddressId ?? fx.clients[0].clientAddressId)
            : null,
        status: BookingStatus.ACCEPTED,
        durationMinutes,
        bufferMinutes,
      }),
      select: { id: true },
    })

    return booking.id
  })
}

async function createLockedHold(args: {
  clientId: string
  start: Date
  locationId: string
  locationType: ServiceLocationType
  clientAddressId?: string | null
  expiresAt?: Date
  durationMinutes?: number
  bufferMinutes?: number
  sleepSecondsAfterCheck?: number
}): Promise<string> {
  if (!fixtures) throw new Error('Fixtures not initialized')

  const fx = fixtures
  const durationMinutes = args.durationMinutes ?? 60
  const bufferMinutes = args.bufferMinutes ?? 15
  const requestedEnd = addMinutes(args.start, durationMinutes + bufferMinutes)

  return db.$transaction(async (tx) => {
    await lockProfessionalSchedule(tx, fx.professionalId)

    const conflict = await getTimeRangeConflict({
      tx,
      professionalId: fx.professionalId,
      locationId: args.locationId,
      requestedStart: args.start,
      requestedEnd,
      defaultBufferMinutes: bufferMinutes,
      fallbackDurationMinutes: durationMinutes,
    })

    if (conflict) {
      throw new Error(conflict)
    }

    if (args.sleepSecondsAfterCheck && args.sleepSecondsAfterCheck > 0) {
      await tx.$executeRaw`SELECT pg_sleep(${args.sleepSecondsAfterCheck})`
    }

    const hold = await tx.bookingHold.create({
      data: {
        offeringId: fx.offeringId,
        professionalId: fx.professionalId,
        clientId: args.clientId,
        scheduledFor: args.start,
        expiresAt: args.expiresAt ?? addMinutes(new Date(), 15),
        locationType: args.locationType,
        locationId: args.locationId,
        locationTimeZone: 'America/Los_Angeles',
        locationAddressSnapshot:
          args.locationType === ServiceLocationType.SALON
            ? { formattedAddress: '123 Salon St, San Diego, CA 92101' }
            : { formattedAddress: '999 Mobile Base, San Diego, CA 92101' },
        locationLatSnapshot: 32.7157,
        locationLngSnapshot: -117.1611,
        clientAddressId:
          args.locationType === ServiceLocationType.MOBILE
            ? (args.clientAddressId ?? fx.clients[0].clientAddressId)
            : null,
        clientAddressSnapshot:
          args.locationType === ServiceLocationType.MOBILE
            ? { formattedAddress: '1 Client Ave, San Diego, CA 92101' }
            : Prisma.JsonNull,
        clientAddressLatSnapshot:
          args.locationType === ServiceLocationType.MOBILE ? 32.7157 : null,
        clientAddressLngSnapshot:
          args.locationType === ServiceLocationType.MOBILE ? -117.1611 : null,
        durationMinutesSnapshot: durationMinutes,
        bufferMinutesSnapshot: bufferMinutes,
        endsAtSnapshot: requestedEnd,
      },
      select: { id: true },
    })

    return hold.id
  })
}

// Inserts a hold straight into the table with no schedule lock and no app-level
// conflict check — exercises the database overlap constraint directly.
async function createDirectHold(args: {
  clientId: string
  start: Date
  locationId: string
  locationType: ServiceLocationType
  durationMinutes?: number
  bufferMinutes?: number
  expiresAt?: Date
}): Promise<string> {
  if (!fixtures) throw new Error('Fixtures not initialized')

  const isMobile = args.locationType === ServiceLocationType.MOBILE
  const durationMinutes = args.durationMinutes ?? 60
  const bufferMinutes = args.bufferMinutes ?? 15
  const requestedEnd = addMinutes(args.start, durationMinutes + bufferMinutes)

  const hold = await db.bookingHold.create({
    data: {
      offeringId: fixtures.offeringId,
      professionalId: fixtures.professionalId,
      clientId: args.clientId,
      scheduledFor: args.start,
      expiresAt: args.expiresAt ?? addMinutes(new Date(), 15),
      locationType: args.locationType,
      locationId: args.locationId,
      locationTimeZone: 'America/Los_Angeles',
      locationAddressSnapshot: {
        formattedAddress: '123 Salon St, San Diego, CA 92101',
      },
      locationLatSnapshot: 32.7157,
      locationLngSnapshot: -117.1611,
      clientAddressId: isMobile
        ? (fixtures.clients[0].clientAddressId ?? null)
        : null,
      clientAddressSnapshot: isMobile
        ? { formattedAddress: '1 Client Ave, San Diego, CA 92101' }
        : Prisma.JsonNull,
      clientAddressLatSnapshot: isMobile ? 32.7157 : null,
      clientAddressLngSnapshot: isMobile ? -117.1611 : null,
      durationMinutesSnapshot: durationMinutes,
      bufferMinutesSnapshot: bufferMinutes,
      endsAtSnapshot: requestedEnd,
    },
    select: { id: true },
  })

  return hold.id
}

function createExpiredHold(args: {
  clientId: string
  start: Date
  locationId: string
  locationType: ServiceLocationType
}): Promise<string> {
  return createDirectHold({
    ...args,
    expiresAt: addMinutes(new Date(), -1),
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function partitionSettled(results: readonly PromiseSettledResult<unknown>[]) {
  const fulfilled: PromiseFulfilledResult<unknown>[] = []
  const rejected: PromiseRejectedResult[] = []

  for (const result of results) {
    if (result.status === 'fulfilled') {
      fulfilled.push(result)
    } else {
      rejected.push(result)
    }
  }

  return { fulfilled, rejected }
}

function expectExactlyOneSuccess(
  results: readonly PromiseSettledResult<unknown>[],
) {
  const { fulfilled, rejected } = partitionSettled(results)

  expect(fulfilled).toHaveLength(1)
  expect(rejected).toHaveLength(1)

  const firstRejected = rejected[0]
  if (firstRejected === undefined) {
    throw new Error('Expected exactly one rejected result')
  }

  return { fulfilled, rejected, firstRejected }
}

function getRejectedText(result: PromiseRejectedResult): string {
  const reason = result.reason

  if (reason instanceof Error) {
    return reason.message
  }

  return String(reason)
}

function errorText(error: unknown): string {
  if (error instanceof Error) {
    return [
      error.name,
      error.message,
      'cause' in error ? String(error.cause) : '',
    ].join('\n')
  }

  return String(error)
}

async function expectDbConstraintRejection(
  constraintName: string,
  action: () => Promise<unknown>,
): Promise<void> {
  try {
    await action()
  } catch (error: unknown) {
    expect(errorText(error)).toContain(constraintName)
    return
  }

  throw new Error(
    `Expected database overlap constraint ${constraintName} to reject the write.`,
  )
}

function expectDbBookingOverlapRejection(
  action: () => Promise<unknown>,
): Promise<void> {
  return expectDbConstraintRejection(BOOKING_OVERLAP_CONSTRAINT, action)
}

function expectDbHoldOverlapRejection(
  action: () => Promise<unknown>,
): Promise<void> {
  return expectDbConstraintRejection(HOLD_OVERLAP_CONSTRAINT_NAME, action)
}

beforeAll(async () => {
  await db.$connect()
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
  await cleanupAll()
  fixtures = null
})

describe('booking overlap concurrency integration', () => {
  it('serializes overlapping client holds so only one active hold persists', async () => {
    if (!fixtures) throw new Error('Missing fixtures')

    const startA = futureUtc(7, 18, 0)
    const startB = futureUtc(7, 18, 30)

    const p1 = createLockedHold({
      clientId: fixtures.clients[0].clientId,
      start: startA,
      locationId: fixtures.salonLocationId,
      locationType: ServiceLocationType.SALON,
      sleepSecondsAfterCheck: 0.25,
    })

    await sleep(25)

    const p2 = createLockedHold({
      clientId: fixtures.clients[1].clientId,
      start: startB,
      locationId: fixtures.salonLocationId,
      locationType: ServiceLocationType.SALON,
    })

    const results = await Promise.allSettled([p1, p2])
    const { firstRejected } = expectExactlyOneSuccess(results)

    expect(getRejectedText(firstRejected)).toContain('HOLD')

    await expect(
      db.bookingHold.count({
        where: {
          professionalId: fixtures.professionalId,
          expiresAt: { gt: new Date() },
        },
      }),
    ).resolves.toBe(1)
  })

  it('serializes exact-start client holds so the same schedule slot cannot double-hold', async () => {
    if (!fixtures) throw new Error('Missing fixtures')

    const start = futureUtc(8, 18, 0)

    const p1 = createLockedHold({
      clientId: fixtures.clients[0].clientId,
      start,
      locationId: fixtures.salonLocationId,
      locationType: ServiceLocationType.SALON,
      sleepSecondsAfterCheck: 0.25,
    })

    await sleep(25)

    const p2 = createLockedHold({
      clientId: fixtures.clients[1].clientId,
      start,
      locationId: fixtures.salonLocationId,
      locationType: ServiceLocationType.SALON,
    })

    const results = await Promise.allSettled([p1, p2])
    const { firstRejected } = expectExactlyOneSuccess(results)

    expect(getRejectedText(firstRejected)).toContain('HOLD')

    await expect(
      db.bookingHold.count({
        where: {
          professionalId: fixtures.professionalId,
          expiresAt: { gt: new Date() },
        },
      }),
    ).resolves.toBe(1)
  })

  it('serializes overlapping bookings so only one booking persists', async () => {
    if (!fixtures) throw new Error('Missing fixtures')

    const startA = futureUtc(9, 18, 0)
    const startB = futureUtc(9, 18, 30)

    const p1 = createLockedBooking({
      clientId: fixtures.clients[0].clientId,
      start: startA,
      locationId: fixtures.salonLocationId,
      locationType: ServiceLocationType.SALON,
      sleepSecondsAfterCheck: 0.25,
    })

    await sleep(25)

    const p2 = createLockedBooking({
      clientId: fixtures.clients[1].clientId,
      start: startB,
      locationId: fixtures.salonLocationId,
      locationType: ServiceLocationType.SALON,
    })

    const results = await Promise.allSettled([p1, p2])
    const { firstRejected } = expectExactlyOneSuccess(results)

    expect(getRejectedText(firstRejected)).toContain('BOOKING')

    await expect(
      db.booking.count({
        where: { professionalId: fixtures.professionalId },
      }),
    ).resolves.toBe(1)
  })

  it('blocks exact-start booking creation even when two writes race', async () => {
    if (!fixtures) throw new Error('Missing fixtures')

    const start = futureUtc(10, 18, 0)

    const p1 = createLockedBooking({
      clientId: fixtures.clients[0].clientId,
      start,
      locationId: fixtures.salonLocationId,
      locationType: ServiceLocationType.SALON,
      sleepSecondsAfterCheck: 0.25,
    })

    await sleep(25)

    const p2 = createLockedBooking({
      clientId: fixtures.clients[1].clientId,
      start,
      locationId: fixtures.salonLocationId,
      locationType: ServiceLocationType.SALON,
    })

    const results = await Promise.allSettled([p1, p2])
    const { firstRejected } = expectExactlyOneSuccess(results)

    expect(getRejectedText(firstRejected)).toContain('BOOKING')

    await expect(
      db.booking.count({
        where: { professionalId: fixtures.professionalId },
      }),
    ).resolves.toBe(1)
  })

  it('blocks overlapping bookings across different salon locations for the same professional', async () => {
    if (!fixtures) throw new Error('Missing fixtures')

    const startA = futureUtc(11, 18, 0)
    const startB = futureUtc(11, 18, 30)

    await createLockedBooking({
      clientId: fixtures.clients[0].clientId,
      start: startA,
      locationId: fixtures.salonLocationId,
      locationType: ServiceLocationType.SALON,
    })

    await expect(
      createLockedBooking({
        clientId: fixtures.clients[1].clientId,
        start: startB,
        locationId: fixtures.suiteLocationId,
        locationType: ServiceLocationType.SALON,
      }),
    ).rejects.toThrow('BOOKING')

    await expect(
      db.booking.count({
        where: { professionalId: fixtures.professionalId },
      }),
    ).resolves.toBe(1)
  })

  it('blocks overlapping bookings across salon and mobile modes for the same professional', async () => {
    if (!fixtures) throw new Error('Missing fixtures')

    const startA = futureUtc(12, 18, 0)
    const startB = futureUtc(12, 18, 30)

    await createLockedBooking({
      clientId: fixtures.clients[0].clientId,
      start: startA,
      locationId: fixtures.salonLocationId,
      locationType: ServiceLocationType.SALON,
    })

    await expect(
      createLockedBooking({
        clientId: fixtures.clients[1].clientId,
        start: startB,
        locationId: fixtures.mobileBaseLocationId,
        locationType: ServiceLocationType.MOBILE,
        clientAddressId: fixtures.clients[1].clientAddressId,
      }),
    ).rejects.toThrow('BOOKING')

    await expect(
      db.booking.count({
        where: { professionalId: fixtures.professionalId },
      }),
    ).resolves.toBe(1)
  })

  it('blocks booking creation when an active hold already occupies the overlapping interval', async () => {
    if (!fixtures) throw new Error('Missing fixtures')

    const holdStart = futureUtc(13, 18, 30)

    await createLockedHold({
      clientId: fixtures.clients[0].clientId,
      start: holdStart,
      locationId: fixtures.salonLocationId,
      locationType: ServiceLocationType.SALON,
    })

    await expect(
      createLockedBooking({
        clientId: fixtures.clients[1].clientId,
        start: futureUtc(13, 18, 45),
        locationId: fixtures.salonLocationId,
        locationType: ServiceLocationType.SALON,
      }),
    ).rejects.toThrow('HOLD')

    await expect(
      db.booking.count({
        where: { professionalId: fixtures.professionalId },
      }),
    ).resolves.toBe(0)

    await expect(
      db.bookingHold.count({
        where: {
          professionalId: fixtures.professionalId,
          expiresAt: { gt: new Date() },
        },
      }),
    ).resolves.toBe(1)
  })

  it('does not let an expired hold block a booking while cleanup races the booking write', async () => {
    if (!fixtures) throw new Error('Missing fixtures')

    const fx = fixtures
    const start = futureUtc(14, 18, 0)
    const now = new Date()

    const expiredHoldId = await createExpiredHold({
      clientId: fx.clients[0].clientId,
      start,
      locationId: fx.salonLocationId,
      locationType: ServiceLocationType.SALON,
    })

    const results = await Promise.allSettled([
      createLockedBooking({
        clientId: fx.clients[1].clientId,
        start,
        locationId: fx.salonLocationId,
        locationType: ServiceLocationType.SALON,
        sleepSecondsAfterCheck: 0.25,
      }),
      db.$transaction((tx) =>
        deleteExpiredHoldsForProfessional({
          tx,
          professionalId: fx.professionalId,
          now,
        }),
      ),
    ])

    const { fulfilled, rejected } = partitionSettled(results)

    expect(fulfilled).toHaveLength(2)
    expect(rejected).toHaveLength(0)

    await expect(
      db.booking.count({
        where: { professionalId: fx.professionalId },
      }),
    ).resolves.toBe(1)

    await expect(
      db.bookingHold.count({
        where: { id: expiredHoldId },
      }),
    ).resolves.toBe(0)
  })

  it('database rejects direct overlapping active bookings for the same professional', async () => {
    if (!fixtures) throw new Error('Missing fixtures')

    const fx = fixtures

    const startA = futureUtc(15, 18, 0)
    const startB = futureUtc(15, 18, 30)

    await createDirectBooking({
      clientId: fx.clients[0].clientId,
      start: startA,
      locationId: fx.salonLocationId,
      locationType: ServiceLocationType.SALON,
      status: BookingStatus.ACCEPTED,
      durationMinutes: 60,
      bufferMinutes: 15,
    })

    await expectDbBookingOverlapRejection(() =>
      createDirectBooking({
        clientId: fx.clients[1].clientId,
        start: startB,
        locationId: fx.salonLocationId,
        locationType: ServiceLocationType.SALON,
        status: BookingStatus.PENDING,
        durationMinutes: 60,
        bufferMinutes: 15,
      }),
    )

    await expect(
      db.booking.count({
        where: {
          professionalId: fx.professionalId,
        },
      }),
    ).resolves.toBe(1)
  })

  it('database ALLOWS an overlapping booking flagged allowsOverlap (authorized PRO/ADMIN double-book)', async () => {
    if (!fixtures) throw new Error('Missing fixtures')

    const fx = fixtures
    const startA = futureUtc(17, 18, 0)
    const startB = futureUtc(17, 18, 30)

    await createDirectBooking({
      clientId: fx.clients[0].clientId,
      start: startA,
      locationId: fx.salonLocationId,
      locationType: ServiceLocationType.SALON,
      status: BookingStatus.ACCEPTED,
      durationMinutes: 60,
      bufferMinutes: 15,
    })

    // The authorized overlap carries the flag → exempt from the EXCLUDE
    // constraint → the insert succeeds instead of raising 23P01.
    await createDirectBooking({
      clientId: fx.clients[1].clientId,
      start: startB,
      locationId: fx.salonLocationId,
      locationType: ServiceLocationType.SALON,
      status: BookingStatus.ACCEPTED,
      durationMinutes: 60,
      bufferMinutes: 15,
      allowsOverlap: true,
    })

    await expect(
      db.booking.count({ where: { professionalId: fx.professionalId } }),
    ).resolves.toBe(2)
  })

  it('a flagged (allowsOverlap) booking does not block a later NORMAL booking on the same slot', async () => {
    if (!fixtures) throw new Error('Missing fixtures')

    const fx = fixtures
    const startA = futureUtc(18, 18, 0)
    const startB = futureUtc(18, 18, 30)

    // First booking is the authorized overlap (flagged → out of the index).
    await createDirectBooking({
      clientId: fx.clients[0].clientId,
      start: startA,
      locationId: fx.salonLocationId,
      locationType: ServiceLocationType.SALON,
      status: BookingStatus.ACCEPTED,
      durationMinutes: 60,
      bufferMinutes: 15,
      allowsOverlap: true,
    })

    // A normal booking overlapping the flagged one still inserts: the flagged
    // row isn't in the GIST index, so there is nothing for it to collide with.
    await createDirectBooking({
      clientId: fx.clients[1].clientId,
      start: startB,
      locationId: fx.salonLocationId,
      locationType: ServiceLocationType.SALON,
      status: BookingStatus.ACCEPTED,
      durationMinutes: 60,
      bufferMinutes: 15,
    })

    await expect(
      db.booking.count({ where: { professionalId: fx.professionalId } }),
    ).resolves.toBe(2)
  })

  it('database allows direct adjacent active bookings for the same professional', async () => {
    if (!fixtures) throw new Error('Missing fixtures')

    const startA = futureUtc(16, 18, 0)
    const startB = futureUtc(16, 19, 15)

    await createDirectBooking({
      clientId: fixtures.clients[0].clientId,
      start: startA,
      locationId: fixtures.salonLocationId,
      locationType: ServiceLocationType.SALON,
      status: BookingStatus.ACCEPTED,
      durationMinutes: 60,
      bufferMinutes: 15,
    })

    await createDirectBooking({
      clientId: fixtures.clients[1].clientId,
      start: startB,
      locationId: fixtures.salonLocationId,
      locationType: ServiceLocationType.SALON,
      status: BookingStatus.PENDING,
      durationMinutes: 60,
      bufferMinutes: 15,
    })

    await expect(
      db.booking.count({
        where: {
          professionalId: fixtures.professionalId,
        },
      }),
    ).resolves.toBe(2)
  })

  it('database allows active booking to overlap released (cancelled / no-show) bookings', async () => {
    if (!fixtures) throw new Error('Missing fixtures')

    const cancelledStart = futureUtc(17, 18, 0)
    const noShowStart = futureUtc(17, 20, 0)

    await createDirectBooking({
      clientId: fixtures.clients[0].clientId,
      start: cancelledStart,
      locationId: fixtures.salonLocationId,
      locationType: ServiceLocationType.SALON,
      status: BookingStatus.CANCELLED,
      durationMinutes: 60,
      bufferMinutes: 15,
    })

    await createDirectBooking({
      clientId: fixtures.clients[1].clientId,
      start: addMinutes(cancelledStart, 30),
      locationId: fixtures.suiteLocationId,
      locationType: ServiceLocationType.SALON,
      status: BookingStatus.ACCEPTED,
      durationMinutes: 60,
      bufferMinutes: 15,
    })

    await createDirectBooking({
      clientId: fixtures.clients[0].clientId,
      start: noShowStart,
      locationId: fixtures.salonLocationId,
      locationType: ServiceLocationType.SALON,
      status: BookingStatus.NO_SHOW,
      durationMinutes: 60,
      bufferMinutes: 15,
    })

    await createDirectBooking({
      clientId: fixtures.clients[1].clientId,
      start: addMinutes(noShowStart, 30),
      locationId: fixtures.suiteLocationId,
      locationType: ServiceLocationType.SALON,
      status: BookingStatus.PENDING,
      durationMinutes: 60,
      bufferMinutes: 15,
    })

    await expect(
      db.booking.count({
        where: {
          professionalId: fixtures.professionalId,
        },
      }),
    ).resolves.toBe(4)
  })

  it('database rejects an active booking overlapping a COMPLETED one', async () => {
    if (!fixtures) throw new Error('Missing fixtures')

    const fx = fixtures
    const completedStart = futureUtc(17, 22, 0)

    await createDirectBooking({
      clientId: fx.clients[0].clientId,
      start: completedStart,
      locationId: fx.salonLocationId,
      locationType: ServiceLocationType.SALON,
      status: BookingStatus.COMPLETED,
      durationMinutes: 60,
      bufferMinutes: 15,
    })

    await expectDbBookingOverlapRejection(() =>
      createDirectBooking({
        clientId: fx.clients[1].clientId,
        start: addMinutes(completedStart, 30),
        locationId: fx.suiteLocationId,
        locationType: ServiceLocationType.SALON,
        status: BookingStatus.ACCEPTED,
        durationMinutes: 60,
        bufferMinutes: 15,
      }),
    )

    await expect(
      db.booking.count({ where: { professionalId: fx.professionalId } }),
    ).resolves.toBe(1)
  })

  // F8. Four definitions of "which statuses occupy a professional's calendar"
  // had drifted apart, the durable one being the loosest. They are one constant
  // now (BOOKING_BLOCKING_STATUSES), but the constant and the EXCLUDE predicate
  // still live in two languages and can only be held together from outside.
  //
  // This walks EVERY value of the BookingStatus enum rather than a hand-listed
  // few, so a status added to the schema later is covered the day it lands: it
  // will be occupying or not in Postgres, and the array must agree.
  //
  // Membership is read behaviourally, never by parsing pg_get_constraintdef —
  // what matters is what the database DOES. A pair is refused only when BOTH
  // rows are in the predicate, so pairing the status under test against a known
  // occupying status (ACCEPTED) isolates the one being probed.
  it('the DB overlap predicate covers exactly BOOKING_BLOCKING_STATUSES', async () => {
    if (!fixtures) throw new Error('Missing fixtures')

    const fx = fixtures
    const allStatuses = Object.values(BookingStatus)

    // The partner must itself be occupying, or nothing is ever refused and
    // every status reads as free — the walk would pass while proving nothing.
    expect(BOOKING_BLOCKING_STATUSES).toContain(BookingStatus.ACCEPTED)
    // Tripwire, not a mechanic: if this ever fails, every status has become
    // occupying, which would mean CANCELLED / NO_SHOW stopped releasing their
    // time. That is a product decision, so make someone look at it here.
    expect(allStatuses.length).toBeGreaterThan(BOOKING_BLOCKING_STATUSES.length)

    const dbOccupies: Record<string, boolean> = {}
    const appOccupies: Record<string, boolean> = {}

    for (const [index, status] of allStatuses.entries()) {
      // A fresh day per status so neither the probe nor its partner can collide
      // with a previous iteration's leftovers.
      const start = futureUtc(30 + index, 18, 0)

      await createDirectBooking({
        clientId: fx.clients[0].clientId,
        start,
        locationId: fx.salonLocationId,
        locationType: ServiceLocationType.SALON,
        status,
        durationMinutes: 60,
        bufferMinutes: 15,
      })

      let refused = false
      try {
        await createDirectBooking({
          clientId: fx.clients[1].clientId,
          start: addMinutes(start, 30),
          locationId: fx.suiteLocationId,
          locationType: ServiceLocationType.SALON,
          status: BookingStatus.ACCEPTED,
          durationMinutes: 60,
          bufferMinutes: 15,
        })
      } catch (error: unknown) {
        // Only the overlap constraint counts as "occupied" — any other failure
        // (a bad fixture, a schema change) must surface, not read as occupancy.
        expect(errorText(error)).toContain(BOOKING_OVERLAP_CONSTRAINT)
        refused = true
      }

      dbOccupies[status] = refused
      appOccupies[status] = BOOKING_BLOCKING_STATUSES.includes(status)
    }

    // Compared as whole maps so a mismatch names every offending status at once
    // and says which side is which, rather than failing on the first one.
    expect(dbOccupies).toEqual(appOccupies)
  })

  it('an authorized overlap stays exempt once it completes', async () => {
    if (!fixtures) throw new Error('Missing fixtures')

    const fx = fixtures
    const start = futureUtc(19, 18, 0)

    await createDirectBooking({
      clientId: fx.clients[0].clientId,
      start,
      locationId: fx.salonLocationId,
      locationType: ServiceLocationType.SALON,
      status: BookingStatus.ACCEPTED,
      durationMinutes: 60,
      bufferMinutes: 15,
    })

    // The pro's deliberate double-book: flagged, so it leaves the GIST index.
    const overlappingId = await createDirectBooking({
      clientId: fx.clients[1].clientId,
      start: addMinutes(start, 30),
      locationId: fx.suiteLocationId,
      locationType: ServiceLocationType.SALON,
      status: BookingStatus.ACCEPTED,
      durationMinutes: 60,
      bufferMinutes: 15,
      allowsOverlap: true,
    })

    // Completing it must not drag it back under the widened predicate — that
    // would make a pro unable to close out their own authorized double-book.
    await expect(
      db.booking.update({
        where: { id: overlappingId },
        data: { status: BookingStatus.COMPLETED },
        select: { id: true },
      }),
    ).resolves.toEqual({ id: overlappingId })
  })

  it('database rejects direct overlapping holds for the same professional', async () => {
    if (!fixtures) throw new Error('Missing fixtures')

    const fx = fixtures
    const startA = futureUtc(18, 18, 0)
    const startB = futureUtc(18, 18, 30)

    await createDirectHold({
      clientId: fx.clients[0].clientId,
      start: startA,
      locationId: fx.salonLocationId,
      locationType: ServiceLocationType.SALON,
      durationMinutes: 60,
      bufferMinutes: 15,
    })

    await expectDbHoldOverlapRejection(() =>
      createDirectHold({
        clientId: fx.clients[1].clientId,
        start: startB,
        locationId: fx.salonLocationId,
        locationType: ServiceLocationType.SALON,
        durationMinutes: 60,
        bufferMinutes: 15,
      }),
    )

    await expect(
      db.bookingHold.count({
        where: { professionalId: fx.professionalId },
      }),
    ).resolves.toBe(1)
  })

  it('database allows direct adjacent holds for the same professional', async () => {
    if (!fixtures) throw new Error('Missing fixtures')

    const fx = fixtures
    const startA = futureUtc(19, 18, 0)
    const startB = futureUtc(19, 19, 15)

    await createDirectHold({
      clientId: fx.clients[0].clientId,
      start: startA,
      locationId: fx.salonLocationId,
      locationType: ServiceLocationType.SALON,
      durationMinutes: 60,
      bufferMinutes: 15,
    })

    await createDirectHold({
      clientId: fx.clients[1].clientId,
      start: startB,
      locationId: fx.salonLocationId,
      locationType: ServiceLocationType.SALON,
      durationMinutes: 60,
      bufferMinutes: 15,
    })

    await expect(
      db.bookingHold.count({
        where: { professionalId: fx.professionalId },
      }),
    ).resolves.toBe(2)
  })

  it('overlap constraint is expiry-agnostic: an expired hold blocks an overlapping insert until swept inline', async () => {
    // The GIST EXCLUDE predicate cannot reference now(), so it covers ALL holds
    // regardless of expiry. Correctness therefore relies on the create path
    // sweeping expired holds (deleteExpiredHoldsForProfessional) inside the
    // schedule lock BEFORE inserting. This test pins both halves of that
    // contract: an expired overlapping hold is rejected by the raw constraint,
    // and the same insert succeeds once the expired hold is swept.
    if (!fixtures) throw new Error('Missing fixtures')

    const fx = fixtures
    const startA = futureUtc(20, 18, 0)
    const startB = futureUtc(20, 18, 30)

    const expiredHoldId = await createExpiredHold({
      clientId: fx.clients[0].clientId,
      start: startA,
      locationId: fx.salonLocationId,
      locationType: ServiceLocationType.SALON,
    })

    await expectDbHoldOverlapRejection(() =>
      createDirectHold({
        clientId: fx.clients[1].clientId,
        start: startB,
        locationId: fx.salonLocationId,
        locationType: ServiceLocationType.SALON,
        durationMinutes: 60,
        bufferMinutes: 15,
      }),
    )

    await db.$transaction((tx) =>
      deleteExpiredHoldsForProfessional({
        tx,
        professionalId: fx.professionalId,
        now: new Date(),
      }),
    )

    await expect(db.bookingHold.count({ where: { id: expiredHoldId } })).resolves.toBe(0)

    await createDirectHold({
      clientId: fx.clients[1].clientId,
      start: startB,
      locationId: fx.salonLocationId,
      locationType: ServiceLocationType.SALON,
      durationMinutes: 60,
      bufferMinutes: 15,
    })

    await expect(
      db.bookingHold.count({
        where: { professionalId: fx.professionalId },
      }),
    ).resolves.toBe(1)
  })
})

// F3: `enforceBookingOverlapPolicy` — the gate EVERY booking write passes
// through — used to run on its own conflict engine (lib/booking/schedulingConflicts.ts,
// now deleted). It now shares `findBookingAndHoldConflicts` with the rest of
// conflictQueries.ts. These drive that finder against real Postgres, because the
// unit tests for it all mock the database away.
describe('findBookingAndHoldConflicts against real Postgres', () => {
  it('returns the conflicting booking and hold, and agrees with getTimeRangeConflict', async () => {
    if (!fixtures) throw new Error('Fixtures not initialized')
    const fx = fixtures

    const bookingStart = futureUtc(3, 10)
    const holdStart = futureUtc(3, 14)

    const bookingId = await createDirectBooking({
      clientId: fx.clients[0].clientId,
      start: bookingStart,
      locationId: fx.salonLocationId,
      locationType: ServiceLocationType.SALON,
      durationMinutes: 60,
      bufferMinutes: 15,
    })
    const holdId = await createDirectHold({
      clientId: fx.clients[1].clientId,
      start: holdStart,
      locationId: fx.salonLocationId,
      locationType: ServiceLocationType.SALON,
      durationMinutes: 60,
      bufferMinutes: 15,
    })

    // A window spanning both.
    const conflicts = await findBookingAndHoldConflicts({
      tx: db,
      professionalId: fx.professionalId,
      startsAt: bookingStart,
      endsAt: addMinutes(holdStart, 75),
    })

    expect(conflicts.bookings.map((c) => c.id)).toEqual([bookingId])
    expect(conflicts.holds.map((c) => c.id)).toEqual([holdId])
    expect(conflicts.all.map((c) => c.kind)).toEqual(['BOOKING', 'HOLD'])

    // The booking's window is start + 60 + 15.
    const bookingConflict = conflicts.bookings[0]
    expect(bookingConflict?.startsAt.getTime()).toBe(bookingStart.getTime())
    expect(bookingConflict?.endsAt.getTime()).toBe(
      addMinutes(bookingStart, 75).getTime(),
    )

    // ...and the availability-side engine reaches the same verdict on each.
    await expect(
      getTimeRangeConflict({
        tx: db,
        professionalId: fx.professionalId,
        locationId: fx.salonLocationId,
        requestedStart: bookingStart,
        requestedEnd: addMinutes(bookingStart, 30),
        defaultBufferMinutes: 15,
      }),
    ).resolves.toBe('BOOKING')

    await expect(
      getTimeRangeConflict({
        tx: db,
        professionalId: fx.professionalId,
        locationId: fx.salonLocationId,
        requestedStart: holdStart,
        requestedEnd: addMinutes(holdStart, 30),
        defaultBufferMinutes: 15,
      }),
    ).resolves.toBe('HOLD')
  })

  it('honours the exclude ids and skips expired holds and non-blocking statuses', async () => {
    if (!fixtures) throw new Error('Fixtures not initialized')
    const fx = fixtures

    const start = futureUtc(4, 11)
    const window = { startsAt: start, endsAt: addMinutes(start, 75) }

    const bookingId = await createDirectBooking({
      clientId: fx.clients[0].clientId,
      start,
      locationId: fx.salonLocationId,
      locationType: ServiceLocationType.SALON,
      durationMinutes: 60,
      bufferMinutes: 15,
    })

    // An expired hold on the same slot must not register as a conflict.
    await createExpiredHold({
      clientId: fx.clients[1].clientId,
      start,
      locationId: fx.suiteLocationId,
      locationType: ServiceLocationType.SALON,
    })

    // A CANCELLED booking is not occupancy.
    await createDirectBooking({
      clientId: fx.clients[1].clientId,
      start: addMinutes(start, 5),
      locationId: fx.suiteLocationId,
      locationType: ServiceLocationType.SALON,
      status: BookingStatus.CANCELLED,
      durationMinutes: 60,
      bufferMinutes: 15,
    })

    const found = await findBookingAndHoldConflicts({
      tx: db,
      professionalId: fx.professionalId,
      ...window,
    })
    expect(found.all.map((c) => c.id)).toEqual([bookingId])

    const excluded = await findBookingAndHoldConflicts({
      tx: db,
      professionalId: fx.professionalId,
      ...window,
      excludeBookingId: bookingId,
    })
    expect(excluded.all).toEqual([])
  })

  // THE test that can tell the app gate apart from the database backstop.
  //
  // On a CLIENT path both layers refuse with TIME_BOOKED, so blinding the finder
  // changes nothing observable — the EXCLUDE constraint catches it. A PRO
  // double-book is the opposite: it must SUCCEED, and it can only succeed if the
  // gate FINDS the conflict and stamps allowsOverlap so the row leaves the GIST
  // index. A finder that under-detects turns an intended pro double-book into a
  // raw 23P01.
  it('a pro double-book through the real write boundary succeeds and stamps allowsOverlap', async () => {
    if (!fixtures) throw new Error('Fixtures not initialized')
    const fx = fixtures

    // Every other test in this file inserts rows directly, so it never meets the
    // pro-readiness gate. This one goes through the real write boundary, which
    // does: the fixture has a bookable MOBILE_BASE location, so the profile also
    // needs its base config or readiness fails MOBILE_MISSING_BASE_CONFIG.
    // Scoped to this test — beforeEach re-seeds.
    await db.professionalProfile.update({
      where: { id: fx.professionalId },
      data: { mobileBasePostalCode: '92101', mobileRadiusMiles: 25 },
    })

    // 18:00Z = 11:00 America/Los_Angeles, inside the fixture working hours.
    const existingStart = futureUtc(6, 18)

    await createDirectBooking({
      clientId: fx.clients[0].clientId,
      start: existingStart,
      locationId: fx.salonLocationId,
      locationType: ServiceLocationType.SALON,
      durationMinutes: 60,
      bufferMinutes: 15,
    })

    const result = await createProBooking({
      professionalId: fx.professionalId,
      actorUserId: fx.proUserId,
      clientId: fx.clients[1].clientId,
      offeringId: fx.offeringId,
      locationId: fx.salonLocationId,
      locationType: ServiceLocationType.SALON,
      // 30 minutes in: squarely overlapping, and step-aligned to the fixture's
      // 15-minute grid.
      scheduledFor: addMinutes(existingStart, 30),
      clientAddressId: null,
      internalNotes: null,
      overrideReason: null,
      requestedBufferMinutes: null,
      requestedTotalDurationMinutes: null,
      // No overrides: the slot is inside working hours and the point of the
      // test is the OVERLAP decision, nothing else.
      allowOutsideWorkingHours: false,
      allowShortNotice: false,
      allowFarFuture: false,
    })

    const created = await db.booking.findUnique({
      where: { id: result.booking.id },
      select: { allowsOverlap: true, status: true },
    })

    expect(created?.allowsOverlap).toBe(true)

    // ...and both bookings really are on the calendar.
    await expect(
      db.booking.count({
        where: {
          professionalId: fx.professionalId,
          status: { in: [...BOOKING_BLOCKING_STATUSES] },
        },
      }),
    ).resolves.toBe(2)
  })

  it('reserves at least the DB EXCLUDE range for a hold whose snapshots are null', async () => {
    if (!fixtures) throw new Error('Fixtures not initialized')
    const fx = fixtures

    const start = futureUtc(5, 9)

    // The live create path always writes all three snapshots, so this row shape
    // is only reachable for holds predating migration 20260405070348 (which
    // added the columns with no backfill). Those are all long expired — but the
    // write boundary must not be able to book over one if it ever sees it, and
    // it used to reserve as little as ONE MINUTE here.
    const hold = await db.bookingHold.create({
      data: {
        offeringId: fx.offeringId,
        professionalId: fx.professionalId,
        clientId: fx.clients[0].clientId,
        scheduledFor: start,
        expiresAt: addMinutes(new Date(), 15),
        locationType: ServiceLocationType.SALON,
        locationId: fx.salonLocationId,
        locationTimeZone: 'America/Los_Angeles',
        durationMinutesSnapshot: null,
        bufferMinutesSnapshot: null,
        endsAtSnapshot: null,
      },
      select: { id: true },
    })

    // 30 minutes in: inside the offering's real duration, far past the 1-minute
    // window the retired engine would have reserved.
    const conflicts = await findBookingAndHoldConflicts({
      tx: db,
      professionalId: fx.professionalId,
      startsAt: addMinutes(start, 30),
      endsAt: addMinutes(start, 45),
    })

    expect(conflicts.holds.map((c) => c.id)).toEqual([hold.id])
  })
})