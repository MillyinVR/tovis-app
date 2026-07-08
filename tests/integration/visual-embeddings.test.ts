// tests/integration/visual-embeddings.test.ts
//
// Real-Postgres smoke for the §6.0 visual-embedding pipeline. Runs against the
// docker test database (which must have pgvector — `pnpm db:test:push` enables
// it via db:test:extensions):
//   pnpm test:integration
//
// Covers what unit mocks can't:
// - the pgvector round-trip: raw upsert of a vector(1024) literal, ::text
//   readback, cosine-distance ordering with the <=> operator
// - recomputeClientTasteVector / recomputeBoardTasteVector end-to-end against
//   real like/board-item rows (weighting, upsert, clear-on-empty)
// - the refreshTasteVectors sweep discovering signal owners

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  LookPostStatus,
  MediaType,
  ModerationStatus,
  Prisma,
  PrismaClient,
  Role,
} from '@prisma/client'

import { LOOK_EMBEDDING_DIMENSIONS } from '@/lib/personalization/lookEmbedding'
import {
  fetchClientTasteVector,
  fetchLookPostEmbeddings,
  upsertLookPostEmbedding,
} from '@/lib/personalization/lookEmbeddingStore'
import {
  recomputeBoardTasteVector,
  recomputeClientTasteVector,
  refreshTasteVectors,
} from '@/lib/personalization/tasteVectors'
import {
  computeForYouScore,
  rankForYouRows,
  type ForYouRankableRow,
  type ForYouViewerAffinity,
} from '@/lib/looks/forYouRanking'
import { loadForYouAffinity } from '@/lib/looks/forYouFeed'

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error(
    'Missing DATABASE_URL. Run this test with: pnpm test:integration',
  )
}

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

const TAG = `visemb_${Date.now()}`
const MODEL = 'voyage-multimodal-3.5'
const NOW = new Date()

function basisVector(axis: number): number[] {
  const vector = new Array<number>(LOOK_EMBEDDING_DIMENSIONS).fill(0)
  vector[axis] = 1
  return vector
}

let clientId = ''
let boardId = ''
let lookAId = ''
let lookBId = ''

beforeAll(async () => {
  const tenant = await db.tenant.upsert({
    where: { slug: 'tovis-root' },
    update: {},
    create: { slug: 'tovis-root', name: 'TOVIS', isActive: true },
    select: { id: true },
  })

  const clientUser = await db.user.create({
    data: {
      email: `${TAG}_client@example.com`,
      password: 'x',
      role: Role.CLIENT,
    },
    select: { id: true },
  })
  const client = await db.clientProfile.create({
    data: {
      userId: clientUser.id,
      homeTenantId: tenant.id,
      firstName: 'Taste',
      lastName: 'Vector',
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
      firstName: 'Vis',
      lastName: 'Embed',
      businessName: `${TAG} Studio`,
      timeZone: 'America/Los_Angeles',
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

  async function createLook(suffix: string): Promise<string> {
    const media = await db.mediaAsset.create({
      data: {
        professionalId: professional.id,
        proTenantId: tenant.id,
        primaryServiceId: service.id,
        mediaType: MediaType.IMAGE,
        storageBucket: 'media-public',
        storagePath: `${TAG}/${suffix}.jpg`,
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
      },
      select: { id: true },
    })
    return look.id
  }

  lookAId = await createLook('look-a')
  lookBId = await createLook('look-b')

  const board = await db.board.create({
    data: {
      clientId,
      name: `${TAG} board`,
      slug: `${TAG}-board`,
    },
    select: { id: true },
  })
  boardId = board.id
})

afterAll(async () => {
  // Embeddings/taste vectors cascade with their parents.
  await db.board.deleteMany({ where: { id: boardId } })
  await db.lookPost.deleteMany({ where: { id: { in: [lookAId, lookBId] } } })
  await db.mediaAsset.deleteMany({
    where: { storagePath: { startsWith: TAG } },
  })
  await db.service.deleteMany({ where: { name: `${TAG} Color` } })
  await db.serviceCategory.deleteMany({ where: { slug: `${TAG}-cat` } })
  await db.clientProfile.deleteMany({ where: { id: clientId } })
  await db.professionalProfile.deleteMany({
    where: { businessName: `${TAG} Studio` },
  })
  await db.user.deleteMany({ where: { email: { startsWith: TAG } } })
  await db.$disconnect()
})

describe('LookPostEmbedding raw-SQL store (real pgvector)', () => {
  it('upserts, reads back, and updates a vector(1024) row', async () => {
    await upsertLookPostEmbedding(db, {
      lookPostId: lookAId,
      mediaAssetId: 'asset_seed_a',
      model: MODEL,
      embedding: basisVector(0),
      now: NOW,
    })
    await upsertLookPostEmbedding(db, {
      lookPostId: lookBId,
      mediaAssetId: 'asset_seed_b',
      model: MODEL,
      embedding: basisVector(1),
      now: NOW,
    })

    const fetched = await fetchLookPostEmbeddings(db, [lookAId, lookBId])
    expect(fetched.get(lookAId)).toEqual(basisVector(0))
    expect(fetched.get(lookBId)).toEqual(basisVector(1))

    // Upsert-on-conflict replaces the vector and stamps the new asset.
    await upsertLookPostEmbedding(db, {
      lookPostId: lookAId,
      mediaAssetId: 'asset_seed_a2',
      model: MODEL,
      embedding: basisVector(2),
      now: NOW,
    })
    const updated = await fetchLookPostEmbeddings(db, [lookAId])
    expect(updated.get(lookAId)).toEqual(basisVector(2))
    const meta = await db.lookPostEmbedding.findUnique({
      where: { lookPostId: lookAId },
      select: { mediaAssetId: true, model: true },
    })
    expect(meta).toEqual({ mediaAssetId: 'asset_seed_a2', model: MODEL })
  })

  it('orders by cosine distance with the <=> operator', async () => {
    // Query vector = look A's axis: A must be nearer than B.
    const queryVector = `[${basisVector(2).join(',')}]`
    const rows = await db.$queryRaw<Array<{ lookPostId: string }>>`
      SELECT "lookPostId"
      FROM "LookPostEmbedding"
      WHERE "lookPostId" IN (${Prisma.join([lookAId, lookBId])})
      ORDER BY "embedding" <=> ${queryVector}::vector
    `
    expect(rows.map((row) => row.lookPostId)).toEqual([lookAId, lookBId])
  })
})

describe('taste vectors end-to-end (real signals)', () => {
  it('computes, stores, and clears the client + board vectors', async () => {
    const clientUser = await db.clientProfile.findUniqueOrThrow({
      where: { id: clientId },
      select: { userId: true },
    })

    // Like look A (weight 1), save look B on the board (weight 2).
    await db.lookLike.create({
      data: { lookPostId: lookAId, userId: clientUser.userId! },
    })
    await db.boardItem.create({
      data: { boardId, lookPostId: lookBId },
    })

    const clientResult = await recomputeClientTasteVector(db, {
      clientProfileId: clientId,
      now: new Date(),
    })
    expect(clientResult).toEqual({ status: 'STORED', signalCount: 2 })

    const stored = await db.$queryRaw<Array<{ text: string }>>`
      SELECT "embedding"::text AS "text"
      FROM "ClientTasteVector" WHERE "clientProfileId" = ${clientId}
    `
    expect(stored).toHaveLength(1)
    // Save (axis 1, weight 2) must outweigh like (axis 2 after re-upsert,
    // weight 1): component on look B's axis is the larger one.
    const vector = (stored[0]?.text ?? '')
      .slice(1, -1)
      .split(',')
      .map((part) => Number.parseFloat(part))
    expect(vector[1] ?? Number.NaN).toBeGreaterThan(vector[2] ?? Number.NaN)
    expect(vector[1] ?? Number.NaN).toBeCloseTo(2 / Math.sqrt(5), 3)

    const boardResult = await recomputeBoardTasteVector(db, {
      boardId,
      now: new Date(),
    })
    expect(boardResult).toEqual({ status: 'STORED', signalCount: 1 })

    const boardRow = await db.boardTasteVector.findUnique({
      where: { boardId },
      select: { signalCount: true, model: true },
    })
    expect(boardRow).toEqual({ signalCount: 1, model: MODEL })

    // The sweep discovers both owners from their signals.
    const sweep = await refreshTasteVectors(db, new Date())
    expect(sweep.clientsStored).toBeGreaterThanOrEqual(1)
    expect(sweep.boardsStored).toBeGreaterThanOrEqual(1)

    // Removing every signal clears the stored vectors.
    await db.lookLike.deleteMany({ where: { userId: clientUser.userId! } })
    await db.boardItem.deleteMany({ where: { boardId } })

    const clearedClient = await recomputeClientTasteVector(db, {
      clientProfileId: clientId,
      now: new Date(),
    })
    expect(clearedClient.status).toBe('CLEARED')
    const clearedBoard = await recomputeBoardTasteVector(db, {
      boardId,
      now: new Date(),
    })
    expect(clearedBoard.status).toBe('CLEARED')

    expect(
      await db.clientTasteVector.count({
        where: { clientProfileId: clientId },
      }),
    ).toBe(0)
    expect(await db.boardTasteVector.count({ where: { boardId } })).toBe(0)
  })
})

describe('ranking consumption: saved-look taste steers page order (real pgvector)', () => {
  it('reads the client taste vector by PK and lifts the visually-similar look', async () => {
    const clientUser = await db.clientProfile.findUniqueOrThrow({
      where: { id: clientId },
      select: { userId: true },
    })

    // Fresh, known embeddings: look A on axis 0, look B on axis 1 (orthogonal).
    await upsertLookPostEmbedding(db, {
      lookPostId: lookAId,
      mediaAssetId: 'asset_rank_a',
      model: MODEL,
      embedding: basisVector(0),
      now: NOW,
    })
    await upsertLookPostEmbedding(db, {
      lookPostId: lookBId,
      mediaAssetId: 'asset_rank_b',
      model: MODEL,
      embedding: basisVector(1),
      now: NOW,
    })

    // The viewer's only signal is a LIKE on look A → their taste vector aligns
    // with axis 0, i.e. look A's aesthetic.
    await db.lookLike.create({
      data: { lookPostId: lookAId, userId: clientUser.userId! },
    })
    const recomputed = await recomputeClientTasteVector(db, {
      clientProfileId: clientId,
      now: new Date(),
    })
    expect(recomputed.status).toBe('STORED')

    // The new reader returns the stored vector + its confidence signal count.
    const tasteRow = await fetchClientTasteVector(db, clientId)
    expect(tasteRow).not.toBeNull()
    expect(tasteRow?.embedding).toHaveLength(LOOK_EMBEDDING_DIMENSIONS)
    expect(tasteRow?.signalCount).toBe(recomputed.signalCount)

    const candidateEmbeddings = await fetchLookPostEmbeddings(db, [
      lookAId,
      lookBId,
    ])

    const affinity: ForYouViewerAffinity = {
      followedProfessionalIds: new Set(),
      categoryWeights: new Map(),
      occasionTagWeights: new Map(),
      tasteVector: tasteRow?.embedding ?? null,
      tasteSignalCount: tasteRow?.signalCount ?? 0,
    }

    function candidateRow(id: string): ForYouRankableRow {
      // Identical rankScore + publishedAt: the visual boost is the only thing
      // that can separate them, so an ordering flip proves it drove the sort.
      return {
        id,
        professionalId: 'pro',
        publishedAt: NOW,
        rankScore: 10,
        service: null,
        tags: null,
      }
    }

    const context = {
      affinity,
      seenLookIds: new Set<string>(),
      now: new Date(),
      candidateEmbeddings,
    }

    const scoreA = computeForYouScore(candidateRow(lookAId), context)
    const scoreB = computeForYouScore(candidateRow(lookBId), context)
    expect(scoreA).toBeGreaterThan(scoreB)

    // Input order is B-then-A; taste re-ranks A (viewer's aesthetic) to the top.
    const ranked = rankForYouRows(
      [candidateRow(lookBId), candidateRow(lookAId)],
      context,
    )
    expect(ranked.map((row) => row.id)).toEqual([lookAId, lookBId])

    await db.lookLike.deleteMany({ where: { userId: clientUser.userId! } })
  })
})

describe('§6.3 in-session responsiveness: a fresh save steers the feed now (real pgvector)', () => {
  it('seeds a taste lean from this sitting before any cron recompute', async () => {
    const clientUser = await db.clientProfile.findUniqueOrThrow({
      where: { id: clientId },
      select: { userId: true },
    })

    // Known orthogonal embeddings: look A on axis 0, look B on axis 1.
    await upsertLookPostEmbedding(db, {
      lookPostId: lookAId,
      mediaAssetId: 'asset_session_a',
      model: MODEL,
      embedding: basisVector(0),
      now: NOW,
    })
    await upsertLookPostEmbedding(db, {
      lookPostId: lookBId,
      mediaAssetId: 'asset_session_b',
      model: MODEL,
      embedding: basisVector(1),
      now: NOW,
    })

    // No cron recompute for this sitting → clear any vector a prior test stored
    // so we exercise the session-seed path (empty stored vector).
    await db.clientTasteVector.deleteMany({
      where: { clientProfileId: clientId },
    })
    expect(await fetchClientTasteVector(db, clientId)).toBeNull()

    // The viewer saves look B (axis 1) THIS sitting.
    const now = new Date()
    await db.boardItem.create({
      data: { boardId, lookPostId: lookBId },
    })

    // loadForYouAffinity reads via the shared prisma singleton (same test DB):
    // it must derive a session-seeded taste vector aligned with look B even
    // though the daily taste-vector cron has not run.
    const affinity = await loadForYouAffinity({
      userId: clientUser.userId!,
      clientId,
      now,
    })

    expect(affinity.sessionVisualSignalCount).toBe(1)
    expect(affinity.tasteSignalCount).toBe(1)
    expect(affinity.tasteVector).not.toBeNull()

    const candidateEmbeddings = await fetchLookPostEmbeddings(db, [
      lookAId,
      lookBId,
    ])
    function candidateRow(id: string): ForYouRankableRow {
      return {
        id,
        professionalId: 'pro',
        publishedAt: now,
        rankScore: 10,
        service: null,
        tags: null,
      }
    }
    const context = {
      affinity,
      seenLookIds: new Set<string>(),
      now,
      candidateEmbeddings,
    }

    // The just-saved look B (viewer's in-session aesthetic) now outscores A.
    expect(computeForYouScore(candidateRow(lookBId), context)).toBeGreaterThan(
      computeForYouScore(candidateRow(lookAId), context),
    )

    await db.boardItem.deleteMany({ where: { boardId } })
  })
})
