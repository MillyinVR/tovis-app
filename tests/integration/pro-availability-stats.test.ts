// tests/integration/pro-availability-stats.test.ts
//
// Real-Postgres coverage for refreshProfessionalAvailabilityStats +
// fetchProAvailabilitySignals (personalization spec §4.2/§4.4): the summary is
// computed from a pro's working hours + occupancy, a fully-booked window drops
// the pro's row, and the serve-time reader returns the fullness/next-opening
// signal. Runs via `npm run test:integration` (test DB :5433).

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  BookingSource,
  BookingStatus,
  Prisma,
  PrismaClient,
  ProfessionalLocationType,
  Role,
  ServiceLocationType,
} from '@prisma/client'

import {
  PRO_AVAILABILITY_STAT,
  fetchProAvailabilitySignals,
  refreshProfessionalAvailabilityStats,
} from '@/lib/looks/availabilityStats'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error(
    'Missing DATABASE_URL. Run this test with: npm run test:integration',
  )
}

const db = new PrismaClient({
  datasources: { db: { url: databaseUrl } },
})

const DAY_MS = 24 * 60 * 60 * 1000

type Fixtures = {
  tenantId: string
  professionalId: string
  proUserId: string
  clientId: string
  clientUserId: string
  serviceId: string
  categoryId: string
  locationId: string
}

let fx: Fixtures | null = null

// The shared test DB is seeded — clean up ONLY this test's fixture rows, in FK
// order, and never blanket-delete shared tables.
async function cleanup(): Promise<void> {
  if (!fx) return
  await db.professionalAvailabilityStat.deleteMany({
    where: { professionalId: fx.professionalId },
  })
  await db.booking.deleteMany({ where: { professionalId: fx.professionalId } })
  await db.professionalLocation.deleteMany({
    where: { professionalId: fx.professionalId },
  })
  await db.service.deleteMany({ where: { id: fx.serviceId } })
  await db.serviceCategory.deleteMany({ where: { id: fx.categoryId } })
  await db.clientProfile.deleteMany({ where: { id: fx.clientId } })
  await db.professionalProfile.deleteMany({ where: { id: fx.professionalId } })
  await db.user.deleteMany({
    where: { id: { in: [fx.proUserId, fx.clientUserId] } },
  })
}

async function seed(): Promise<Fixtures> {
  const tag = `availstats_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

  const tenant = await db.tenant.upsert({
    where: { slug: 'tovis-root' },
    update: {},
    create: { slug: 'tovis-root', name: 'TOVIS', isActive: true },
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

  const professional = await db.professionalProfile.create({
    data: {
      userId: proUser.id,
      homeTenantId: tenant.id,
      firstName: 'Pro',
      lastName: 'Availability',
      timeZone: 'America/Los_Angeles',
    },
    select: { id: true },
  })

  const clientUser = await db.user.create({
    data: {
      email: `${tag}_client@example.com`,
      password: 'test-password',
      role: Role.CLIENT,
    },
    select: { id: true },
  })
  const client = await db.clientProfile.create({
    data: {
      userId: clientUser.id,
      homeTenantId: tenant.id,
      firstName: 'Client',
      lastName: 'A',
    },
    select: { id: true },
  })

  const category = await db.serviceCategory.create({
    data: { name: `${tag} Category`, slug: `${tag}-category`, isActive: true },
    select: { id: true },
  })

  const service = await db.service.create({
    data: {
      name: `${tag} Service`,
      categoryId: category.id,
      defaultDurationMinutes: 60,
      minPrice: new Prisma.Decimal('50.00'),
      isActive: true,
    },
    select: { id: true },
  })

  const location = await db.professionalLocation.create({
    data: {
      professionalId: professional.id,
      type: ProfessionalLocationType.SALON,
      name: 'Salon',
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
      workingHours: {
        mon: { enabled: true, start: '09:00', end: '17:00' },
        tue: { enabled: true, start: '09:00', end: '17:00' },
        wed: { enabled: true, start: '09:00', end: '17:00' },
        thu: { enabled: true, start: '09:00', end: '17:00' },
        fri: { enabled: true, start: '09:00', end: '17:00' },
        sat: { enabled: true, start: '09:00', end: '17:00' },
        sun: { enabled: true, start: '09:00', end: '17:00' },
      },
      bufferMinutes: 0,
      stepMinutes: 30,
      advanceNoticeMinutes: 0,
      maxDaysAhead: 365,
    },
    select: { id: true },
  })

  return {
    tenantId: tenant.id,
    professionalId: professional.id,
    proUserId: proUser.id,
    clientId: client.id,
    clientUserId: clientUser.id,
    serviceId: service.id,
    categoryId: category.id,
    locationId: location.id,
  }
}

async function createBooking(args: {
  scheduledFor: Date
  durationMinutes: number
  status: BookingStatus
}): Promise<void> {
  if (!fx) throw new Error('Fixtures not initialized')
  await db.booking.create({
    data: {
      clientId: fx.clientId,
      professionalId: fx.professionalId,
      proTenantId: fx.tenantId,
      clientHomeTenantId: fx.tenantId,
      serviceId: fx.serviceId,
      scheduledFor: args.scheduledFor,
      status: args.status,
      source: BookingSource.REQUESTED,
      locationType: ServiceLocationType.SALON,
      locationId: fx.locationId,
      locationTimeZone: 'America/Los_Angeles',
      locationAddressSnapshot: { formattedAddress: '123 Salon St' },
      locationLatSnapshot: 32.7157,
      locationLngSnapshot: -117.1611,
      clientAddressSnapshot: Prisma.JsonNull,
      subtotalSnapshot: new Prisma.Decimal('50.00'),
      totalDurationMinutes: args.durationMinutes,
      bufferMinutes: 0,
    },
    select: { id: true },
  })
}

beforeAll(async () => {
  await cleanup()
  fx = await seed()
})

afterAll(async () => {
  await cleanup()
  await db.$disconnect()
})

describe('refreshProfessionalAvailabilityStats (real DB)', () => {
  it('summarizes a wide-open pro and the reader returns the signal', async () => {
    if (!fx) throw new Error('Fixtures not initialized')

    const result = await refreshProfessionalAvailabilityStats(db, new Date())
    expect(result.professionals).toBeGreaterThanOrEqual(1)

    const row = await db.professionalAvailabilityStat.findUnique({
      where: { professionalId: fx.professionalId },
    })
    expect(row).not.toBeNull()
    expect(row?.nextOpeningDate).not.toBeNull()
    expect(row?.fullness14d).toBe(0)
    // Every day in the window is open — 14, or 13 if today's window has already
    // elapsed by the time the test runs (the now-floor; exact math is unit-tested).
    expect(row?.openDayCount14d).toBeGreaterThanOrEqual(
      PRO_AVAILABILITY_STAT.fullnessWindowDays - 1,
    )
    expect(row?.capacityMinutes14d).toBeGreaterThan(0)

    const signals = await fetchProAvailabilitySignals(db, [fx.professionalId])
    const signal = signals.get(fx.professionalId)
    expect(signal).toBeDefined()
    expect(signal?.fullness14d).toBe(0)
    expect(signal?.nextOpeningDate).not.toBeNull()
  })

  it('a future booking raises fullness without closing the day', async () => {
    if (!fx) throw new Error('Fixtures not initialized')

    // A booking one week out, at 20:00 UTC (= 12:00–13:00 PST / 13:00–14:00 PDT,
    // squarely inside the 09:00–17:00 local window on whatever local day it lands
    // on), occupying 60 minutes. That day loses an hour of capacity but stays
    // open (7h spare), so fullness rises above 0 while every day remains open.
    const weekOut = new Date(Date.now() + 7 * DAY_MS)
    weekOut.setUTCHours(20, 0, 0, 0)
    await createBooking({
      scheduledFor: weekOut,
      durationMinutes: 60,
      status: BookingStatus.ACCEPTED,
    })

    await refreshProfessionalAvailabilityStats(db, new Date())

    const row = await db.professionalAvailabilityStat.findUnique({
      where: { professionalId: fx.professionalId },
    })
    expect(row).not.toBeNull()
    expect(row?.fullness14d).toBeGreaterThan(0)
    // The 1h booking doesn't close its day — still 13–14 open days.
    expect(row?.openDayCount14d).toBeGreaterThanOrEqual(
      PRO_AVAILABILITY_STAT.fullnessWindowDays - 1,
    )
  })

  it('a pro with no bookable schedule is dropped on the next refresh', async () => {
    if (!fx) throw new Error('Fixtures not initialized')

    // Remove the bookable location → no schedule → no availability signal.
    await db.booking.deleteMany({ where: { professionalId: fx.professionalId } })
    await db.professionalLocation.deleteMany({
      where: { professionalId: fx.professionalId },
    })

    await refreshProfessionalAvailabilityStats(db, new Date())

    const row = await db.professionalAvailabilityStat.findUnique({
      where: { professionalId: fx.professionalId },
    })
    expect(row).toBeNull()

    const signals = await fetchProAvailabilitySignals(db, [fx.professionalId])
    expect(signals.get(fx.professionalId)).toBeUndefined()
  })
})
