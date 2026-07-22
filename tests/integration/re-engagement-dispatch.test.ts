// tests/integration/re-engagement-dispatch.test.ts
//
// Real-Postgres coverage for runReEngagementDispatch (personalization spec §8.1 —
// the UNIFIED dispatcher). Proves the capstone guarantee cron-ordering could not
// make: when a client qualifies for MORE THAN ONE re-engagement trigger and only one
// pooled budget slot is left, the HIGHEST-priority trigger wins globally — here a §8
// event-date countdown beats a §6.7 rebook-cadence nudge for the same client, even
// though both are eligible on the same DB. A rebook-only client still gets their
// nudge (the dispatcher isn't just dropping rebooks), and a second run is idempotent.
//
// Runs via `npm run test:integration` (test DB :5433). The shared test DB is
// SEEDED — this test scopes every fixture with a unique tag and cleans up only its
// own rows. Assertions are per-client (never on the global `sent`) because the
// dispatcher scans the whole DB.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  BookingSource,
  BookingStatus,
  BoardType,
  NotificationEventKey,
  Prisma,
  ProfessionalLocationType,
  Role,
  ServiceLocationType,
} from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { createClientNotification } from '@/lib/notifications/clientNotifications'
import { RE_ENGAGEMENT_EVENT_KEYS } from '@/lib/notifications/reEngagementBudget'
import { runReEngagementDispatch } from '@/lib/notifications/reEngagementDispatcher'

if (!process.env.DATABASE_URL) {
  throw new Error(
    'Missing DATABASE_URL. Run this test with: npm run test:integration',
  )
}

const NOW = new Date('2026-07-15T12:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000
const TAG = `redispatch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

/** A UTC-midnight @db.Date value `days` out from NOW. */
function eventDateDaysOut(days: number): Date {
  const d = new Date(NOW.getTime() + days * DAY_MS)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

type Ids = {
  tenantId: string
  proOpenId: string
  serviceId: string
  categoryId: string
  openLocationId: string
  clientBothId: string
  clientRebookOnlyId: string
  bothBoardId: string
  userIds: string[]
}

let ids: Ids

// Monotonic minute offset so every booking's scheduledFor is globally unique
// (the schema's @@unique([professionalId, scheduledFor])).
let bookingSeq = 0

async function cleanup(): Promise<void> {
  if (!ids) return
  const clientIds = [ids.clientBothId, ids.clientRebookOnlyId]
  const proIds = [ids.proOpenId]

  await prisma.notificationDispatch.deleteMany({
    where: { clientId: { in: clientIds } },
  })
  await prisma.clientNotification.deleteMany({
    where: { clientId: { in: clientIds } },
  })
  await prisma.board.deleteMany({ where: { clientId: { in: clientIds } } })
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

  const proUserId = await makeUser(Role.PRO, 'pro_open')
  userIds.push(proUserId)
  const pro = await prisma.professionalProfile.create({
    data: {
      userId: proUserId,
      homeTenantId: tenant.id,
      businessName: 'Open Studio',
      timeZone: 'America/Los_Angeles',
    },
    select: { id: true },
  })
  const proOpenId = pro.id

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

  const location = await prisma.professionalLocation.create({
    data: {
      professionalId: proOpenId,
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
  const openLocationId = location.id

  // The open pro has a near-term opening (within the 14-day horizon).
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

  const clientBothId = await makeClient('both')
  const clientRebookOnlyId = await makeClient('rebookonly')

  const makeCompletedVisit = async (clientId: string, daysAgo: number) => {
    bookingSeq += 1
    // Spread by more than a booking OCCUPIES (60 duration + 15 buffer), not by
    // a token minute: these all share one pro, and since F8 a COMPLETED booking
    // is covered by Booking_no_active_professional_overlap, so a 1-minute
    // stagger made the fixture double-book the pro and the seed died on 23P01.
    const scheduledFor = new Date(
      NOW.getTime() - daysAgo * DAY_MS + bookingSeq * 90 * 60 * 1000,
    )
    await prisma.booking.create({
      data: {
        clientId,
        professionalId: proOpenId,
        proTenantId: tenant.id,
        clientHomeTenantId: tenant.id,
        serviceId: service.id,
        scheduledFor,
        status: BookingStatus.COMPLETED,
        source: BookingSource.REQUESTED,
        locationType: ServiceLocationType.SALON,
        locationId: openLocationId,
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

  // Both clients: two completed visits ~20 days apart, last ~25 days ago → learned
  // cadence ~20, daysSince ~25 → DUE (25 ≥ 20, ≤ 60), open pro, nothing upcoming.
  await makeCompletedVisit(clientBothId, 45)
  await makeCompletedVisit(clientBothId, 25)
  await makeCompletedVisit(clientRebookOnlyId, 45)
  await makeCompletedVisit(clientRebookOnlyId, 25)

  // clientBoth ALSO has a dated bridal board 7 days out → a §8 countdown candidate
  // (milestone 7), the higher-priority trigger competing with its rebook.
  const board = await prisma.board.create({
    data: {
      clientId: clientBothId,
      name: `${TAG} bridal`,
      slug: `${TAG}-bridal`,
      type: BoardType.BRIDAL,
      eventDate: eventDateDaysOut(7),
    },
    select: { id: true },
  })
  const bothBoardId = board.id

  return {
    tenantId: tenant.id,
    proOpenId,
    serviceId: service.id,
    categoryId: category.id,
    openLocationId,
    clientBothId,
    clientRebookOnlyId,
    bothBoardId,
    userIds,
  }
}

function countByEvent(
  clientId: string,
  eventKey: NotificationEventKey,
): Promise<number> {
  return prisma.clientNotification.count({ where: { clientId, eventKey } })
}

beforeAll(async () => {
  ids = await seed()

  // Pre-spend 2 of clientBoth's 3 pooled weekly slots with an UNRELATED
  // re-engagement trigger (saved-look), so exactly one slot is left when the
  // countdown and the rebook compete. Distinct dedupeKeys so they never collide with
  // the dispatcher's real candidate keys, and a distinct eventKey so they don't skew
  // the countdown / rebook assertions.
  await createClientNotification({
    clientId: ids.clientBothId,
    eventKey: NotificationEventKey.SAVED_LOOK_AVAILABILITY_OPENED,
    title: 'Budget seed 1',
    dedupeKey: `${TAG}-budget-seed-1`,
  })
  await createClientNotification({
    clientId: ids.clientBothId,
    eventKey: NotificationEventKey.SAVED_LOOK_AVAILABILITY_OPENED,
    title: 'Budget seed 2',
    dedupeKey: `${TAG}-budget-seed-2`,
  })
})

afterAll(async () => {
  await cleanup()
})

describe('runReEngagementDispatch (real DB)', () => {
  it('lets the higher-priority countdown win the last pooled slot over a rebook, globally', async () => {
    const first = await runReEngagementDispatch(prisma, { now: NOW })

    // Both of our clients contribute a rebook candidate; at least our countdown +
    // rebook-only sends land (the scan is global, so these are lower bounds).
    expect(first.sentByTrigger.EVENT_COUNTDOWN).toBeGreaterThanOrEqual(1)
    expect(first.candidatesByTrigger.REBOOK_CADENCE).toBeGreaterThanOrEqual(2)

    // clientBoth had 1 slot left and TWO eligible triggers. Global priority sends the
    // §8 countdown and blocks the §6.7 rebook — the guarantee cron-ordering couldn't.
    expect(
      await countByEvent(
        ids.clientBothId,
        NotificationEventKey.EVENT_DATE_COUNTDOWN,
      ),
    ).toBe(1)
    expect(
      await countByEvent(
        ids.clientBothId,
        NotificationEventKey.REBOOK_CADENCE_DUE,
      ),
    ).toBe(0)

    // The countdown deep-links to the board and carries the milestone dedupeKey.
    const countdownRow = await prisma.clientNotification.findFirst({
      where: {
        clientId: ids.clientBothId,
        eventKey: NotificationEventKey.EVENT_DATE_COUNTDOWN,
      },
      select: { href: true, dedupeKey: true, title: true },
    })
    expect(countdownRow?.href).toBe(`/client/boards/${ids.bothBoardId}`)
    expect(countdownRow?.dedupeKey).toBe(`event-countdown:${ids.bothBoardId}:7`)
    expect(countdownRow?.title).toBe('7 days until your wedding')

    // Pooled ledger: 2 seeded + 1 countdown = 3 re-engagement dispatches (at cap).
    const dispatches = await prisma.notificationDispatch.count({
      where: {
        clientId: ids.clientBothId,
        eventKey: { in: [...RE_ENGAGEMENT_EVENT_KEYS] },
        cancelledAt: null,
      },
    })
    expect(dispatches).toBe(3)

    // A rebook-only client (fresh budget, no competing trigger) still gets nudged —
    // the dispatcher isn't just suppressing the lower-priority trigger everywhere.
    expect(
      await countByEvent(
        ids.clientRebookOnlyId,
        NotificationEventKey.REBOOK_CADENCE_DUE,
      ),
    ).toBe(1)

    // Idempotent: a second run sends nothing new to either client.
    await runReEngagementDispatch(prisma, { now: NOW })
    expect(
      await countByEvent(
        ids.clientBothId,
        NotificationEventKey.EVENT_DATE_COUNTDOWN,
      ),
    ).toBe(1)
    expect(
      await countByEvent(
        ids.clientBothId,
        NotificationEventKey.REBOOK_CADENCE_DUE,
      ),
    ).toBe(0)
    expect(
      await countByEvent(
        ids.clientRebookOnlyId,
        NotificationEventKey.REBOOK_CADENCE_DUE,
      ),
    ).toBe(1)
  })
})
