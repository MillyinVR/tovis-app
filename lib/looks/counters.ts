// lib/looks/counters.ts
import { PrismaClient, type Prisma } from '@prisma/client'

type LooksCounterDb = Prisma.TransactionClient | PrismaClient

async function persistLookPostCounter(
  db: LooksCounterDb,
  lookPostId: string,
  data: Prisma.LookPostUpdateInput,
): Promise<void> {
  await db.lookPost.update({
    where: { id: lookPostId },
    data,
    select: { id: true },
  })
}

export async function recomputeLookPostLikeCount(
  db: LooksCounterDb,
  lookPostId: string,
): Promise<number> {
  const likeCount = await db.lookLike.count({
    where: { lookPostId },
  })

  await persistLookPostCounter(db, lookPostId, {
    likeCount,
  })

  return likeCount
}

export async function recomputeLookPostCommentCount(
  db: LooksCounterDb,
  lookPostId: string,
): Promise<number> {
  const commentCount = await db.lookComment.count({
    where: { lookPostId },
  })

  await persistLookPostCounter(db, lookPostId, {
    commentCount,
  })

  return commentCount
}

export async function recomputeLookPostSaveCount(
  db: LooksCounterDb,
  lookPostId: string,
): Promise<number> {
  const saveCount = await db.boardItem.count({
    where: { lookPostId },
  })

  await persistLookPostCounter(db, lookPostId, {
    saveCount,
  })

  return saveCount
}

export async function recomputeLookPostCounters(
  db: LooksCounterDb,
  lookPostId: string,
): Promise<{
  likeCount: number
  commentCount: number
  saveCount: number
}> {
  const [likeCount, commentCount, saveCount] = await Promise.all([
    db.lookLike.count({ where: { lookPostId } }),
    db.lookComment.count({ where: { lookPostId } }),
    db.boardItem.count({ where: { lookPostId } }),
  ])

  await persistLookPostCounter(db, lookPostId, {
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