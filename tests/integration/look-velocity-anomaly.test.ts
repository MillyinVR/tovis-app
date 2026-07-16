// tests/integration/look-velocity-anomaly.test.ts
//
// Real-Postgres coverage for detectLookVelocityAnomalies — the §5.6 anti-gaming
// velocity-anomaly reader (lib/looks/velocityAnomaly.ts). Runs against the docker
// test database:
//   node scripts/with-test-db.mjs npx vitest run \
//     tests/integration/look-velocity-anomaly.test.ts \
//     --config vitest.integration.config.mts
//
// Covers what unit mocks can't — that the window scan (a) counts window saves
// from BoardItem and reads the per-day LookPostImpressionStat breakdown, (b)
// flags a look whose saves outrun its impressions (RATE_ANOMALY), (c) leaves a
// healthy look (saves well under impressions) unflagged, (d) flags an old look
// whose window engagement spikes far above its prior daily rate
// (HISTORICAL_SPIKE), and (e) excludes an unpublished look even when its
// engagement is impossible. Assertions are scoped to this test's own looks
// (unique TAG), never table totals — the shared test DB is seeded.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  LookImpressionSource,
  LookPostStatus,
  MediaType,
  ModerationStatus,
  Prisma,
  PrismaClient,
  Role,
  VerificationStatus,
} from '@prisma/client'

import {
  detectLookVelocityAnomalies,
  type LookVelocityAnomalyFinding,
} from '@/lib/looks/velocityAnomaly'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error('Missing DATABASE_URL. Run with the test DB harness.')
}

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

const TAG = `velanom_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
const NOW = new Date()
const DAY_MS = 24 * 60 * 60 * 1000

function utcMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

type Fixtures = {
  tenantId: string
  professionalId: string
  clientId: string
  abusiveId: string
  healthyId: string
  spikeId: string
  hiddenAbusiveId: string
}

let fx: Fixtures | null = null

async function cleanup(): Promise<void> {
  await db.lookPostImpressionStat.deleteMany({
    where: { lookPost: { professional: { businessName: `${TAG} Studio` } } },
  })
  await db.boardItem.deleteMany({
    where: { board: { client: { user: { email: { startsWith: TAG } } } } },
  })
  await db.board.deleteMany({
    where: { client: { user: { email: { startsWith: TAG } } } },
  })
  await db.lookPost.deleteMany({
    where: { professional: { businessName: `${TAG} Studio` } },
  })
  await db.mediaAsset.deleteMany({ where: { storagePath: { startsWith: TAG } } })
  await db.service.deleteMany({ where: { name: { startsWith: `${TAG} Svc` } } })
  await db.serviceCategory.deleteMany({ where: { slug: { startsWith: TAG } } })
  await db.professionalProfile.deleteMany({
    where: { businessName: `${TAG} Studio` },
  })
  await db.clientProfile.deleteMany({
    where: { user: { email: { startsWith: TAG } } },
  })
  await db.user.deleteMany({ where: { email: { startsWith: TAG } } })
}

async function seed(): Promise<Fixtures> {
  const tenant = await db.tenant.upsert({
    where: { slug: 'tovis-root' },
    update: {},
    create: { slug: 'tovis-root', name: 'TOVIS', isActive: true },
    select: { id: true },
  })

  const proUser = await db.user.create({
    data: { email: `${TAG}_pro@example.com`, password: 'x', role: Role.PRO },
    select: { id: true },
  })
  const professional = await db.professionalProfile.create({
    data: {
      userId: proUser.id,
      homeTenantId: tenant.id,
      firstName: 'Vel',
      lastName: 'Pro',
      businessName: `${TAG} Studio`,
      handle: `${TAG}-studio`,
      timeZone: 'America/Los_Angeles',
      verificationStatus: VerificationStatus.APPROVED,
    },
    select: { id: true },
  })

  const clientUser = await db.user.create({
    data: { email: `${TAG}_client@example.com`, password: 'x', role: Role.CLIENT },
    select: { id: true },
  })
  const client = await db.clientProfile.create({
    data: { userId: clientUser.id, homeTenantId: tenant.id, firstName: 'C', lastName: 'C' },
    select: { id: true },
  })

  const category = await db.serviceCategory.create({
    data: { name: `${TAG} Category`, slug: `${TAG}-category`, isActive: true },
    select: { id: true },
  })
  const service = await db.service.create({
    data: {
      name: `${TAG} Svc`,
      categoryId: category.id,
      defaultDurationMinutes: 60,
      minPrice: new Prisma.Decimal('100.00'),
      isActive: true,
    },
    select: { id: true },
  })

  async function createLook(args: {
    suffix: string
    lifetimeSaveCount: number
    createdAt: Date
    status?: LookPostStatus
    moderationStatus?: ModerationStatus
  }): Promise<string> {
    const media = await db.mediaAsset.create({
      data: {
        professionalId: professional.id,
        proTenantId: tenant.id,
        primaryServiceId: service.id,
        mediaType: MediaType.IMAGE,
        storageBucket: 'media-public',
        storagePath: `${TAG}/${args.suffix}.jpg`,
      },
      select: { id: true },
    })
    const look = await db.lookPost.create({
      data: {
        professionalId: professional.id,
        primaryMediaAssetId: media.id,
        status: args.status ?? LookPostStatus.PUBLISHED,
        moderationStatus: args.moderationStatus ?? ModerationStatus.APPROVED,
        publishedAt: args.createdAt,
        createdAt: args.createdAt,
        saveCount: args.lifetimeSaveCount,
      },
      select: { id: true },
    })
    return look.id
  }

  // Seed `count` window saves on a look: one board + item per save (a BoardItem
  // is unique per (board, look), so distinct saves need distinct boards). All
  // created "now" → inside the window.
  async function addWindowSaves(lookId: string, suffix: string, count: number) {
    for (let i = 0; i < count; i++) {
      const board = await db.board.create({
        data: {
          clientId: client.id,
          name: `${TAG} ${suffix} ${i}`,
          slug: `${TAG}-${suffix}-${i}`,
        },
        select: { id: true },
      })
      await db.boardItem.create({
        data: { boardId: board.id, lookPostId: lookId },
      })
    }
  }

  async function addImpressions(lookId: string, count: number) {
    if (count <= 0) return
    await db.lookPostImpressionStat.create({
      data: {
        lookPostId: lookId,
        source: LookImpressionSource.FEED,
        windowDate: utcMidnight(NOW),
        count,
      },
    })
  }

  // Abusive: 15 saves in the window, only 2 recorded impressions → ratio 7.5×.
  const abusiveId = await createLook({
    suffix: 'abusive',
    lifetimeSaveCount: 15,
    createdAt: NOW,
  })
  await addWindowSaves(abusiveId, 'abusive', 15)
  await addImpressions(abusiveId, 2)

  // Healthy: 15 saves in the window, 2000 impressions → ratio 0.0075×.
  const healthyId = await createLook({
    suffix: 'healthy',
    lifetimeSaveCount: 15,
    createdAt: NOW,
  })
  await addWindowSaves(healthyId, 'healthy', 15)
  await addImpressions(healthyId, 2000)

  // Spike: 60 days old, lifetime 40 saves; 30 in the window (prior 10 over ~53d
  // ≈ 0.19/day; window 30/7 ≈ 4.3/day → ~23×). Big impressions → no rate flag,
  // so only HISTORICAL_SPIKE trips.
  const spikeId = await createLook({
    suffix: 'spike',
    lifetimeSaveCount: 40,
    createdAt: new Date(NOW.getTime() - 60 * DAY_MS),
  })
  await addWindowSaves(spikeId, 'spike', 30)
  await addImpressions(spikeId, 100000)

  // Hidden-abusive: impossible ratio but DRAFT → never feed-visible → excluded.
  const hiddenAbusiveId = await createLook({
    suffix: 'hidden',
    lifetimeSaveCount: 20,
    createdAt: NOW,
    status: LookPostStatus.DRAFT,
  })
  await addWindowSaves(hiddenAbusiveId, 'hidden', 20)
  await addImpressions(hiddenAbusiveId, 0)

  return {
    tenantId: tenant.id,
    professionalId: professional.id,
    clientId: client.id,
    abusiveId,
    healthyId,
    spikeId,
    hiddenAbusiveId,
  }
}

function byId(
  anomalies: LookVelocityAnomalyFinding[],
  id: string,
): LookVelocityAnomalyFinding | undefined {
  return anomalies.find((a) => a.lookPostId === id)
}

beforeAll(async () => {
  await cleanup()
  fx = await seed()
}, 60_000)

afterAll(async () => {
  await cleanup()
  await db.$disconnect()
})

describe('detectLookVelocityAnomalies (integration)', () => {
  it('flags a look whose saves outrun its impressions (RATE_ANOMALY)', async () => {
    const f = fx!
    const result = await detectLookVelocityAnomalies(db, { now: NOW, limit: 200 })

    const abusive = byId(result.anomalies, f.abusiveId)
    expect(abusive).toBeDefined()
    expect(abusive?.reasons).toContain('RATE_ANOMALY')
    expect(abusive?.windowSaves).toBe(15)
    expect(abusive?.windowImpressions).toBe(2)
    expect(abusive?.rateRatio).toBeCloseTo(7.5)
    expect(abusive?.proHandle).toBe(`${TAG}-studio`)
    expect(abusive?.proLabel).toBe(`${TAG} Studio`)
  })

  it('does NOT flag a healthy look (saves well under impressions)', async () => {
    const f = fx!
    const result = await detectLookVelocityAnomalies(db, { now: NOW, limit: 200 })
    expect(byId(result.anomalies, f.healthyId)).toBeUndefined()
  })

  it('flags an old look whose engagement spikes above its history (HISTORICAL_SPIKE)', async () => {
    const f = fx!
    const result = await detectLookVelocityAnomalies(db, { now: NOW, limit: 200 })

    const spike = byId(result.anomalies, f.spikeId)
    expect(spike).toBeDefined()
    expect(spike?.reasons).toContain('HISTORICAL_SPIKE')
    // Big impressions → the rate check stays clean.
    expect(spike?.reasons).not.toContain('RATE_ANOMALY')
    expect(spike?.spikeMultiple).toBeGreaterThanOrEqual(5)
  })

  it('excludes an unpublished look even with an impossible ratio', async () => {
    const f = fx!
    const result = await detectLookVelocityAnomalies(db, { now: NOW, limit: 200 })
    expect(byId(result.anomalies, f.hiddenAbusiveId)).toBeUndefined()
  })

  it('sorts most-suspicious first and reports the window', async () => {
    const f = fx!
    const result = await detectLookVelocityAnomalies(db, {
      now: NOW,
      windowDays: 7,
      limit: 200,
    })
    expect(result.windowDays).toBe(7)
    // severities are non-increasing.
    for (let i = 1; i < result.anomalies.length; i++) {
      const prev = result.anomalies[i - 1]
      const curr = result.anomalies[i]
      if (!prev || !curr) continue
      expect(prev.severity).toBeGreaterThanOrEqual(curr.severity)
    }
    // Our abusive (ratio 7.5×) outranks our spike-only look in the queue.
    const abusive = byId(result.anomalies, f.abusiveId)
    const spike = byId(result.anomalies, f.spikeId)
    expect(abusive && spike).toBeTruthy()
    expect(abusive!.severity).toBeGreaterThan(spike!.severity)
  })
})
