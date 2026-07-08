// lib/personalization/tasteVectors.ts
//
// Taste-vector plumbing for the §6.0 visual layer: a user's taste vector is
// the decayed, signal-weighted average of the embeddings of what they
// liked/saved (spec §6.0), maintained globally per client and locally per
// board (§6.1). Vectors are recomputed from scratch on every refresh — never
// incrementally mutated — so the §6.2 exponential time decay stays exact
// without any stored per-signal state.
//
// Signals + weights deliberately mirror lib/looks/personalizedFeed.ts's category
// affinity (like < save, 75-day half-life, same sample bound): the visual
// vector and the categorical affinity are two projections of the same taste.
// Ranking consumption (cosine similarity against candidate embeddings, spec
// §4.4 visual_similarity) is a follow-up step — until then these rows are
// dark-loaded.
//
// The vector columns are pgvector Unsupported(...) fields, so persistence is
// raw SQL here (writes) + lookEmbeddingStore (reads), matching the
// ProfessionalSearchIndex pattern.

import { Prisma, PrismaClient } from '@prisma/client'

import {
  AFFINITY_LIKE_WEIGHT,
  AFFINITY_SAMPLE_SIZE,
  AFFINITY_SAVE_WEIGHT,
  BOARD_GLOBAL_BLEED_WEIGHT,
  computeAffinityDecayFactor,
} from '@/lib/looks/personalizedFeed'
import {
  fetchLookPostEmbeddings,
  serializeEmbeddingVector,
} from '@/lib/personalization/lookEmbeddingStore'

// The pure vector math lives in tasteVectorMath (no server imports) so both
// this writer and the personalized loader can share it without a circular import.
import {
  computeWeightedTasteVector,
  type TasteVectorSignal,
} from '@/lib/personalization/tasteVectorMath'

// Re-exported so existing importers of these symbols (and their tests) are
// unaffected by the move.
export {
  computeWeightedTasteVector,
  type TasteVectorSignal,
} from '@/lib/personalization/tasteVectorMath'

type TasteVectorDb = PrismaClient | Prisma.TransactionClient

export type RecomputeTasteVectorResult = {
  status: 'STORED' | 'CLEARED' | 'SKIPPED_NOT_FOUND'
  signalCount: number
}

async function upsertClientTasteVector(
  db: TasteVectorDb,
  args: {
    clientProfileId: string
    embedding: readonly number[]
    model: string
    signalCount: number
    now: Date
  },
): Promise<void> {
  const vectorText = serializeEmbeddingVector(args.embedding)

  await db.$executeRaw`
    INSERT INTO "ClientTasteVector"
      ("clientProfileId", "embedding", "model", "signalCount", "computedAt", "createdAt")
    VALUES
      (${args.clientProfileId}, ${vectorText}::vector, ${args.model}, ${args.signalCount}, ${args.now}, ${args.now})
    ON CONFLICT ("clientProfileId") DO UPDATE SET
      "embedding" = EXCLUDED."embedding",
      "model" = EXCLUDED."model",
      "signalCount" = EXCLUDED."signalCount",
      "computedAt" = EXCLUDED."computedAt"
  `
}

async function upsertBoardTasteVector(
  db: TasteVectorDb,
  args: {
    boardId: string
    embedding: readonly number[]
    model: string
    signalCount: number
    now: Date
  },
): Promise<void> {
  const vectorText = serializeEmbeddingVector(args.embedding)

  await db.$executeRaw`
    INSERT INTO "BoardTasteVector"
      ("boardId", "embedding", "model", "signalCount", "computedAt", "createdAt")
    VALUES
      (${args.boardId}, ${vectorText}::vector, ${args.model}, ${args.signalCount}, ${args.now}, ${args.now})
    ON CONFLICT ("boardId") DO UPDATE SET
      "embedding" = EXCLUDED."embedding",
      "model" = EXCLUDED."model",
      "signalCount" = EXCLUDED."signalCount",
      "computedAt" = EXCLUDED."computedAt"
  `
}

/**
 * Dominant embedding model among the contributing look vectors — stamped on
 * the taste row so a provider-model migration can find vectors mixing spaces.
 */
function dominantModel(models: readonly string[]): string {
  const counts = new Map<string, number>()
  let best = ''
  let bestCount = 0
  for (const model of models) {
    const next = (counts.get(model) ?? 0) + 1
    counts.set(model, next)
    if (next > bestCount) {
      best = model
      bestCount = next
    }
  }
  return best
}

async function fetchEmbeddingModels(
  db: TasteVectorDb,
  lookPostIds: readonly string[],
): Promise<Map<string, string>> {
  const ids = [...new Set(lookPostIds)]
  if (ids.length === 0) return new Map()

  const rows = await db.lookPostEmbedding.findMany({
    where: { lookPostId: { in: ids } },
    select: { lookPostId: true, model: true },
  })

  return new Map(rows.map((row) => [row.lookPostId, row.model]))
}

/**
 * Recompute the client's global taste vector (§6.1 global_taste_embedding)
 * from their recent likes + board saves. Signals on looks without an embedding
 * contribute nothing (yet) — the vector self-heals as the embed backfill runs.
 */
export async function recomputeClientTasteVector(
  db: TasteVectorDb,
  args: { clientProfileId: string; now: Date },
): Promise<RecomputeTasteVectorResult> {
  const client = await db.clientProfile.findUnique({
    where: { id: args.clientProfileId },
    select: { id: true, userId: true },
  })
  if (!client) {
    return { status: 'SKIPPED_NOT_FOUND', signalCount: 0 }
  }

  const [likes, saves] = await Promise.all([
    client.userId
      ? db.lookLike.findMany({
          where: { userId: client.userId },
          orderBy: { createdAt: 'desc' },
          take: AFFINITY_SAMPLE_SIZE,
          select: { lookPostId: true, createdAt: true },
        })
      : Promise.resolve([]),
    db.boardItem.findMany({
      where: { board: { clientId: client.id } },
      orderBy: { createdAt: 'desc' },
      take: AFFINITY_SAMPLE_SIZE,
      select: { lookPostId: true, createdAt: true },
    }),
  ])

  const weighted = [
    ...likes.map((like) => ({
      lookPostId: like.lookPostId,
      weight:
        AFFINITY_LIKE_WEIGHT *
        computeAffinityDecayFactor(like.createdAt, args.now),
    })),
    // §6.2 separation rule: board saves bleed into the client's GLOBAL taste
    // vector at only BOARD_GLOBAL_BLEED_WEIGHT of their strength, so an active
    // board doesn't dominate the discovery feed's visual taste. Likes (Looks-feed
    // engagement) keep full weight; recomputeBoardTasteVector below keeps the full
    // save weight LOCALLY, so the board's own feed is unaffected and the bleed
    // stays one-directional.
    ...saves.map((save) => ({
      lookPostId: save.lookPostId,
      weight:
        AFFINITY_SAVE_WEIGHT *
        BOARD_GLOBAL_BLEED_WEIGHT *
        computeAffinityDecayFactor(save.createdAt, args.now),
    })),
  ]

  return storeTasteVector(db, {
    weighted,
    now: args.now,
    persist: (payload) =>
      upsertClientTasteVector(db, {
        clientProfileId: client.id,
        ...payload,
      }),
    clear: async () => {
      await db.clientTasteVector.deleteMany({
        where: { clientProfileId: client.id },
      })
    },
  })
}

/**
 * Recompute one board's local taste vector (§6.1 local_taste_embedding) from
 * the board's saved looks. All items are saves, so they share one weight and
 * differ only by decay.
 */
export async function recomputeBoardTasteVector(
  db: TasteVectorDb,
  args: { boardId: string; now: Date },
): Promise<RecomputeTasteVectorResult> {
  const board = await db.board.findUnique({
    where: { id: args.boardId },
    select: { id: true },
  })
  if (!board) {
    return { status: 'SKIPPED_NOT_FOUND', signalCount: 0 }
  }

  const items = await db.boardItem.findMany({
    where: { boardId: board.id },
    orderBy: { createdAt: 'desc' },
    take: AFFINITY_SAMPLE_SIZE,
    select: { lookPostId: true, createdAt: true },
  })

  const weighted = items.map((item) => ({
    lookPostId: item.lookPostId,
    weight:
      AFFINITY_SAVE_WEIGHT *
      computeAffinityDecayFactor(item.createdAt, args.now),
  }))

  return storeTasteVector(db, {
    weighted,
    now: args.now,
    persist: (payload) =>
      upsertBoardTasteVector(db, {
        boardId: board.id,
        ...payload,
      }),
    clear: async () => {
      await db.boardTasteVector.deleteMany({ where: { boardId: board.id } })
    },
  })
}

async function storeTasteVector(
  db: TasteVectorDb,
  args: {
    weighted: ReadonlyArray<{ lookPostId: string; weight: number }>
    now: Date
    persist: (payload: {
      embedding: number[]
      model: string
      signalCount: number
      now: Date
    }) => Promise<void>
    clear: () => Promise<void>
  },
): Promise<RecomputeTasteVectorResult> {
  const lookPostIds = args.weighted.map((entry) => entry.lookPostId)
  const [embeddings, models] = await Promise.all([
    fetchLookPostEmbeddings(db, lookPostIds),
    fetchEmbeddingModels(db, lookPostIds),
  ])

  const signals: TasteVectorSignal[] = []
  const contributingModels: string[] = []
  for (const entry of args.weighted) {
    const embedding = embeddings.get(entry.lookPostId)
    if (!embedding) continue
    signals.push({ embedding, weight: entry.weight })
    const model = models.get(entry.lookPostId)
    if (model) contributingModels.push(model)
  }

  const vector = computeWeightedTasteVector(signals)
  if (!vector) {
    await args.clear()
    return { status: 'CLEARED', signalCount: 0 }
  }

  await args.persist({
    embedding: vector,
    model: dominantModel(contributingModels),
    signalCount: signals.length,
    now: args.now,
  })

  return { status: 'STORED', signalCount: signals.length }
}

// Sweep bound: how many clients/boards one refresh run will recompute. At
// launch scale this covers everyone with signals; once it doesn't, the sweep
// still converges because it orders deterministically and runs daily — but the
// right upgrade then is signal-driven recompute, not a bigger bound.
const TASTE_VECTOR_SWEEP_LIMIT = 500

export type RefreshTasteVectorsResult = {
  clientsScanned: number
  clientsStored: number
  boardsScanned: number
  boardsStored: number
  computedAt: Date
}

/**
 * Daily sweep (cron: /api/internal/jobs/taste-vectors): recompute the taste
 * vector of every client with any like/save history and every board with
 * items, bounded by TASTE_VECTOR_SWEEP_LIMIT each. Recompute-from-scratch
 * makes the sweep idempotent and lets it pick up decay drift, newly embedded
 * looks, and deleted signals in one pass.
 */
export async function refreshTasteVectors(
  db: TasteVectorDb,
  now: Date,
): Promise<RefreshTasteVectorsResult> {
  const [likeUsers, saveBoards] = await Promise.all([
    db.lookLike.findMany({
      distinct: ['userId'],
      orderBy: { userId: 'asc' },
      take: TASTE_VECTOR_SWEEP_LIMIT,
      select: { userId: true },
    }),
    db.boardItem.findMany({
      distinct: ['boardId'],
      orderBy: { boardId: 'asc' },
      take: TASTE_VECTOR_SWEEP_LIMIT,
      select: { boardId: true, board: { select: { clientId: true } } },
    }),
  ])

  const clientIds = new Set<string>()
  const likeClientRows = await db.clientProfile.findMany({
    where: { userId: { in: likeUsers.map((row) => row.userId) } },
    select: { id: true },
  })
  for (const row of likeClientRows) clientIds.add(row.id)
  for (const row of saveBoards) clientIds.add(row.board.clientId)

  let clientsStored = 0
  for (const clientProfileId of [...clientIds].slice(0, TASTE_VECTOR_SWEEP_LIMIT)) {
    const result = await recomputeClientTasteVector(db, {
      clientProfileId,
      now,
    })
    if (result.status === 'STORED') clientsStored += 1
  }

  let boardsStored = 0
  for (const row of saveBoards) {
    const result = await recomputeBoardTasteVector(db, {
      boardId: row.boardId,
      now,
    })
    if (result.status === 'STORED') boardsStored += 1
  }

  return {
    clientsScanned: clientIds.size,
    clientsStored,
    boardsScanned: saveBoards.length,
    boardsStored,
    computedAt: now,
  }
}
