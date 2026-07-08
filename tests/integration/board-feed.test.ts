// tests/integration/board-feed.test.ts
//
// Real-Postgres smoke for the §4.4 board-feed scoring surface. Runs against the
// docker test database (pgvector image; `pnpm db:test:push` enables the vector
// extension):
//   pnpm test:integration
//
// Covers what unit mocks can't — that a board's declared answers + its
// saved-look taste vector actually steer buildBoardFeedPage's ordering against
// real rows, and that the board's own saved looks are excluded from its
// recommendations. buildBoardFeedPage runs on the app prisma singleton, which
// (like every integration test here) points at DATABASE_URL = the test DB.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  BoardType,
  LookPostStatus,
  MediaType,
  ModerationStatus,
  Prisma,
  PrismaClient,
  Role,
  VerificationStatus,
} from '@prisma/client'

import { LOOK_EMBEDDING_DIMENSIONS } from '@/lib/personalization/lookEmbedding'
import { upsertLookPostEmbedding } from '@/lib/personalization/lookEmbeddingStore'
import { recomputeBoardTasteVector } from '@/lib/personalization/tasteVectors'
import {
  buildBoardFeedPage,
  loadBoardFeedContext,
} from '@/lib/looks/boardFeed'
import { rootTenantContext } from '@/lib/tenant/context'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error('Missing DATABASE_URL. Run with: pnpm test:integration')
}

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

const TAG = `boardfeed_${Date.now()}`
const MODEL = 'voyage-multimodal-3.5'
const NOW = new Date()

function axisVector(axis: number): number[] {
  const v = new Array<number>(LOOK_EMBEDDING_DIMENSIONS).fill(0)
  v[axis] = 1
  return v
}

let tenantId = ''
let clientId = ''
let boardId = ''
let matchLookId = ''
let plainLookId = ''
let savedLookId = ''

beforeAll(async () => {
  const tenant = await db.tenant.upsert({
    where: { slug: 'tovis-root' },
    update: {},
    create: { slug: 'tovis-root', name: 'TOVIS', isActive: true },
    select: { id: true },
  })
  tenantId = tenant.id

  const clientUser = await db.user.create({
    data: { email: `${TAG}_client@example.com`, password: 'x', role: Role.CLIENT },
    select: { id: true },
  })
  const client = await db.clientProfile.create({
    data: {
      userId: clientUser.id,
      homeTenantId: tenant.id,
      firstName: 'Board',
      lastName: 'Feed',
    },
    select: { id: true },
  })
  clientId = client.id

  const proUser = await db.user.create({
    data: { email: `${TAG}_pro@example.com`, password: 'x', role: Role.PRO },
    select: { id: true },
  })
  const professional = await db.professionalProfile.create({
    data: {
      userId: proUser.id,
      homeTenantId: tenant.id,
      firstName: 'Rec',
      lastName: 'Pro',
      businessName: `${TAG} Studio`,
      timeZone: 'America/Los_Angeles',
      // Must be publicly approved or the discovery filter drops its looks.
      verificationStatus: VerificationStatus.APPROVED,
    },
    select: { id: true },
  })

  const category = await db.serviceCategory.create({
    data: { name: `${TAG} Cat`, slug: `${TAG}-cat`, isActive: true },
    select: { id: true },
  })
  const service = await db.service.create({
    data: {
      name: `${TAG} Color`,
      categoryId: category.id,
      defaultDurationMinutes: 60,
      minPrice: new Prisma.Decimal('100.00'),
      isActive: true,
    },
    select: { id: true },
  })

  async function createLook(args: {
    suffix: string
    rankScore: number
    tagSlug?: string
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
        serviceId: service.id,
        status: LookPostStatus.PUBLISHED,
        moderationStatus: ModerationStatus.APPROVED,
        publishedAt: NOW,
        rankScore: args.rankScore,
        ...(args.tagSlug
          ? {
              tags: {
                connectOrCreate: {
                  where: { slug: args.tagSlug },
                  create: { slug: args.tagSlug, display: args.tagSlug },
                },
              },
            }
          : {}),
      },
      select: { id: true },
    })
    return look.id
  }

  // A lower-rankScore look that MATCHES the board's dream_color answer ('blonde'
  // → tag 'blonde') and the board's taste axis; must still out-rank the plain
  // higher-rankScore look via the §4.4 boosts.
  matchLookId = await createLook({ suffix: 'match', rankScore: 5, tagSlug: 'blonde' })
  // A higher-rankScore look with nothing board-specific about it.
  plainLookId = await createLook({ suffix: 'plain', rankScore: 15 })
  // A published look already saved to the board — must be EXCLUDED from recs.
  savedLookId = await createLook({ suffix: 'saved', rankScore: 50 })

  const board = await db.board.create({
    data: {
      clientId,
      name: `${TAG} board`,
      slug: `${TAG}-board`,
      type: BoardType.COLOR_TRANSFORMATION,
      answers: { dream_color: 'blonde' },
    },
    select: { id: true },
  })
  boardId = board.id

  // Save one look to the board and embed it on axis 0 → the board taste vector
  // points at axis 0. The matching look is embedded on axis 0 too (visual hit);
  // the plain look on an orthogonal axis (visual miss).
  await db.boardItem.create({ data: { boardId, lookPostId: savedLookId } })
  await upsertLookPostEmbedding(db, {
    lookPostId: savedLookId,
    mediaAssetId: 'seed_saved',
    model: MODEL,
    embedding: axisVector(0),
    now: NOW,
  })
  await upsertLookPostEmbedding(db, {
    lookPostId: matchLookId,
    mediaAssetId: 'seed_match',
    model: MODEL,
    embedding: axisVector(0),
    now: NOW,
  })
  await upsertLookPostEmbedding(db, {
    lookPostId: plainLookId,
    mediaAssetId: 'seed_plain',
    model: MODEL,
    embedding: axisVector(7),
    now: NOW,
  })

  await recomputeBoardTasteVector(db, { boardId, now: NOW })
})

afterAll(async () => {
  await db.board.deleteMany({ where: { id: boardId } })
  await db.lookPost.deleteMany({
    where: { id: { in: [matchLookId, plainLookId, savedLookId] } },
  })
  await db.lookTag.deleteMany({ where: { slug: 'blonde', display: 'blonde' } })
  await db.mediaAsset.deleteMany({ where: { storagePath: { startsWith: TAG } } })
  await db.service.deleteMany({ where: { name: `${TAG} Color` } })
  await db.serviceCategory.deleteMany({ where: { slug: `${TAG}-cat` } })
  await db.clientProfile.deleteMany({ where: { id: clientId } })
  await db.professionalProfile.deleteMany({
    where: { businessName: `${TAG} Studio` },
  })
  await db.user.deleteMany({ where: { email: { startsWith: TAG } } })
  await db.$disconnect()
})

describe('§4.4 board feed (real Postgres + pgvector)', () => {
  it('resolves the board context: answer slugs + taste vector', async () => {
    const ctx = await loadBoardFeedContext({
      board: {
        id: boardId,
        clientId,
        type: BoardType.COLOR_TRANSFORMATION,
        eventDate: null,
        answers: { dream_color: 'blonde' },
      },
      now: NOW,
    })

    expect([...ctx.answerTagSlugs]).toContain('blonde')
    expect(ctx.tasteVector).not.toBeNull()
    expect(ctx.tasteSignalCount).toBe(1)
    // COLOR_TRANSFORMATION carries no event date → 0.5 proximity on its tags.
    expect(ctx.occasionTagWeights.get('balayage')).toBeCloseTo(0.5, 5)
  })

  it('steers a lower-rankScore answer/taste match above a plain higher-rankScore look, and excludes saved looks', async () => {
    const page = await buildBoardFeedPage({
      tenant: rootTenantContext(tenantId),
      board: {
        id: boardId,
        clientId,
        type: BoardType.COLOR_TRANSFORMATION,
        eventDate: null,
        answers: { dream_color: 'blonde' },
      },
      limit: 12,
      cursor: null,
      seenLookIds: new Set(),
      now: NOW,
    })

    const ids = page.items.map((item) => item.id)

    // The board's own saved look is never recommended back to it.
    expect(ids).not.toContain(savedLookId)
    // Both candidates surface; the answer/taste match leads despite its lower
    // global rankScore.
    expect(ids).toContain(matchLookId)
    expect(ids).toContain(plainLookId)
    expect(ids.indexOf(matchLookId)).toBeLessThan(ids.indexOf(plainLookId))

    expect(page.meta.answerTagCount).toBeGreaterThan(0)
    expect(page.meta.tasteSignalCount).toBe(1)
    expect(page.meta.savedExcludedCount).toBe(1)
  })
})
