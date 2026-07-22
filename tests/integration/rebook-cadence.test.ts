// tests/integration/rebook-cadence.test.ts
//
// Real-Postgres coverage for runRebookCadenceNotifications (personalization spec
// §6.7, gated by the §8.1 re-engagement budget). Exercises the end-to-end scan on
// a real DB: a client who is DUE for a refresh with a pro who has a near-term
// opening produces exactly one REBOOK_CADENCE_DUE client notification + its
// dispatch (the budget ledger), while the exclusion paths (pro booked out, an
// upcoming booking, not yet due) produce none — and a second run is idempotent.
//
// Runs via `npm run test:integration` (test DB :5433). The shared test DB is
// SEEDED — this test scopes every fixture with a unique tag and cleans up only its
// own rows.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  BookingSource,
  BookingStatus,
  NotificationEventKey,
  Prisma,
  ProfessionalLocationType,
  Role,
  ServiceLocationType,
} from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { runRebookCadenceNotifications } from '@/lib/notifications/rebookCadenceNotifications'

if (!process.env.DATABASE_URL) {
  throw new Error(
    'Missing DATABASE_URL. Run this test with: npm run test:integration',
  )
}

const NOW = new Date('2026-07-15T12:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000
const TAG = `rebookcad_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

type Ids = {
  tenantId: string
  proOpenId: string
  proClosedId: string
  serviceId: string
  categoryId: string
  openLocationId: string
  closedLocationId: string
  clientDueId: string
  clientNotDueId: string
  clientUpcomingId: string
  clientClosedProId: string
  userIds: string[]
}

let ids: Ids

// Monotonic minute offset so every booking's scheduledFor is globally unique
// (the schema's @@unique([professionalId, scheduledFor])).
let bookingSeq = 0

async function cleanup(): Promise<void> {
  if (!ids) return
  const clientIds = [
    ids.clientDueId,
    ids.clientNotDueId,
    ids.clientUpcomingId,
    ids.clientClosedProId,
  ]
  const proIds = [ids.proOpenId, ids.proClosedId]

  await prisma.notificationDispatch.deleteMany({
    where: { clientId: { in: clientIds } },
  })
  await prisma.clientNotification.deleteMany({
    where: { clientId: { in: clientIds } },
  })
  await prisma.booking.deleteMany({ where: { professionalId: { in: proIds } } })
  await prisma.professionalAvailabilityStat.deleteMany({
    where: { professionalId: { in: proIds } },
  })
  await prisma.professionalLocation.deleteMany({
    where: { professionalId: { in: proIds } },
  })
  await prisma.service.deleteMany({ where: { id: ids.serviceId } })
  await prisma.serviceCategory.deleteMany({ where: { id: ids.categoryId } })
  await prisma.clientProfile.deleteMany({ where: { id: { in: clientIds } } })
  await prisma.professionalProfile.deleteMany({ where: { id: { in: proIds } } })
  await prisma.user.deleteMany({ where: { id: { in: ids.userIds } } })
}

async function makeUser(role: Role, suffix: string): Promise<string> {
  const user = await prisma.user.create({
    data: {
      email: `${TAG}_${suffix}@example.com`,
      password: 'test-password',
      role,
      emailVerifiedAt: NOW,
    },
    select: { id: true },
  })
  return user.id
}

async function seed(): Promise<Ids> {
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'tovis-root' },
    update: {},
    create: { slug: 'tovis-root', name: 'TOVIS', isActive: true },
    select: { id: true },
  })

  const userIds: string[] = []

  const makePro = async (suffix: string) => {
    const userId = await makeUser(Role.PRO, `pro_${suffix}`)
    userIds.push(userId)
    const pro = await prisma.professionalProfile.create({
      data: {
        userId,
        homeTenantId: tenant.id,
        businessName: suffix === 'open' ? 'Open Studio' : 'Booked Studio',
        timeZone: 'America/Los_Angeles',
      },
      select: { id: true },
    })
    return pro.id
  }

  const proOpenId = await makePro('open')
  const proClosedId = await makePro('closed')

  const category = await prisma.serviceCategory.create({
    data: { name: `${TAG} Cat`, slug: `${TAG}-cat`, isActive: true },
    select: { id: true },
  })
  const service = await prisma.service.create({
    data: {
      name: `${TAG} Service`,
      categoryId: category.id,
      defaultDurationMinutes: 60,
      minPrice: new Prisma.Decimal('50.00'),
      isActive: true,
    },
    select: { id: true },
  })

  const makeLocation = async (professionalId: string) => {
    const loc = await prisma.professionalLocation.create({
      data: {
        professionalId,
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
    return loc.id
  }

  const openLocationId = await makeLocation(proOpenId)
  const closedLocationId = await makeLocation(proClosedId)

  // Only the OPEN pro has an availability row (next opening within horizon).
  await prisma.professionalAvailabilityStat.create({
    data: {
      professionalId: proOpenId,
      nextOpeningDate: new Date(NOW.getTime() + 3 * DAY_MS),
      openDayCount14d: 5,
      fullness14d: 0.4,
      capacityMinutes14d: 3000,
      computedAt: NOW,
    },
  })

  const makeClient = async (suffix: string) => {
    const userId = await makeUser(Role.CLIENT, `client_${suffix}`)
    userIds.push(userId)
    const client = await prisma.clientProfile.create({
      data: { userId, homeTenantId: tenant.id, firstName: 'Client' },
      select: { id: true },
    })
    return client.id
  }

  const clientDueId = await makeClient('due')
  const clientNotDueId = await makeClient('notdue')
  const clientUpcomingId = await makeClient('upcoming')
  const clientClosedProId = await makeClient('closedpro')

  const makeBooking = async (args: {
    clientId: string
    professionalId: string
    locationId: string
    daysFromNow: number // negative = past
    status: BookingStatus
  }) => {
    bookingSeq += 1
    // Spread by more than a booking OCCUPIES (60 duration + 15 buffer), not by
    // a token minute. Several of these land on the same pro and the same
    // `daysFromNow`, and since F8 a COMPLETED booking is covered by
    // Booking_no_active_professional_overlap — a 1-minute stagger made the
    // fixture double-book the pro and the seed died on a 23P01.
    const scheduledFor = new Date(
      NOW.getTime() + args.daysFromNow * DAY_MS + bookingSeq * 90 * 60 * 1000,
    )
    await prisma.booking.create({
      data: {
        clientId: args.clientId,
        professionalId: args.professionalId,
        proTenantId: tenant.id,
        clientHomeTenantId: tenant.id,
        serviceId: service.id,
        scheduledFor,
        status: args.status,
        source: BookingSource.REQUESTED,
        locationType: ServiceLocationType.SALON,
        locationId: args.locationId,
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

  // Due: two completed visits ~20 days apart, last ~25 days ago → cadence ~20,
  // due (25 ≥ 20, ≤ 60), open pro, nothing upcoming.
  await makeBooking({
    clientId: clientDueId,
    professionalId: proOpenId,
    locationId: openLocationId,
    daysFromNow: -45,
    status: BookingStatus.COMPLETED,
  })
  await makeBooking({
    clientId: clientDueId,
    professionalId: proOpenId,
    locationId: openLocationId,
    daysFromNow: -25,
    status: BookingStatus.COMPLETED,
  })

  // Not due: last visit only ~5 days ago (cadence ~25) → below cadence.
  await makeBooking({
    clientId: clientNotDueId,
    professionalId: proOpenId,
    locationId: openLocationId,
    daysFromNow: -30,
    status: BookingStatus.COMPLETED,
  })
  await makeBooking({
    clientId: clientNotDueId,
    professionalId: proOpenId,
    locationId: openLocationId,
    daysFromNow: -5,
    status: BookingStatus.COMPLETED,
  })

  // Upcoming: due by cadence, but has a future PENDING booking → excluded.
  await makeBooking({
    clientId: clientUpcomingId,
    professionalId: proOpenId,
    locationId: openLocationId,
    daysFromNow: -45,
    status: BookingStatus.COMPLETED,
  })
  await makeBooking({
    clientId: clientUpcomingId,
    professionalId: proOpenId,
    locationId: openLocationId,
    daysFromNow: -25,
    status: BookingStatus.COMPLETED,
  })
  await makeBooking({
    clientId: clientUpcomingId,
    professionalId: proOpenId,
    locationId: openLocationId,
    daysFromNow: 3,
    status: BookingStatus.PENDING,
  })

  // Closed pro: due by cadence, but the pro has no availability row → excluded.
  await makeBooking({
    clientId: clientClosedProId,
    professionalId: proClosedId,
    locationId: closedLocationId,
    daysFromNow: -45,
    status: BookingStatus.COMPLETED,
  })
  await makeBooking({
    clientId: clientClosedProId,
    professionalId: proClosedId,
    locationId: closedLocationId,
    daysFromNow: -25,
    status: BookingStatus.COMPLETED,
  })

  return {
    tenantId: tenant.id,
    proOpenId,
    proClosedId,
    serviceId: service.id,
    categoryId: category.id,
    openLocationId,
    closedLocationId,
    clientDueId,
    clientNotDueId,
    clientUpcomingId,
    clientClosedProId,
    userIds,
  }
}

async function countRebookNotifications(clientId: string): Promise<number> {
  return prisma.clientNotification.count({
    where: {
      clientId,
      eventKey: NotificationEventKey.REBOOK_CADENCE_DUE,
    },
  })
}

beforeAll(async () => {
  ids = await seed()
})

afterAll(async () => {
  await cleanup()
})

describe('runRebookCadenceNotifications (real DB)', () => {
  it('nudges only the due client with an open pro, and is idempotent', async () => {
    const first = await runRebookCadenceNotifications(prisma, { now: NOW })

    // The open pro is available; only the due client survives every filter.
    expect(first.openPros).toBe(1)
    expect(first.sent).toBe(1)

    expect(await countRebookNotifications(ids.clientDueId)).toBe(1)
    expect(await countRebookNotifications(ids.clientNotDueId)).toBe(0)
    expect(await countRebookNotifications(ids.clientUpcomingId)).toBe(0)
    expect(await countRebookNotifications(ids.clientClosedProId)).toBe(0)

    // The send created a dispatch — the pooled budget ledger (§8.1).
    const dispatches = await prisma.notificationDispatch.count({
      where: {
        clientId: ids.clientDueId,
        eventKey: NotificationEventKey.REBOOK_CADENCE_DUE,
      },
    })
    expect(dispatches).toBe(1)

    // The inbox row deep-links to the pro's public profile and carries the
    // cooldown-bucketed dedupeKey + the "time for a refresh" copy.
    const row = await prisma.clientNotification.findFirst({
      where: {
        clientId: ids.clientDueId,
        eventKey: NotificationEventKey.REBOOK_CADENCE_DUE,
      },
      select: { href: true, dedupeKey: true, title: true },
    })
    expect(row?.href).toBe(`/professionals/${ids.proOpenId}`)
    expect(row?.dedupeKey).toContain('rebook-cadence:')
    expect(row?.title).toBe('Time for a refresh with Open Studio?')

    // Idempotent: a second run in the same cooldown window sends nothing new.
    const second = await runRebookCadenceNotifications(prisma, { now: NOW })
    expect(second.sent).toBe(0)
    expect(await countRebookNotifications(ids.clientDueId)).toBe(1)
  })
})
