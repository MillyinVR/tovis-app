// lib/looks/counters.ts
import {
  ModerationStatus,
  PrismaClient,
  type Prisma,
} from '@prisma/client'

type LooksCounterDb = Prisma.TransactionClient | PrismaClient

type PersistedLookPostCounterPatch = Pick<
  Prisma.LookPostUpdateInput,
  'likeCount' | 'commentCount' | 'saveCount'
>

type LookPostCounterSnapshot = {
  likeCount: number
  commentCount: number
  saveCount: number
}

async function persistLookPostCounters(
  db: LooksCounterDb,
  lookPostId: string,
  data: PersistedLookPostCounterPatch,
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

export async function recomputeLookPostLikeCount(
  db: LooksCounterDb,
  lookPostId: string,
): Promise<number> {
  const likeCount = await countLookLikes(db, lookPostId)

  await persistLookPostCounters(db, lookPostId, {
    likeCount,
  })

  return likeCount
}

export async function recomputeLookPostCommentCount(
  db: LooksCounterDb,
  lookPostId: string,
): Promise<number> {
  const commentCount = await countApprovedLookComments(db, lookPostId)

  await persistLookPostCounters(db, lookPostId, {
    commentCount,
  })

  return commentCount
}

export async function recomputeLookPostSaveCount(
  db: LooksCounterDb,
  lookPostId: string,
): Promise<number> {
  const saveCount = await countLookSaves(db, lookPostId)

  await persistLookPostCounters(db, lookPostId, {
    saveCount,
  })

  return saveCount
}

export async function recomputeLookPostCounters(
  db: LooksCounterDb,
  lookPostId: string,
): Promise<LookPostCounterSnapshot> {
  const [likeCount, commentCount, saveCount] = await Promise.all([
    countLookLikes(db, lookPostId),
    countApprovedLookComments(db, lookPostId),
    countLookSaves(db, lookPostId),
  ])

  await persistLookPostCounters(db, lookPostId, {
    likeCount,
    commentCount,
    saveCount,
  })

  return {
    likeCount,
    commentCount,
    saveCount,
  }
}