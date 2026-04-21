// lib/looks/counters.ts
import {
  LookPostStatus,
  ModerationStatus,
  Prisma,
  PrismaClient,
} from '@prisma/client'
import {
  computeLookPostRankScore as computeCentralLookPostRankScore,
  type LookPostRankScoreOptions,
} from '@/lib/looks/ranking'
import {
  computeLookPostSpotlightScore as computeCentralLookPostSpotlightScore,
  type LookPostSpotlightScoreOptions,
} from '@/lib/looks/spotlight'

type LooksCounterDb = Prisma.TransactionClient | PrismaClient

type PersistedLookPostMetricPatch = Pick<
  Prisma.LookPostUpdateInput,
  | 'likeCount'
  | 'commentCount'
  | 'saveCount'
  | 'spotlightScore'
  | 'rankScore'
>

type LookPostScoreSnapshot = {
  spotlightScore: number
  rankScore: number
}

type LookPostCounterSnapshot = {
  likeCount: number
  commentCount: number
  saveCount: number
  spotlightScore: number
  rankScore: number
}

const lookPostScoreSelect =
  Prisma.validator<Prisma.LookPostSelect>()({
    id: true,
    status: true,
    moderationStatus: true,
    publishedAt: true,
    likeCount: true,
    commentCount: true,
    saveCount: true,
    shareCount: true,
  })

type LookPostScoreRow = Prisma.LookPostGetPayload<{
  select: typeof lookPostScoreSelect
}>

export type LookPostScoreComputeOptions =
  LookPostRankScoreOptions & LookPostSpotlightScoreOptions

function normalizeRequiredId(name: string, value: string): string {
  const trimmed = value.trim()

  if (!trimmed) {
    throw new Error(`${name} is required.`)
  }

  return trimmed
}

async function persistLookPostMetrics(
  db: LooksCounterDb,
  lookPostId: string,
  data: PersistedLookPostMetricPatch,
): Promise<void> {
  await db.lookPost.update({
    where: { id: lookPostId },
    data,
    select: { id: true },
  })
}

async function countLookLikes(
  db: LooksCounterDb,
  lookPostId: string,
): Promise<number> {
  return db.lookLike.count({
    where: { lookPostId },
  })
}

async function countApprovedLookComments(
  db: LooksCounterDb,
  lookPostId: string,
): Promise<number> {
  return db.lookComment.count({
    where: {
      lookPostId,
      moderationStatus: ModerationStatus.APPROVED,
    },
  })
}

async function countLookSaves(
  db: LooksCounterDb,
  lookPostId: string,
): Promise<number> {
  return db.boardItem.count({
    where: { lookPostId },
  })
}

async function readLookPostScoreRow(
  db: LooksCounterDb,
  lookPostId: string,
): Promise<LookPostScoreRow> {
  const row = await db.lookPost.findUnique({
    where: { id: lookPostId },
    select: lookPostScoreSelect,
  })

  if (!row) {
    throw new Error('Look post not found.')
  }

  return row
}

export function computeLookPostSpotlightScore(
  row: Pick<
    LookPostScoreRow,
    | 'status'
    | 'moderationStatus'
    | 'publishedAt'
    | 'likeCount'
    | 'commentCount'
    | 'saveCount'
    | 'shareCount'
  >,
  options?: LookPostScoreComputeOptions,
): number {
  return computeCentralLookPostSpotlightScore(
    {
      status: row.status,
      moderationStatus: row.moderationStatus,
      publishedAt: row.publishedAt,
      likeCount: row.likeCount,
      commentCount: row.commentCount,
      saveCount: row.saveCount,
    },
    options,
  )
}

export function computeLookPostRankScore(
  row: Pick<
    LookPostScoreRow,
    | 'status'
    | 'moderationStatus'
    | 'publishedAt'
    | 'likeCount'
    | 'commentCount'
    | 'saveCount'
    | 'shareCount'
  >,
  options?: LookPostScoreComputeOptions,
): number {
  return computeCentralLookPostRankScore(
    {
      status: row.status,
      moderationStatus: row.moderationStatus,
      publishedAt: row.publishedAt,
      likeCount: row.likeCount,
      commentCount: row.commentCount,
      saveCount: row.saveCount,
    },
    options,
  )
}

function buildLookPostScoreSnapshot(
  row: Pick<
    LookPostScoreRow,
    | 'status'
    | 'moderationStatus'
    | 'publishedAt'
    | 'likeCount'
    | 'commentCount'
    | 'saveCount'
    | 'shareCount'
  >,
  options?: LookPostScoreComputeOptions,
): LookPostScoreSnapshot {
  return {
    spotlightScore: computeLookPostSpotlightScore(row, options),
    rankScore: computeLookPostRankScore(row, options),
  }
}

export async function recomputeLookPostSpotlightScore(
  db: LooksCounterDb,
  lookPostId: string,
  options?: LookPostScoreComputeOptions,
): Promise<number> {
  const normalizedLookPostId = normalizeRequiredId('lookPostId', lookPostId)
  const row = await readLookPostScoreRow(db, normalizedLookPostId)

  const spotlightScore = computeLookPostSpotlightScore(row, options)

  await persistLookPostMetrics(db, normalizedLookPostId, {
    spotlightScore,
  })

  return spotlightScore
}

export async function recomputeLookPostRankScore(
  db: LooksCounterDb,
  lookPostId: string,
  options?: LookPostScoreComputeOptions,
): Promise<number> {
  const normalizedLookPostId = normalizeRequiredId('lookPostId', lookPostId)
  const row = await readLookPostScoreRow(db, normalizedLookPostId)

  const rankScore = computeLookPostRankScore(row, options)

  await persistLookPostMetrics(db, normalizedLookPostId, {
    rankScore,
  })

  return rankScore
}

export async function recomputeLookPostScores(
  db: LooksCounterDb,
  lookPostId: string,
  options?: LookPostScoreComputeOptions,
): Promise<LookPostScoreSnapshot> {
  const normalizedLookPostId = normalizeRequiredId('lookPostId', lookPostId)
  const row = await readLookPostScoreRow(db, normalizedLookPostId)
  const scores = buildLookPostScoreSnapshot(row, options)

  await persistLookPostMetrics(db, normalizedLookPostId, scores)

  return scores
}

export async function recomputeLookPostLikeCount(
  db: LooksCounterDb,
  lookPostId: string,
  options?: LookPostScoreComputeOptions,
): Promise<number> {
  const normalizedLookPostId = normalizeRequiredId('lookPostId', lookPostId)

  const [likeCount, row] = await Promise.all([
    countLookLikes(db, normalizedLookPostId),
    readLookPostScoreRow(db, normalizedLookPostId),
  ])

  const scores = buildLookPostScoreSnapshot(
    {
      ...row,
      likeCount,
    },
    options,
  )

  await persistLookPostMetrics(db, normalizedLookPostId, {
    likeCount,
    ...scores,
  })

  return likeCount
}

export async function recomputeLookPostCommentCount(
  db: LooksCounterDb,
  lookPostId: string,
  options?: LookPostScoreComputeOptions,
): Promise<number> {
  const normalizedLookPostId = normalizeRequiredId('lookPostId', lookPostId)

  const [commentCount, row] = await Promise.all([
    countApprovedLookComments(db, normalizedLookPostId),
    readLookPostScoreRow(db, normalizedLookPostId),
  ])

  const scores = buildLookPostScoreSnapshot(
    {
      ...row,
      commentCount,
    },
    options,
  )

  await persistLookPostMetrics(db, normalizedLookPostId, {
    commentCount,
    ...scores,
  })

  return commentCount
}

export async function recomputeLookPostSaveCount(
  db: LooksCounterDb,
  lookPostId: string,
  options?: LookPostScoreComputeOptions,
): Promise<number> {
  const normalizedLookPostId = normalizeRequiredId('lookPostId', lookPostId)

  const [saveCount, row] = await Promise.all([
    countLookSaves(db, normalizedLookPostId),
    readLookPostScoreRow(db, normalizedLookPostId),
  ])

  const scores = buildLookPostScoreSnapshot(
    {
      ...row,
      saveCount,
    },
    options,
  )

  await persistLookPostMetrics(db, normalizedLookPostId, {
    saveCount,
    ...scores,
  })

  return saveCount
}

export async function recomputeLookPostCounters(
  db: LooksCounterDb,
  lookPostId: string,
  options?: LookPostScoreComputeOptions,
): Promise<LookPostCounterSnapshot> {
  const normalizedLookPostId = normalizeRequiredId('lookPostId', lookPostId)

  const [likeCount, commentCount, saveCount, row] = await Promise.all([
    countLookLikes(db, normalizedLookPostId),
    countApprovedLookComments(db, normalizedLookPostId),
    countLookSaves(db, normalizedLookPostId),
    readLookPostScoreRow(db, normalizedLookPostId),
  ])

  const scores = buildLookPostScoreSnapshot(
    {
      ...row,
      likeCount,
      commentCount,
      saveCount,
    },
    options,
  )

  await persistLookPostMetrics(db, normalizedLookPostId, {
    likeCount,
    commentCount,
    saveCount,
    ...scores,
  })

  return {
    likeCount,
    commentCount,
    saveCount,
    ...scores,
  }
}