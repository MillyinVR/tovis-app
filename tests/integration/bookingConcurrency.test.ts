import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
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
import { lockProfessionalSchedule } from '@/lib/booking/scheduleLock'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error(
    'Missing DATABASE_URL. Run this test with: npm run test:integration',
  )
}

const db = new PrismaClient({
  datasources: {
    db: {
      url: databaseUrl,
    },
  },
})

type Fixtures = {
  categoryId: string
  serviceId: string
  clientUserId: string
  clientId: string
  clientAddressId: string
  proUserId: string
  professionalId: string
  salonLocationAId: string
  salonLocationBId: string
  mobileBaseLocationId: string
  offeringId: string
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
  await db.bookingHold.deleteMany({})
  await db.bookingServiceItem.deleteMany({})
  await db.booking.deleteMany({})
  await db.professionalServiceOffering.deleteMany({})
  await db.clientAddress.deleteMany({})
  await db.service.deleteMany({})
  await db.serviceCategory.deleteMany({})
  await db.professionalLocation.deleteMany({})
  await db.clientProfile.deleteMany({})
  await db.professionalProfile.deleteMany({})
  await db.user.deleteMany({})
}

async function seedFixtures(): Promise<Fixtures> {
  const tag = `concurrency_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

  const clientUser = await db.user.create({
    data: {
      email: `${tag}_client@example.com`,
      password: 'test-password',
      role: Role.CLIENT,
    },
    select: { id: true },
  })

  const proUser = await db.user.create({
    data: {
      email: `${tag}_pro@example.com`,
      password: 'test-password',
      role: Role.PRO,
    },
    select: { id: true },
  })

  const client = await db.clientProfile.create({
    data: {
      userId: clientUser.id,
      firstName: 'Client',
      lastName: 'Test',
    },
    select: { id: true },
  })

  const professional = await db.professionalProfile.create({
    data: {
      userId: proUser.id,
      firstName: 'Pro',
      lastName: 'Test',
      timeZone: 'America/Los_Angeles',
    },
    select: { id: true },
  })

  const clientAddress = await db.clientAddress.create({
    data: {
      clientId: client.id,
      kind: ClientAddressKind.SERVICE_ADDRESS,
      label: 'Home',
      formattedAddress: '789 Client Ave',
      addressLine1: '789 Client Ave',
      city: 'San Diego',
      state: 'CA',
      postalCode: '92101',
      countryCode: 'US',
      lat: new Prisma.Decimal('32.7157000'),
      lng: new Prisma.Decimal('-117.1611000'),
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

  const salonLocationA = await db.professionalLocation.create({
    data: {
      professionalId: professional.id,
      type: ProfessionalLocationType.SALON,
      name: 'Salon A',
      isPrimary: true,
      isBookable: true,
      formattedAddress: '123 Salon St',
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

  const salonLocationB = await db.professionalLocation.create({
    data: {
      professionalId: professional.id,
      type: ProfessionalLocationType.SUITE,
      name: 'Salon B',
      isPrimary: false,
      isBookable: true,
      formattedAddress: '456 Suite Ave',
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
      formattedAddress: '999 Mobile Base',
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
    categoryId: category.id,
    serviceId: service.id,
    clientUserId: clientUser.id,
    clientId: client.id,
    clientAddressId: clientAddress.id,
    proUserId: proUser.id,
    professionalId: professional.id,
    salonLocationAId: salonLocationA.id,
    salonLocationBId: salonLocationB.id,
    mobileBaseLocationId: mobileBaseLocation.id,
    offeringId: offering.id,
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function createLockedBooking(args: {
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

    const created = await tx.booking.create({
      data: {
        clientId: fx.clientId,
        professionalId: fx.professionalId,
        serviceId: fx.serviceId,
        offeringId: fx.offeringId,
        scheduledFor: args.start,
        status: BookingStatus.ACCEPTED,
        source: BookingSource.REQUESTED,
        locationType: args.locationType,
        locationId: args.locationId,
        locationTimeZone: 'America/Los_Angeles',
        locationAddressSnapshot: {
          formattedAddress:
            args.locationType === ServiceLocationType.SALON
              ? '123 Salon St'
              : '999 Mobile Base',
        },
        locationLatSnapshot: 32.7157,
        locationLngSnapshot: -117.1611,
        clientAddressId:
          args.locationType === ServiceLocationType.MOBILE
            ? (args.clientAddressId ?? fx.clientAddressId)
            : null,
        clientAddressSnapshot:
          args.locationType === ServiceLocationType.MOBILE
            ? { formattedAddress: '789 Client Ave' }
            : Prisma.JsonNull,
        clientAddressLatSnapshot:
          args.locationType === ServiceLocationType.MOBILE ? 32.7157 : null,
        clientAddressLngSnapshot:
          args.locationType === ServiceLocationType.MOBILE ? -117.1611 : null,
        subtotalSnapshot: new Prisma.Decimal('100.00'),
        totalDurationMinutes: durationMinutes,
        bufferMinutes,
      },
      select: { id: true },
    })

    return created.id
  })
}

async function createActiveHold(args: {
  start: Date
  locationId: string
  locationType: ServiceLocationType
  expiresAt: Date
}): Promise<string> {
  if (!fixtures) throw new Error('Fixtures not initialized')

  const created = await db.bookingHold.create({
    data: {
      offeringId: fixtures.offeringId,
      professionalId: fixtures.professionalId,
      clientId: fixtures.clientId,
      scheduledFor: args.start,
      expiresAt: args.expiresAt,
      locationType: args.locationType,
      locationId: args.locationId,
      locationTimeZone: 'America/Los_Angeles',
      locationAddressSnapshot:
        args.locationType === ServiceLocationType.SALON
          ? { formattedAddress: '123 Salon St' }
          : Prisma.JsonNull,
      locationLatSnapshot: 32.7157,
      locationLngSnapshot: -117.1611,
      clientAddressId:
        args.locationType === ServiceLocationType.MOBILE
          ? fixtures.clientAddressId
          : null,
      clientAddressSnapshot:
        args.locationType === ServiceLocationType.MOBILE
          ? { formattedAddress: '789 Client Ave' }
          : Prisma.JsonNull,
      clientAddressLatSnapshot:
        args.locationType === ServiceLocationType.MOBILE ? 32.7157 : null,
      clientAddressLngSnapshot:
        args.locationType === ServiceLocationType.MOBILE ? -117.1611 : null,
    },
    select: { id: true },
  })

  return created.id
}

function expectExactlyOneSuccess(results: PromiseSettledResult<unknown>[]) {
  const fulfilled = results.filter((r) => r.status === 'fulfilled')
  const rejected = results.filter((r) => r.status === 'rejected')

  expect(fulfilled).toHaveLength(1)
  expect(rejected).toHaveLength(1)

  return {
    fulfilled: fulfilled[0],
    rejected: rejected[0] as PromiseRejectedResult,
  }
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

describe('booking concurrency integration', () => {
  it('allows only one of two overlapping booking writes for the same professional', async () => {
    if (!fixtures) throw new Error('Missing fixtures')

    const startA = futureUtc(7, 19, 0)
    const startB = futureUtc(7, 19, 30)

    const p1 = createLockedBooking({
      start: startA,
      locationId: fixtures.salonLocationAId,
      locationType: ServiceLocationType.SALON,
      sleepSecondsAfterCheck: 0.25,
    })

    await sleep(25)

    const p2 = createLockedBooking({
      start: startB,
      locationId: fixtures.salonLocationAId,
      locationType: ServiceLocationType.SALON,
    })

    const results = await Promise.allSettled([p1, p2])
    const { rejected } = expectExactlyOneSuccess(results)

    expect(String(rejected.reason)).toContain('BOOKING')

    const count = await db.booking.count({
      where: { professionalId: fixtures.professionalId },
    })

    expect(count).toBe(1)
  })

  it('allows only one booking when two writes use the exact same start time', async () => {
    if (!fixtures) throw new Error('Missing fixtures')

    const start = futureUtc(7, 19, 0)

    const p1 = createLockedBooking({
      start,
      locationId: fixtures.salonLocationAId,
      locationType: ServiceLocationType.SALON,
      sleepSecondsAfterCheck: 0.25,
    })

    await sleep(25)

    const p2 = createLockedBooking({
      start,
      locationId: fixtures.salonLocationAId,
      locationType: ServiceLocationType.SALON,
    })

    const results = await Promise.allSettled([p1, p2])
    const { rejected } = expectExactlyOneSuccess(results)

    expect(String(rejected.reason)).toContain('BOOKING')

    const count = await db.booking.count({
      where: { professionalId: fixtures.professionalId },
    })

    expect(count).toBe(1)
  })

  it('blocks overlap across different salon locations for the same professional', async () => {
    if (!fixtures) throw new Error('Missing fixtures')

    const startA = futureUtc(7, 19, 0)
    const startB = futureUtc(7, 19, 30)

    const p1 = createLockedBooking({
      start: startA,
      locationId: fixtures.salonLocationAId,
      locationType: ServiceLocationType.SALON,
      sleepSecondsAfterCheck: 0.25,
    })

    await sleep(25)

    const p2 = createLockedBooking({
      start: startB,
      locationId: fixtures.salonLocationBId,
      locationType: ServiceLocationType.SALON,
    })

    const results = await Promise.allSettled([p1, p2])
    const { rejected } = expectExactlyOneSuccess(results)

    expect(String(rejected.reason)).toContain('BOOKING')
  })

  it('blocks overlap across salon and mobile bookings for the same professional', async () => {
    if (!fixtures) throw new Error('Missing fixtures')

    const startA = futureUtc(7, 19, 0)
    const startB = futureUtc(7, 19, 30)

    const p1 = createLockedBooking({
      start: startA,
      locationId: fixtures.salonLocationAId,
      locationType: ServiceLocationType.SALON,
      sleepSecondsAfterCheck: 0.25,
    })

    await sleep(25)

    const p2 = createLockedBooking({
      start: startB,
      locationId: fixtures.mobileBaseLocationId,
      locationType: ServiceLocationType.MOBILE,
      clientAddressId: fixtures.clientAddressId,
    })

    const results = await Promise.allSettled([p1, p2])
    const { rejected } = expectExactlyOneSuccess(results)

    expect(String(rejected.reason)).toContain('BOOKING')
  })

  it('blocks booking creation when an active hold already occupies the interval', async () => {
    if (!fixtures) throw new Error('Missing fixtures')

    const holdStart = futureUtc(7, 19, 30)

    await createActiveHold({
      start: holdStart,
      locationId: fixtures.salonLocationAId,
      locationType: ServiceLocationType.SALON,
      expiresAt: addMinutes(holdStart, 20),
    })

    await expect(
      createLockedBooking({
        start: holdStart,
        locationId: fixtures.salonLocationAId,
        locationType: ServiceLocationType.SALON,
      }),
    ).rejects.toThrow('HOLD')

    const count = await db.booking.count({
      where: { professionalId: fixtures.professionalId },
    })

    expect(count).toBe(0)
  })
})