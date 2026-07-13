// tests/integration/relationship-signals.test.ts
//
// Real-Postgres coverage for fetchClientRelationshipSignals (personalization
// spec §6.7 post-booking relationship layer). The reader powers the Looks feed
// relationship_boost: it loads, per VIEWER, which pros they've completed a
// booking with, how recently, and how often. Unit mocks can't exercise the real
// WHERE semantics — the status filter (only COMPLETED counts) and the clientId
// scoping (one client's bookings never leak into another's). Runs via
// `npm run test:integration` (test DB :5433).
//
// The shared test DB is seeded, so every query is scoped to this fixture's own
// client ids; the reader keys on clientId, so the seeded corpus can't perturb it.

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

import { fetchClientRelationshipSignals } from '@/lib/looks/relationshipSignals'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error(
    'Missing DATABASE_URL. Run this test with: npm run test:integration',
  )
}

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

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

// Clean up ONLY this fixture's rows, in FK order — never blanket-delete.
async function cleanup(): Promise<void> {
  if (!fx) return
  await db.booking.deleteMany({ where: { professionalId: fx.professionalId } })
  await db.professionalLocation.deleteMany({
    where: { professionalId: fx.professionalId },
  })
  await db.service.deleteMany({ where: { id: fx.serviceId } })
  await db.serviceCategory.deleteMany({ where: { id: fx.categoryId } })
  await db.clientProfile.deleteMany({
    where: { id: { in: [fx.clientAId, fx.clientBId] } },
  })
  await db.professionalProfile.deleteMany({ where: { id: fx.professionalId } })
  await db.user.deleteMany({
    where: { id: { in: [fx.proUserId, fx.clientAUserId, fx.clientBUserId] } },
  })
}

async function seed(): Promise<Fixtures> {
  const tag = `relsig_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

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
      lastName: 'Relationship',
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
      workingHours: {},
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
  finishedAt?: Date | null
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
      finishedAt: args.finishedAt ?? null,
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

beforeAll(async () => {
  await cleanup()
  fx = await seed()
})

afterAll(async () => {
  await cleanup()
  await db.$disconnect()
})

describe('fetchClientRelationshipSignals (real DB)', () => {
  it('aggregates a viewer’s COMPLETED bookings per pro, preferring finishedAt', async () => {
    if (!fx) throw new Error('Fixtures not initialized')

    const finishedInstant = new Date(NOW.getTime() - 5 * DAY_MS + HOUR_MS)

    // Client A: two COMPLETED visits with the pro (one carries finishedAt) …
    await createBooking({
      clientId: fx.clientAId,
      scheduledFor: new Date(NOW.getTime() - 10 * DAY_MS),
      status: BookingStatus.COMPLETED,
    })
    await createBooking({
      clientId: fx.clientAId,
      scheduledFor: new Date(NOW.getTime() - 5 * DAY_MS),
      finishedAt: finishedInstant,
      status: BookingStatus.COMPLETED,
    })
    // … plus a PENDING booking that is NOT yet a relationship (status-filtered).
    await createBooking({
      clientId: fx.clientAId,
      scheduledFor: new Date(NOW.getTime() + 2 * DAY_MS),
      status: BookingStatus.PENDING,
    })

    // Client B: one COMPLETED visit with the SAME pro — must not leak into A.
    await createBooking({
      clientId: fx.clientBId,
      scheduledFor: new Date(NOW.getTime() - 3 * DAY_MS),
      status: BookingStatus.COMPLETED,
    })

    const aSignals = await fetchClientRelationshipSignals(db, fx.clientAId)
    const a = aSignals.get(fx.professionalId)
    expect(a).toBeDefined()
    // The PENDING booking is excluded; only the two COMPLETED count.
    expect(a?.completedVisits).toBe(2)
    // The latest instant prefers finishedAt over scheduledFor.
    expect(a?.lastVisitAt.getTime()).toBe(finishedInstant.getTime())

    // Client B's booking with the same pro stays on B — the reader is scoped by
    // clientId, so A's count is unaffected.
    const bSignals = await fetchClientRelationshipSignals(db, fx.clientBId)
    expect(bSignals.get(fx.professionalId)?.completedVisits).toBe(1)
  })

  it('returns an empty map for a viewer with no completed bookings', async () => {
    if (!fx) throw new Error('Fixtures not initialized')
    // Wipe A's bookings; a client with none gets no relationship signal (boost 0).
    await db.booking.deleteMany({ where: { clientId: fx.clientAId } })
    const signals = await fetchClientRelationshipSignals(db, fx.clientAId)
    expect(signals.size).toBe(0)
  })
})
