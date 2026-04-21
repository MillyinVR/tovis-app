import { ModerationStatus, Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import type { LooksReportStatusDto } from '@/lib/looks/types'

type DbClient = Prisma.TransactionClient | typeof prisma

export type LooksReportMutationResult = {
  status: LooksReportStatusDto
}

const reportableLookCommentSelect = Prisma.validator<Prisma.LookCommentSelect>()({
  id: true,
  lookPostId: true,
  moderationStatus: true,
})

export type ReportableLookCommentRow = Prisma.LookCommentGetPayload<{
  select: typeof reportableLookCommentSelect
}>

function normalizeRequiredId(fieldName: string, value: unknown): string {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized) {
    throw new Error(`looks reporting: missing ${fieldName}`)
  }
  return normalized
}

function isUniqueConstraintError(
  error: unknown,
): error is Prisma.PrismaClientKnownRequestError {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  )
}

async function createReport(
  runCreate: () => Promise<unknown>,
): Promise<LooksReportMutationResult> {
  try {
    await runCreate()
    return { status: 'accepted' }
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return { status: 'already_reported' }
    }
    throw error
  }
}

export async function createLookPostReport(
  db: DbClient,
  args: {
    lookPostId: string
    userId: string
  },
): Promise<LooksReportMutationResult> {
  const lookPostId = normalizeRequiredId('lookPostId', args.lookPostId)
  const userId = normalizeRequiredId('userId', args.userId)

  return createReport(() =>
    db.lookPostReport.create({
      data: {
        lookPostId,
        userId,
      },
      select: { id: true },
    }),
  )
}

export async function findReportableLookComment(
  db: DbClient,
  args: {
    lookPostId: string
    commentId: string
  },
): Promise<ReportableLookCommentRow | null> {
  const lookPostId = normalizeRequiredId('lookPostId', args.lookPostId)
  const commentId = normalizeRequiredId('commentId', args.commentId)

  return db.lookComment.findFirst({
    where: {
      id: commentId,
      lookPostId,
      moderationStatus: ModerationStatus.APPROVED,
    },
    select: reportableLookCommentSelect,
  })
}

export async function createLookCommentReport(
  db: DbClient,
  args: {
    lookCommentId: string
    userId: string
  },
): Promise<LooksReportMutationResult> {
  const lookCommentId = normalizeRequiredId('lookCommentId', args.lookCommentId)
  const userId = normalizeRequiredId('userId', args.userId)

  return createReport(() =>
    db.lookCommentReport.create({
      data: {
        lookCommentId,
        userId,
      },
      select: { id: true },
    }),
  )
}