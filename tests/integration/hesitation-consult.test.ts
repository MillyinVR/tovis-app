// tests/integration/hesitation-consult.test.ts
//
// Real-Postgres coverage for runHesitationConsultNudges (personalization spec §6.8
// hesitation blocker response, gated by the §8.1 re-engagement budget). Exercises
// the end-to-end scan on a real DB: an aging save on a HIGH/MEDIUM-commitment look
// whose pro the client never booked produces exactly one SAVED_LOOK_CONSULT_NUDGE
// client notification + its dispatch (the budget ledger), while the exclusion paths
// (already booked, save too fresh, non-consult-worthy category) produce none — and a
// second run is idempotent (dedupe).
//
// Runs via `npm run test:integration` (test DB :5433). The shared test DB is SEEDED
// — this test scopes every fixture with a unique tag and cleans up only its own
// rows. The one shared reference row it may touch is the `permanent-makeup`
// ServiceCategory (a KNOWN consult-worthy slug): it is upserted by slug and only
// deleted again if this test created it.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
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
import { runHesitationConsultNudges } from '@/lib/notifications/hesitationConsultNudge'

if (!process.env.DATABASE_URL) {
  throw new Error(
    'Missing DATABASE_URL. Run this test with: npm run test:integration',
  )
}

const NOW = new Date('2026-07-15T12:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000
const TAG = `consultnudge_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

// A KNOWN consult-worthy (HIGH-commitment) slug from commitmentTiers.ts.
const CONSULT_SLUG = 'permanent-makeup'

type Ids = {
  tenantId: string
  proId: string
  consultCategoryId: string
  createdConsultCategory: boolean
  plainCategoryId: string
  consultServiceId: string
  plainServiceId: string
  locationId: string
  consultLookId: string
  plainLookId: string
  clientEligibleId: string
  clientBookedId: string
  clientFreshId: string
  clientLowCommitId: string
  userIds: string[]
}

let ids: Ids

async function cleanup(): Promise<void> {
  if (!ids) return
  const clientIds = [
    ids.clientEligibleId,
    ids.clientBookedId,
    ids.clientFreshId,
    ids.clientLowCommitId,
  ]

  await prisma.notificationDispatch.deleteMany({
    where: { clientId: { in: clientIds } },
  })
  await prisma.clientNotification.deleteMany({
    where: { clientId: { in: clientIds } },
  })
  await prisma.boardItem.deleteMany({
    where: { lookPostId: { in: [ids.consultLookId, ids.plainLookId] } },
  })
  await prisma.board.deleteMany({ where: { clientId: { in: clientIds } } })
  await prisma.booking.deleteMany({ where: { professionalId: ids.proId } })
  await prisma.lookPost.deleteMany({
    where: { id: { in: [ids.consultLookId, ids.plainLookId] } },
  })
  await prisma.mediaAsset.deleteMany({ where: { professionalId: ids.proId } })
  await prisma.professionalLocation.deleteMany({
    where: { professionalId: ids.proId },
  })
  await prisma.service.deleteMany({
    where: { id: { in: [ids.consultServiceId, ids.plainServiceId] } },
  })
  await prisma.serviceCategory.deleteMany({ where: { id: ids.plainCategoryId } })
  // Only remove the shared consult-worthy category if THIS test created it.
  if (ids.createdConsultCategory) {
    await prisma.serviceCategory.deleteMany({
      where: { id: ids.consultCategoryId },
    })
  }
  await prisma.clientProfile.deleteMany({ where: { id: { in: clientIds } } })
  await prisma.professionalProfile.deleteMany({ where: { id: ids.proId } })
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

  const proUserId = await makeUser(Role.PRO, 'pro')
  userIds.push(proUserId)
  const pro = await prisma.professionalProfile.create({
    data: {
      userId: proUserId,
      homeTenantId: tenant.id,
      businessName: 'Ink Studio',
      timeZone: 'America/Los_Angeles',
    },
    select: { id: true },
  })

  // Consult-worthy category: reuse the seeded `permanent-makeup` row if present,
  // else create it (tracked so cleanup only removes what this test added).
  const existingConsult = await prisma.serviceCategory.findUnique({
    where: { slug: CONSULT_SLUG },
    select: { id: true },
  })
  let consultCategoryId: string
  let createdConsultCategory = false
  if (existingConsult) {
    consultCategoryId = existingConsult.id
  } else {
    const created = await prisma.serviceCategory.create({
      data: { name: `${TAG} PMU`, slug: CONSULT_SLUG, isActive: true },
      select: { id: true },
    })
    consultCategoryId = created.id
    createdConsultCategory = true
  }

  // A non-consult-worthy category (TAG-scoped, unknown slug → excluded).
  const plainCategory = await prisma.serviceCategory.create({
    data: { name: `${TAG} Plain`, slug: `${TAG}-plain`, isActive: true },
    select: { id: true },
  })

  const makeService = async (categoryId: string, suffix: string) => {
    const service = await prisma.service.create({
      data: {
        name: `${TAG} ${suffix}`,
        categoryId,
        defaultDurationMinutes: 60,
        minPrice: new Prisma.Decimal('120.00'),
        isActive: true,
      },
      select: { id: true },
    })
    return service.id
  }

  const consultServiceId = await makeService(consultCategoryId, 'Consult Service')
  const plainServiceId = await makeService(plainCategory.id, 'Plain Service')

  const location = await prisma.professionalLocation.create({
    data: {
      professionalId: pro.id,
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

  const makeLook = async (serviceId: string, suffix: string) => {
    const media = await prisma.mediaAsset.create({
      data: {
        professionalId: pro.id,
        proTenantId: tenant.id,
        primaryServiceId: serviceId,
        mediaType: MediaType.IMAGE,
        storageBucket: 'media-public',
        storagePath: `${TAG}/${suffix}.jpg`,
      },
      select: { id: true },
    })
    const look = await prisma.lookPost.create({
      data: {
        professionalId: pro.id,
        primaryMediaAssetId: media.id,
        serviceId,
        status: LookPostStatus.PUBLISHED,
        moderationStatus: ModerationStatus.APPROVED,
        publishedAt: NOW,
        rankScore: 10,
      },
      select: { id: true },
    })
    return look.id
  }

  const consultLookId = await makeLook(consultServiceId, 'consult')
  const plainLookId = await makeLook(plainServiceId, 'plain')

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
  const clientFreshId = await makeClient('fresh')
  const clientLowCommitId = await makeClient('lowcommit')

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

  // Eligible: aged save on the consult-worthy look, never booked.
  await saveLook({ clientId: clientEligibleId, lookPostId: consultLookId, ageDays: 10 })
  // Excluded — already booked this pro.
  await saveLook({ clientId: clientBookedId, lookPostId: consultLookId, ageDays: 10 })
  // Excluded — save too fresh (< minSaveAge).
  await saveLook({ clientId: clientFreshId, lookPostId: consultLookId, ageDays: 1 })
  // Excluded — aged save, but the look's category is NOT consult-worthy.
  await saveLook({ clientId: clientLowCommitId, lookPostId: plainLookId, ageDays: 10 })

  // The "already booked" client has a booking with the pro.
  await prisma.booking.create({
    data: {
      clientId: clientBookedId,
      professionalId: pro.id,
      proTenantId: tenant.id,
      clientHomeTenantId: tenant.id,
      serviceId: consultServiceId,
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
      subtotalSnapshot: new Prisma.Decimal('120.00'),
      totalDurationMinutes: 60,
      bufferMinutes: 15,
    },
    select: { id: true },
  })

  return {
    tenantId: tenant.id,
    proId: pro.id,
    consultCategoryId,
    createdConsultCategory,
    plainCategoryId: plainCategory.id,
    consultServiceId,
    plainServiceId,
    locationId: location.id,
    consultLookId,
    plainLookId,
    clientEligibleId,
    clientBookedId,
    clientFreshId,
    clientLowCommitId,
    userIds,
  }
}

async function countConsultNotifications(clientId: string): Promise<number> {
  return prisma.clientNotification.count({
    where: {
      clientId,
      eventKey: NotificationEventKey.SAVED_LOOK_CONSULT_NUDGE,
    },
  })
}

beforeAll(async () => {
  ids = await seed()
})

afterAll(async () => {
  await cleanup()
})

describe('runHesitationConsultNudges (real DB)', () => {
  it('nudges only the eligible high-commitment saved-not-booked client, and is idempotent', async () => {
    const first = await runHesitationConsultNudges(prisma, { now: NOW })

    // Only one aging consult-worthy save survives every filter.
    expect(first.sent).toBe(1)

    expect(await countConsultNotifications(ids.clientEligibleId)).toBe(1)
    expect(await countConsultNotifications(ids.clientBookedId)).toBe(0)
    expect(await countConsultNotifications(ids.clientFreshId)).toBe(0)
    expect(await countConsultNotifications(ids.clientLowCommitId)).toBe(0)

    // The send created a dispatch — the pooled budget ledger (§8.1).
    const dispatches = await prisma.notificationDispatch.count({
      where: {
        clientId: ids.clientEligibleId,
        eventKey: NotificationEventKey.SAVED_LOOK_CONSULT_NUDGE,
      },
    })
    expect(dispatches).toBe(1)

    // The inbox row deep-links to the pro's public profile and carries the
    // cooldown-bucketed dedupeKey + the "have questions?" copy.
    const row = await prisma.clientNotification.findFirst({
      where: {
        clientId: ids.clientEligibleId,
        eventKey: NotificationEventKey.SAVED_LOOK_CONSULT_NUDGE,
      },
      select: { href: true, dedupeKey: true, title: true },
    })
    expect(row?.href).toBe(`/professionals/${ids.proId}`)
    expect(row?.dedupeKey).toContain('saved-consult:')
    expect(row?.title).toBe('Have questions for Ink Studio?')

    // Idempotent: a second run in the same cooldown window sends nothing new.
    const second = await runHesitationConsultNudges(prisma, { now: NOW })
    expect(second.sent).toBe(0)
    expect(await countConsultNotifications(ids.clientEligibleId)).toBe(1)
  })
})
