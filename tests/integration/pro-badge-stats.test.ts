// tests/integration/pro-badge-stats.test.ts
//
// Real-Postgres coverage for refreshProfessionalBadgeStats (personalization
// spec §5 + §4.2): the four grouped Booking aggregates land in
// ProfessionalBadgeStat with the documented window semantics — including the
// §4.2 pro_reliability counts (COMPLETED + CANCELLED resolved, with NO_SHOW
// excluded) — and a refresh REPLACES the table's contents (a pro who goes quiet
// loses their row, which reads as all-zero at serve time). Runs via
// `npm run test:integration` (test DB :5433).

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
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

import { refreshProfessionalBadgeStats } from '@/lib/looks/badges/stats'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error(
    'Missing DATABASE_URL. Run this test with: npm run test:integration',
  )
}

const db = new PrismaClient({
  datasources: { db: { url: databaseUrl } },
})

const NOW = new Date()
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

type Fixtures = {
  tenantId: string
  professionalId: string
  proUserId: string
  clientAId: string
  clientAUserId: string
  clientBId: string
  clientBUserId: string
  serviceId: string
  categoryId: string
  locationId: string
}

let fx: Fixtures | null = null

// The shared test DB is seeded — clean up ONLY this test's fixture rows, in
// FK order, and never blanket-delete shared tables.
async function cleanup(): Promise<void> {
  if (!fx) return
  await db.professionalBadgeStat.deleteMany({
    where: { professionalId: fx.professionalId },
  })
  await db.booking.deleteMany({ where: { professionalId: fx.professionalId } })
  await db.professionalLocation.deleteMany({
    where: { professionalId: fx.professionalId },
  })
  await db.service.deleteMany({ where: { id: fx.serviceId } })
  await db.serviceCategory.deleteMany({ where: { id: fx.categoryId } })
  await db.clientProfile.deleteMany({
    where: { id: { in: [fx.clientAId, fx.clientBId] } },
  })
  await db.professionalProfile.deleteMany({
    where: { id: fx.professionalId },
  })
  await db.user.deleteMany({
    where: { id: { in: [fx.proUserId, fx.clientAUserId, fx.clientBUserId] } },
  })
}

async function seed(): Promise<Fixtures> {
  const tag = `badgestats_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

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
      lastName: 'Badges',
      timeZone: 'America/Los_Angeles',
    },
    select: { id: true },
  })

  const makeClient = async (suffix: 'a' | 'b') => {
    const user = await db.user.create({
      data: {
        email: `${tag}_client_${suffix}@example.com`,
        password: 'test-password',
        role: Role.CLIENT,
      },
      select: { id: true },
    })
    const profile = await db.clientProfile.create({
      data: {
        userId: user.id,
        homeTenantId: tenant.id,
        firstName: 'Client',
        lastName: suffix.toUpperCase(),
      },
      select: { id: true },
    })
    return { userId: user.id, profileId: profile.id }
  }

  const clientA = await makeClient('a')
  const clientB = await makeClient('b')

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
        mon: { enabled: true, start: '09:00', end: '18:00' },
        tue: { enabled: true, start: '09:00', end: '18:00' },
        wed: { enabled: true, start: '09:00', end: '18:00' },
        thu: { enabled: true, start: '09:00', end: '18:00' },
        fri: { enabled: true, start: '09:00', end: '18:00' },
        sat: { enabled: true, start: '09:00', end: '18:00' },
        sun: { enabled: true, start: '09:00', end: '18:00' },
      },
      bufferMinutes: 15,
      stepMinutes: 15,
      advanceNoticeMinutes: 0,
      maxDaysAhead: 365,
    },
    select: { id: true },
  })

  return {
    tenantId: tenant.id,
    professionalId: professional.id,
    proUserId: proUser.id,
    clientAId: clientA.profileId,
    clientAUserId: clientA.userId,
    clientBId: clientB.profileId,
    clientBUserId: clientB.userId,
    serviceId: service.id,
    categoryId: category.id,
    locationId: location.id,
  }
}

async function createBooking(args: {
  clientId: string
  scheduledFor: Date
  status: BookingStatus
  createdAt: Date
}): Promise<void> {
  if (!fx) throw new Error('Fixtures not initialized')
  await db.booking.create({
    data: {
      clientId: args.clientId,
      professionalId: fx.professionalId,
      proTenantId: fx.tenantId,
      clientHomeTenantId: fx.tenantId,
      serviceId: fx.serviceId,
      scheduledFor: args.scheduledFor,
      createdAt: args.createdAt,
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
      totalDurationMinutes: 60,
      bufferMinutes: 15,
    },
    select: { id: true },
  })
}

/** Distinct future slots so the active-overlap EXCLUDE constraint never bites. */
function futureSlot(index: number): Date {
  return new Date(NOW.getTime() + (index + 2) * DAY_MS)
}

beforeAll(async () => {
  await cleanup()
  fx = await seed()
})

afterAll(async () => {
  await cleanup()
  await db.$disconnect()
})

describe('refreshProfessionalBadgeStats (real DB)', () => {
  it('aggregates the three windows with the documented semantics', async () => {
    if (!fx) throw new Error('Fixtures not initialized')
    const oldCreated = new Date(NOW.getTime() - 20 * DAY_MS)

    // Velocity window: three non-cancelled bookings created 1h ago + one
    // CANCELLED (excluded).
    for (let i = 0; i < 3; i += 1) {
      await createBooking({
        clientId: fx.clientAId,
        scheduledFor: futureSlot(i),
        status: BookingStatus.ACCEPTED,
        createdAt: new Date(NOW.getTime() - HOUR_MS),
      })
    }
    await createBooking({
      clientId: fx.clientBId,
      scheduledFor: futureSlot(3),
      status: BookingStatus.CANCELLED,
      createdAt: new Date(NOW.getTime() - HOUR_MS),
    })

    // Completed window (30d, by scheduledFor): client A completed twice
    // (a rebook pair), client B once. All CREATED long ago so they stay out
    // of the velocity window.
    await createBooking({
      clientId: fx.clientAId,
      scheduledFor: new Date(NOW.getTime() - 10 * DAY_MS),
      status: BookingStatus.COMPLETED,
      createdAt: oldCreated,
    })
    await createBooking({
      clientId: fx.clientAId,
      scheduledFor: new Date(NOW.getTime() - 5 * DAY_MS),
      status: BookingStatus.COMPLETED,
      createdAt: oldCreated,
    })
    await createBooking({
      clientId: fx.clientBId,
      scheduledFor: new Date(NOW.getTime() - 3 * DAY_MS),
      status: BookingStatus.COMPLETED,
      createdAt: oldCreated,
    })

    // Outside every window: a completed booking from ~200 days ago.
    await createBooking({
      clientId: fx.clientBId,
      scheduledFor: new Date(NOW.getTime() - 200 * DAY_MS),
      status: BookingStatus.COMPLETED,
      createdAt: new Date(NOW.getTime() - 201 * DAY_MS),
    })

    // §4.2 reliability: a NO_SHOW inside the 180d window. It must NOT count toward
    // resolvedBookingCount (client behaviour, not the pro's reliability) — nor any
    // other window (created long ago; not COMPLETED).
    await createBooking({
      clientId: fx.clientBId,
      scheduledFor: new Date(NOW.getTime() - 7 * DAY_MS),
      status: BookingStatus.NO_SHOW,
      createdAt: oldCreated,
    })

    // The seeded test DB may hold other pros' bookings — assert on OUR pro's
    // row, not table totals.
    const result = await refreshProfessionalBadgeStats(db, NOW)
    expect(result.professionals).toBeGreaterThanOrEqual(1)

    const row = await db.professionalBadgeStat.findUnique({
      where: { professionalId: fx.professionalId },
    })

    expect(row).not.toBeNull()
    expect(row?.recentBookingCount).toBe(3)
    expect(row?.completedBookingCount30d).toBe(3)
    expect(row?.servedClientCount).toBe(2)
    expect(row?.rebookedClientCount).toBe(1)
    // §4.2 pro_reliability: 3 COMPLETED (within 180d) + 1 CANCELLED = 4 resolved,
    // 3 completed. The NO_SHOW and the ~200d-old COMPLETED are both excluded.
    expect(row?.resolvedBookingCount).toBe(4)
    expect(row?.completedResolvedCount).toBe(3)
    expect(row?.computedAt.getTime()).toBe(NOW.getTime())
  })

  it('a later refresh REPLACES the contents — a quiet pro loses their row', async () => {
    if (!fx) throw new Error('Fixtures not initialized')
    await db.booking.deleteMany({
      where: { professionalId: fx.professionalId },
    })

    await refreshProfessionalBadgeStats(db, new Date())

    const row = await db.professionalBadgeStat.findUnique({
      where: { professionalId: fx.professionalId },
    })
    expect(row).toBeNull()
  })
})
