// tests/integration/saved-look-activation.test.ts
//
// Real-Postgres coverage for runSavedLookActivation (personalization spec §6.8,
// gated by the §8.1 re-engagement budget). Exercises the end-to-end scan on a
// real DB: an aging save whose pro has a near-term opening produces exactly one
// SAVED_LOOK_AVAILABILITY_OPENED client notification + its dispatch (the budget
// ledger), while the three exclusion paths (pro booked out, already booked,
// save too fresh) produce none — and a second run is idempotent (dedupe).
//
// Runs via `npm run test:integration` (test DB :5433). The shared test DB is
// SEEDED — this test scopes every fixture with a unique tag and cleans up only
// its own rows.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  BoardType,
  BookingSource,
  BookingStatus,
  LookPostStatus,
  MediaType,
  ModerationStatus,
  NotificationEventKey,
  Prisma,
  ProfessionalLocationType,
  Role,
  ServiceLocationType,
} from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { runSavedLookActivation } from '@/lib/notifications/savedLookActivation'

if (!process.env.DATABASE_URL) {
  throw new Error(
    'Missing DATABASE_URL. Run this test with: npm run test:integration',
  )
}

const NOW = new Date('2026-07-15T12:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000
const TAG = `savedact_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

type Ids = {
  tenantId: string
  proOpenId: string
  proClosedId: string
  lookOpenId: string
  lookClosedId: string
  serviceId: string
  categoryId: string
  locationId: string
  clientEligibleId: string
  clientBookedId: string
  clientClosedProId: string
  clientFreshId: string
  userIds: string[]
}

let ids: Ids

async function cleanup(): Promise<void> {
  if (!ids) return
  const clientIds = [
    ids.clientEligibleId,
    ids.clientBookedId,
    ids.clientClosedProId,
    ids.clientFreshId,
  ]
  const proIds = [ids.proOpenId, ids.proClosedId]

  // Deleting the client cascades its notifications + dispatches, but delete them
  // explicitly first for clarity.
  await prisma.notificationDispatch.deleteMany({
    where: { clientId: { in: clientIds } },
  })
  await prisma.clientNotification.deleteMany({
    where: { clientId: { in: clientIds } },
  })
  await prisma.boardItem.deleteMany({
    where: { lookPostId: { in: [ids.lookOpenId, ids.lookClosedId] } },
  })
  await prisma.board.deleteMany({ where: { clientId: { in: clientIds } } })
  await prisma.booking.deleteMany({ where: { professionalId: { in: proIds } } })
  await prisma.professionalAvailabilityStat.deleteMany({
    where: { professionalId: { in: proIds } },
  })
  await prisma.lookPost.deleteMany({
    where: { id: { in: [ids.lookOpenId, ids.lookClosedId] } },
  })
  await prisma.mediaAsset.deleteMany({ where: { professionalId: { in: proIds } } })
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
        businessName: `${suffix === 'open' ? 'Open Studio' : 'Booked Studio'}`,
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

  const makeLook = async (professionalId: string, suffix: string) => {
    const media = await prisma.mediaAsset.create({
      data: {
        professionalId,
        proTenantId: tenant.id,
        primaryServiceId: service.id,
        mediaType: MediaType.IMAGE,
        storageBucket: 'media-public',
        storagePath: `${TAG}/${suffix}.jpg`,
      },
      select: { id: true },
    })
    const look = await prisma.lookPost.create({
      data: {
        professionalId,
        primaryMediaAssetId: media.id,
        serviceId: service.id,
        status: LookPostStatus.PUBLISHED,
        moderationStatus: ModerationStatus.APPROVED,
        publishedAt: NOW,
        rankScore: 10,
      },
      select: { id: true },
    })
    return look.id
  }

  const lookOpenId = await makeLook(proOpenId, 'open')
  const lookClosedId = await makeLook(proClosedId, 'closed')

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

  const clientEligibleId = await makeClient('eligible')
  const clientBookedId = await makeClient('booked')
  const clientClosedProId = await makeClient('closedpro')
  const clientFreshId = await makeClient('fresh')

  const saveLook = async (args: {
    clientId: string
    lookPostId: string
    ageDays: number
  }) => {
    const board = await prisma.board.create({
      data: {
        clientId: args.clientId,
        name: `${TAG} ${args.clientId} board`,
        slug: `${TAG}-${args.clientId}`,
        type: BoardType.GENERAL,
      },
      select: { id: true },
    })
    await prisma.boardItem.create({
      data: {
        boardId: board.id,
        lookPostId: args.lookPostId,
        createdAt: new Date(NOW.getTime() - args.ageDays * DAY_MS),
      },
    })
  }

  // Eligible: aged save on the OPEN pro's look.
  await saveLook({ clientId: clientEligibleId, lookPostId: lookOpenId, ageDays: 10 })
  // Excluded — pro booked out (no availability row).
  await saveLook({ clientId: clientClosedProId, lookPostId: lookClosedId, ageDays: 10 })
  // Excluded — already booked this pro.
  await saveLook({ clientId: clientBookedId, lookPostId: lookOpenId, ageDays: 10 })
  // Excluded — save too fresh (< minSaveAge).
  await saveLook({ clientId: clientFreshId, lookPostId: lookOpenId, ageDays: 1 })

  // The "already booked" client has a booking with the open pro.
  await prisma.booking.create({
    data: {
      clientId: clientBookedId,
      professionalId: proOpenId,
      proTenantId: tenant.id,
      clientHomeTenantId: tenant.id,
      serviceId: service.id,
      scheduledFor: new Date(NOW.getTime() - 30 * DAY_MS),
      status: BookingStatus.COMPLETED,
      source: BookingSource.REQUESTED,
      locationType: ServiceLocationType.SALON,
      locationId: location.id,
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

  return {
    tenantId: tenant.id,
    proOpenId,
    proClosedId,
    lookOpenId,
    lookClosedId,
    serviceId: service.id,
    categoryId: category.id,
    locationId: location.id,
    clientEligibleId,
    clientBookedId,
    clientClosedProId,
    clientFreshId,
    userIds,
  }
}

async function countActivationNotifications(clientId: string): Promise<number> {
  return prisma.clientNotification.count({
    where: {
      clientId,
      eventKey: NotificationEventKey.SAVED_LOOK_AVAILABILITY_OPENED,
    },
  })
}

beforeAll(async () => {
  ids = await seed()
})

afterAll(async () => {
  await cleanup()
})

describe('runSavedLookActivation (real DB)', () => {
  it('nudges only the eligible saved-not-booked client, and is idempotent', async () => {
    const first = await runSavedLookActivation(prisma, { now: NOW })

    // Only the OPEN pro is available; only one aging save survives every filter.
    expect(first.openPros).toBe(1)
    expect(first.sent).toBe(1)

    expect(await countActivationNotifications(ids.clientEligibleId)).toBe(1)
    expect(await countActivationNotifications(ids.clientBookedId)).toBe(0)
    expect(await countActivationNotifications(ids.clientClosedProId)).toBe(0)
    expect(await countActivationNotifications(ids.clientFreshId)).toBe(0)

    // The send created a dispatch — the pooled budget ledger (§8.1). One re-engagement
    // dispatch now sits in the eligible client's rolling window.
    const dispatches = await prisma.notificationDispatch.count({
      where: {
        clientId: ids.clientEligibleId,
        eventKey: NotificationEventKey.SAVED_LOOK_AVAILABILITY_OPENED,
      },
    })
    expect(dispatches).toBe(1)

    // The inbox row carries the trigger payload + a deep link to the saved look.
    const row = await prisma.clientNotification.findFirst({
      where: {
        clientId: ids.clientEligibleId,
        eventKey: NotificationEventKey.SAVED_LOOK_AVAILABILITY_OPENED,
      },
      select: { href: true, data: true, dedupeKey: true },
    })
    expect(row?.href).toBe(`/looks/${ids.lookOpenId}`)
    expect(row?.dedupeKey).toContain('saved-activation:')

    // Idempotent: a second run in the same cooldown window sends nothing new.
    const second = await runSavedLookActivation(prisma, { now: NOW })
    expect(second.sent).toBe(0)
    expect(await countActivationNotifications(ids.clientEligibleId)).toBe(1)
  })
})
