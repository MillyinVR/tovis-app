// K5: the NR/NNR/RR/RNR client-relationship mark is SNAPSHOTTED at finalize,
// never derived at read time. This suite drives the REAL resolver
// (lib/booking/resolveDiscoveryFinalize) against the database for the axis
// derivation, and then proves the snapshot rule the DoD demands: a client's
// third booking must not change what their first booking says. Under a
// read-time implementation the "first booking still reads NR" assertions below
// fail — the pair's history has grown by then, and a fresh derivation for the
// same pair provably answers RR in the same test.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  BookingSource,
  BookingStatus,
  ClientRelationshipLabel,
  Prisma,
  PrismaClient,
  ProfessionalLocationType,
  Role,
  ServiceLocationType,
} from '@prisma/client'

import { resolveDiscoveryFinalize } from '@/lib/booking/resolveDiscoveryFinalize'
import {
  RELATIONSHIP_BADGE_SELECT,
  deriveRelationshipBadge,
} from '@/lib/booking/relationshipLabel'

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error(
    'Missing DATABASE_URL. Run this test with: pnpm test:integration',
  )
}

const db = new PrismaClient({
  datasources: { db: { url: databaseUrl } },
})

type Fixtures = {
  tenantId: string
  clientId: string
  clientUserId: string
  professionalId: string
  serviceId: string
  locationId: string
}

let fx: Fixtures

async function seedFixtures(): Promise<Fixtures> {
  const tag = `rel_label_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

  const tenant = await db.tenant.upsert({
    where: { slug: 'tovis-root' },
    update: {},
    create: { slug: 'tovis-root', name: 'TOVIS', isActive: true },
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
      firstName: 'Label',
      lastName: 'Client',
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

  const professional = await db.professionalProfile.create({
    data: {
      userId: proUser.id,
      homeTenantId: tenant.id,
      firstName: 'Label',
      lastName: 'Pro',
      businessName: 'Label Studio',
      timeZone: 'America/Los_Angeles',
    },
    select: { id: true },
  })

  const category = await db.serviceCategory.create({
    data: { name: `${tag} Category`, slug: `${tag}-category`, isActive: true },
    select: { id: true },
  })

  const service = await db.service.create({
    data: {
      name: `${tag} Haircut`,
      categoryId: category.id,
      defaultDurationMinutes: 60,
      minPrice: new Prisma.Decimal('100.00'),
      isActive: true,
    },
    select: { id: true },
  })

  const location = await db.professionalLocation.create({
    data: {
      professionalId: professional.id,
      type: ProfessionalLocationType.SALON,
      name: 'Label Salon',
      isPrimary: true,
      isBookable: true,
      formattedAddress: '123 Label St, San Diego, CA 92101',
      addressLine1: '123 Label St',
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
    },
    select: { id: true },
  })

  return {
    tenantId: tenant.id,
    clientId: client.id,
    clientUserId: clientUser.id,
    professionalId: professional.id,
    serviceId: service.id,
    locationId: location.id,
  }
}

/**
 * History rows for the pair. Direct inserts on purpose — this is test SETUP
 * (the pair's past), not the write path under test; `clientRelationshipLabel`
 * is stamped explicitly to simulate what the boundary wrote at the time.
 */
async function createBookingRow(args: {
  daysAhead: number
  status?: BookingStatus
  source?: BookingSource
  relationshipLabel: ClientRelationshipLabel
}): Promise<string> {
  const scheduledFor = new Date()
  scheduledFor.setUTCDate(scheduledFor.getUTCDate() + args.daysAhead)
  scheduledFor.setUTCHours(17, 0, 0, 0)

  const booking = await db.booking.create({
    data: {
      clientId: fx.clientId,
      professionalId: fx.professionalId,
      serviceId: fx.serviceId,
      proTenantId: fx.tenantId,
      clientHomeTenantId: fx.tenantId,
      scheduledFor,
      status: args.status ?? BookingStatus.COMPLETED,
      source: args.source ?? BookingSource.REQUESTED,
      clientRelationshipLabel: args.relationshipLabel,
      locationId: fx.locationId,
      locationType: ServiceLocationType.SALON,
      locationTimeZone: 'America/Los_Angeles',
      totalDurationMinutes: 60,
      subtotalSnapshot: new Prisma.Decimal('100.00'),
      totalAmount: new Prisma.Decimal('100.00'),
    },
    select: { id: true },
  })

  return booking.id
}

function resolveLabelFor(source: BookingSource) {
  return resolveDiscoveryFinalize({
    clientId: fx.clientId,
    clientUserId: fx.clientUserId,
    professionalId: fx.professionalId,
    lookPostId: null,
    mediaId: null,
    source,
    aftercare: false,
  })
}

beforeAll(async () => {
  fx = await seedFixtures()
})

afterAll(async () => {
  // Leaf-first, filtered to this suite's rows — other suites own the broad wipes.
  await db.booking.deleteMany({ where: { professionalId: fx.professionalId } })
  await db.$disconnect()
})

describe('resolver derivation (real DB, both axes)', () => {
  it('a brand-new pair: REQUESTED → NR, DISCOVERY → NNR; aftercare → RR', async () => {
    expect((await resolveLabelFor(BookingSource.REQUESTED)).relationshipLabel).toBe(
      ClientRelationshipLabel.NR,
    )
    expect((await resolveLabelFor(BookingSource.DISCOVERY)).relationshipLabel).toBe(
      ClientRelationshipLabel.NNR,
    )
    expect(
      (await resolveDiscoveryFinalize({
        clientId: fx.clientId,
        clientUserId: fx.clientUserId,
        professionalId: fx.professionalId,
        lookPostId: null,
        mediaId: null,
        source: BookingSource.AFTERCARE,
        aftercare: true,
      })).relationshipLabel,
    ).toBe(ClientRelationshipLabel.RR)
  })

  it('the same pair with history: REQUESTED → RR, DISCOVERY → RNR (D1 fourth cell)', async () => {
    const firstBookingId = await createBookingRow({
      daysAhead: -30,
      relationshipLabel: ClientRelationshipLabel.NR,
    })

    try {
      expect(
        (await resolveLabelFor(BookingSource.REQUESTED)).relationshipLabel,
      ).toBe(ClientRelationshipLabel.RR)
      expect(
        (await resolveLabelFor(BookingSource.DISCOVERY)).relationshipLabel,
      ).toBe(ClientRelationshipLabel.RNR)
    } finally {
      await db.booking.delete({ where: { id: firstBookingId } })
    }
  })
})

describe('snapshot immutability (the DoD proof)', () => {
  it("a client's third booking does not change what their first booking says", async () => {
    // Booking 1: the pair's first ever — the boundary stamped NR at the time.
    const firstBookingId = await createBookingRow({
      daysAhead: -60,
      relationshipLabel: ClientRelationshipLabel.NR,
    })

    // Bookings 2 and 3 arrive later; by then the pair is established, so the
    // boundary stamps them RR — exactly what the resolver now answers.
    const laterLabel = (await resolveLabelFor(BookingSource.REQUESTED))
      .relationshipLabel
    expect(laterLabel).toBe(ClientRelationshipLabel.RR)

    await createBookingRow({ daysAhead: -30, relationshipLabel: laterLabel })
    await createBookingRow({ daysAhead: 7, relationshipLabel: laterLabel })

    // The read path: exactly what every surface does — RELATIONSHIP_BADGE_SELECT
    // then deriveRelationshipBadge. The first booking must still say NR even
    // though a fresh derivation for this pair now says RR (asserted above) —
    // under read-time derivation these two assertions cannot both hold.
    const firstRow = await db.booking.findUniqueOrThrow({
      where: { id: firstBookingId },
      select: RELATIONSHIP_BADGE_SELECT,
    })

    expect(deriveRelationshipBadge(firstRow).kind).toBe(
      ClientRelationshipLabel.NR,
    )

    // And the historical NR count for this pro — the marketing number — still
    // counts exactly one NR, not zero.
    const nrCount = await db.booking.count({
      where: {
        professionalId: fx.professionalId,
        clientRelationshipLabel: ClientRelationshipLabel.NR,
      },
    })
    expect(nrCount).toBe(1)
  })
})
