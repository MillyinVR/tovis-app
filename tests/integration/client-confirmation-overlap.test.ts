// K11: the client-confirmation state must be INERT to booking occupancy.
//
// The chain's standing constraint says confirmation is orthogonal timestamp
// fields, never a BookingStatus value, because that enum sits inside the
// Booking_no_active_professional_overlap GIST predicate — and a client failing
// to confirm (or outright declining) must NEVER free the slot; cancelling
// stays a human decision by the pro (D5).
//
// This suite proves it against real Postgres, two ways:
//   1. STRUCTURALLY — the live constraint's definition references none of the
//      three new columns (so no future migration quietly wired them in).
//   2. BEHAVIOURALLY — an AWAITING_CLIENT and a DECLINED booking still refuse
//      an overlapping insert exactly like an unconfirmed one, and stamping the
//      confirmation columns on an existing row changes nothing about its
//      occupancy or lifecycle.
//
// Red-first note: this file fails at `main` (the columns don't exist), and the
// structural pin fails if anyone ever rebuilds the constraint around the
// confirmation state.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  BookingStatus,
  Prisma,
  PrismaClient,
  ProfessionalLocationType,
  Role,
  ServiceLocationType,
} from '@prisma/client'

import {
  CLIENT_CONFIRMATION_SELECT,
  deriveClientConfirmationBadge,
} from '@/lib/booking/clientConfirmation'

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error(
    'Missing DATABASE_URL. Run this test with: pnpm test:integration',
  )
}

const db = new PrismaClient({
  datasources: { db: { url: databaseUrl } },
})

const BOOKING_OVERLAP_CONSTRAINT = 'Booking_no_active_professional_overlap'

type Fixtures = {
  tenantId: string
  clientId: string
  otherClientId: string
  professionalId: string
  serviceId: string
  locationId: string
}

let fx: Fixtures

async function seedFixtures(): Promise<Fixtures> {
  const tag = `k11_confirm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

  const tenant = await db.tenant.upsert({
    where: { slug: 'tovis-root' },
    update: {},
    create: { slug: 'tovis-root', name: 'TOVIS', isActive: true },
    select: { id: true },
  })

  async function createClient(suffix: string): Promise<string> {
    const user = await db.user.create({
      data: {
        email: `${tag}_${suffix}@example.com`,
        password: 'test-password',
        role: Role.CLIENT,
      },
      select: { id: true },
    })
    const client = await db.clientProfile.create({
      data: {
        userId: user.id,
        homeTenantId: tenant.id,
        firstName: 'Confirm',
        lastName: suffix,
      },
      select: { id: true },
    })
    return client.id
  }

  const clientId = await createClient('client')
  const otherClientId = await createClient('other')

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
      firstName: 'Confirm',
      lastName: 'Pro',
      businessName: 'Confirm Studio',
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
      name: 'Confirm Salon',
      isPrimary: true,
      isBookable: true,
      formattedAddress: '123 Confirm St, San Diego, CA 92101',
      addressLine1: '123 Confirm St',
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
    clientId,
    otherClientId,
    professionalId: professional.id,
    serviceId: service.id,
    locationId: location.id,
  }
}

/** Direct insert on purpose — occupancy is enforced by the DATABASE constraint
 * under test, not by app code, and K12 (not K11) owns the write path that will
 * stamp these columns for real. */
async function createBookingRow(args: {
  clientId: string
  start: Date
  status?: BookingStatus
  clientConfirmationRequestedAt?: Date | null
  clientConfirmedAt?: Date | null
  clientConfirmationDeclinedAt?: Date | null
}): Promise<string> {
  const booking = await db.booking.create({
    data: {
      clientId: args.clientId,
      professionalId: fx.professionalId,
      serviceId: fx.serviceId,
      proTenantId: fx.tenantId,
      clientHomeTenantId: fx.tenantId,
      scheduledFor: args.start,
      status: args.status ?? BookingStatus.ACCEPTED,
      locationId: fx.locationId,
      locationType: ServiceLocationType.SALON,
      locationTimeZone: 'America/Los_Angeles',
      totalDurationMinutes: 60,
      bufferMinutes: 0,
      subtotalSnapshot: new Prisma.Decimal('100.00'),
      totalAmount: new Prisma.Decimal('100.00'),
      clientConfirmationRequestedAt: args.clientConfirmationRequestedAt ?? null,
      clientConfirmedAt: args.clientConfirmedAt ?? null,
      clientConfirmationDeclinedAt: args.clientConfirmationDeclinedAt ?? null,
    },
    select: { id: true },
  })

  return booking.id
}

function errorText(error: unknown): string {
  if (error instanceof Error) {
    return [error.message, 'cause' in error ? String(error.cause) : ''].join(
      '\n',
    )
  }
  return String(error)
}

async function expectOverlapRejection(
  action: () => Promise<unknown>,
): Promise<void> {
  try {
    await action()
  } catch (error: unknown) {
    // Only the overlap constraint counts as "occupied" — any other failure (a
    // bad fixture, a schema change) must surface, not read as occupancy.
    // (Overlap probes below start MID-RANGE, +30min, so the separate
    // (professionalId, scheduledFor) unique index can't fire first.)
    expect(errorText(error)).toContain(BOOKING_OVERLAP_CONSTRAINT)
    return
  }

  throw new Error(
    `Expected ${BOOKING_OVERLAP_CONSTRAINT} to reject the overlapping write.`,
  )
}

/** Distinct far-future UTC slots per test so suites and cases can't collide. */
function futureUtc(daysAhead: number, hour: number): Date {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + daysAhead)
  d.setUTCHours(hour, 0, 0, 0)
  return d
}

/** Mid-range probe instant: 30min into a 60min booking. Starting INSIDE the
 * range (not at the same instant) makes sure the refusal comes from the GIST
 * exclusion constraint under test, not from the unrelated
 * (professionalId, scheduledFor) unique index that fires on identical starts. */
function midRange(start: Date): Date {
  return new Date(start.getTime() + 30 * 60 * 1000)
}

beforeAll(async () => {
  fx = await seedFixtures()
})

afterAll(async () => {
  await db.booking.deleteMany({ where: { professionalId: fx.professionalId } })
  await db.$disconnect()
})

describe('the overlap constraint is provably unchanged by K11', () => {
  it('STRUCTURAL: the live constraint definition references no confirmation column', async () => {
    const rows = await db.$queryRaw<{ def: string }[]>`
      SELECT pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conname = ${BOOKING_OVERLAP_CONSTRAINT}
    `

    expect(rows).toHaveLength(1)
    const def = rows[0]?.def ?? ''
    expect(def.length).toBeGreaterThan(0)

    // Still the predicate the 20260806 migration installed…
    expect(def).toContain('professionalId')
    expect(def).toContain('status')
    expect(def).toContain('allowsOverlap')

    // …and none of K11's columns, so confirmation state CANNOT change what
    // the database considers occupied.
    expect(def).not.toContain('clientConfirmationRequestedAt')
    expect(def).not.toContain('clientConfirmedAt')
    expect(def).not.toContain('clientConfirmationDeclinedAt')
  })

  it('an AWAITING_CLIENT booking still occupies its slot', async () => {
    const start = futureUtc(40, 17)

    await createBookingRow({
      clientId: fx.clientId,
      start,
      clientConfirmationRequestedAt: new Date(),
    })

    await expectOverlapRejection(() =>
      createBookingRow({ clientId: fx.otherClientId, start: midRange(start) }),
    )

    // Control: the neighbouring hour is genuinely free — the refusal above was
    // the overlap, not a broken fixture.
    await createBookingRow({
      clientId: fx.otherClientId,
      start: futureUtc(40, 19),
    })
  })

  it('a DECLINED booking still occupies its slot — declining is not cancelling (D5)', async () => {
    const start = futureUtc(41, 17)
    const requested = new Date('2026-07-30T10:00:00.000Z')
    const declined = new Date('2026-07-30T11:00:00.000Z')

    const declinedId = await createBookingRow({
      clientId: fx.clientId,
      start,
      clientConfirmationRequestedAt: requested,
      clientConfirmationDeclinedAt: declined,
    })

    await expectOverlapRejection(() =>
      createBookingRow({ clientId: fx.otherClientId, start: midRange(start) }),
    )

    // The row's lifecycle is untouched by the attendance state: still ACCEPTED,
    // and the badge derived from the REAL row reads DECLINED.
    const row = await db.booking.findUniqueOrThrow({
      where: { id: declinedId },
      select: { status: true, ...CLIENT_CONFIRMATION_SELECT },
    })
    expect(row.status).toBe(BookingStatus.ACCEPTED)
    expect(deriveClientConfirmationBadge(row)).toMatchObject({
      kind: 'DECLINED',
      significant: true,
    })
  })

  it('stamping confirmation state on an EXISTING row changes nothing about occupancy', async () => {
    const start = futureUtc(42, 17)

    const bookingId = await createBookingRow({
      clientId: fx.clientId,
      start,
    })

    const before = await db.booking.findUniqueOrThrow({
      where: { id: bookingId },
      select: { status: true, scheduledFor: true, ...CLIENT_CONFIRMATION_SELECT },
    })
    expect(deriveClientConfirmationBadge(before).significant).toBe(false)

    // The K12-shaped stamp: request goes out, client confirms.
    await db.booking.update({
      where: { id: bookingId },
      data: {
        clientConfirmationRequestedAt: new Date(),
        clientConfirmedAt: new Date(),
      },
    })

    const after = await db.booking.findUniqueOrThrow({
      where: { id: bookingId },
      select: { status: true, scheduledFor: true, ...CLIENT_CONFIRMATION_SELECT },
    })

    // Lifecycle + schedule untouched; only the attendance state moved.
    expect(after.status).toBe(before.status)
    expect(after.scheduledFor.getTime()).toBe(before.scheduledFor.getTime())
    expect(deriveClientConfirmationBadge(after)).toMatchObject({
      kind: 'CLIENT_CONFIRMED',
      significant: true,
    })

    // And the slot is exactly as occupied as before the stamp.
    await expectOverlapRejection(() =>
      createBookingRow({ clientId: fx.otherClientId, start: midRange(start) }),
    )
  })
})
