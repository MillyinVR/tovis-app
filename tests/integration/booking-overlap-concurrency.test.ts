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
import { getTimeRangeConflict } from '@/lib/booking/conflictQueries'
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

const BOOKING_OVERLAP_CONSTRAINT = 'Booking_no_active_professional_overlap'

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

async function cleanupAll(): Promise<void> {
  await db.notificationDeliveryEvent.deleteMany({})
  await db.notificationDelivery.deleteMany({})
  await db.notificationDispatch.deleteMany({})
  await db.scheduledClientNotification.deleteMany({})
  await db.clientNotification.deleteMany({})
  await db.notification.deleteMany({})
  await db.reminder.deleteMany({})

  await db.bookingOverrideAuditLog.deleteMany({})
  await db.bookingCloseoutAuditLog.deleteMany({})
  await db.idempotencyKey.deleteMany({})

  await db.bookingCheckoutProductItem.deleteMany({})
  await db.productRecommendation.deleteMany({})
  await db.aftercareRebookSlot.deleteMany({})
  await db.aftercareSummary.deleteMany({})

  await db.productSale.deleteMany({})
  await db.bookingHold.deleteMany({})
  await db.bookingServiceItem.deleteMany({})
  await db.booking.deleteMany({})

  await db.professionalServiceOffering.deleteMany({})
  await db.clientAddress.deleteMany({})
  await db.mediaServiceTag.deleteMany({})
  await db.mediaAsset.deleteMany({})
  await db.service.deleteMany({})
  await db.serviceCategory.deleteMany({})
  await db.professionalLocation.deleteMany({})
  await db.professionalPaymentSettings.deleteMany({})
  await db.clientProfile.deleteMany({})
  await db.professionalProfile.deleteMany({})
  await db.user.deleteMany({})
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
}): Prisma.BookingCreateInput {
  const durationMinutes = args.durationMinutes ?? 60
  const bufferMinutes = args.bufferMinutes ?? 15
  const isMobile = args.locationType === ServiceLocationType.MOBILE

  return {
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

async function createExpiredHold(args: {
  clientId: string
  start: Date
  locationId: string
  locationType: ServiceLocationType
}): Promise<string> {
  if (!fixtures) throw new Error('Fixtures not initialized')

  const requestedEnd = addMinutes(args.start, 75)

  const hold = await db.bookingHold.create({
    data: {
      offeringId: fixtures.offeringId,
      professionalId: fixtures.professionalId,
      clientId: args.clientId,
      scheduledFor: args.start,
      expiresAt: addMinutes(new Date(), -1),
      locationType: args.locationType,
      locationId: args.locationId,
      locationTimeZone: 'America/Los_Angeles',
      locationAddressSnapshot: {
        formattedAddress: '123 Salon St, San Diego, CA 92101',
      },
      locationLatSnapshot: 32.7157,
      locationLngSnapshot: -117.1611,
      clientAddressId: null,
      clientAddressSnapshot: Prisma.JsonNull,
      clientAddressLatSnapshot: null,
      clientAddressLngSnapshot: null,
      durationMinutesSnapshot: 60,
      bufferMinutesSnapshot: 15,
      endsAtSnapshot: requestedEnd,
    },
    select: { id: true },
  })

  return hold.id
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

async function expectDbBookingOverlapRejection(
  action: () => Promise<unknown>,
): Promise<void> {
  try {
    await action()
  } catch (error: unknown) {
    expect(errorText(error)).toContain(BOOKING_OVERLAP_CONSTRAINT)
    return
  }

  throw new Error(
    `Expected database overlap constraint ${BOOKING_OVERLAP_CONSTRAINT} to reject the write.`,
  )
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

  it('database allows active booking to overlap completed and cancelled bookings', async () => {
    if (!fixtures) throw new Error('Missing fixtures')

    const completedStart = futureUtc(17, 18, 0)
    const cancelledStart = futureUtc(17, 20, 0)

    await createDirectBooking({
      clientId: fixtures.clients[0].clientId,
      start: completedStart,
      locationId: fixtures.salonLocationId,
      locationType: ServiceLocationType.SALON,
      status: BookingStatus.COMPLETED,
      durationMinutes: 60,
      bufferMinutes: 15,
    })

    await createDirectBooking({
      clientId: fixtures.clients[1].clientId,
      start: addMinutes(completedStart, 30),
      locationId: fixtures.suiteLocationId,
      locationType: ServiceLocationType.SALON,
      status: BookingStatus.ACCEPTED,
      durationMinutes: 60,
      bufferMinutes: 15,
    })

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
})