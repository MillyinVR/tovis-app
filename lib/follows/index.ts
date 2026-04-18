// lib/follows/index.ts
import { Prisma, PrismaClient } from '@prisma/client'

type FollowsDb = PrismaClient | Prisma.TransactionClient

export const followProfessionalPreviewSelect =
  Prisma.validator<Prisma.ProfessionalProfileSelect>()({
    id: true,
    businessName: true,
    handle: true,
    avatarUrl: true,
    professionType: true,
    location: true,
    verificationStatus: true,
    isPremium: true,
  })

export type FollowProfessionalPreviewRow =
  Prisma.ProfessionalProfileGetPayload<{
    select: typeof followProfessionalPreviewSelect
  }>

export type FollowingListItem = {
  followedAt: string
  professional: FollowProfessionalPreviewRow
}

function normalizeRequiredId(name: string, value: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error(`${name} is required.`)
  }
  return trimmed
}

function normalizeOptionalId(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeTake(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 24
  const truncated = Math.trunc(value)
  return Math.min(Math.max(truncated, 1), 100)
}

function normalizeSkip(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.max(Math.trunc(value), 0)
}

function canUseRootTransaction(db: FollowsDb): db is PrismaClient {
  return '$transaction' in db
}

async function withFollowsTx<T>(
  db: FollowsDb,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  if (canUseRootTransaction(db)) {
    return db.$transaction(fn)
  }
  return fn(db)
}

export function canViewFollowingList(args: {
  viewerClientId: string | null | undefined
  ownerClientId: string
}): boolean {
  const viewerClientId = normalizeOptionalId(args.viewerClientId)
  const ownerClientId = normalizeRequiredId('ownerClientId', args.ownerClientId)
  return viewerClientId === ownerClientId
}

export function assertCanViewFollowingList(args: {
  viewerClientId: string | null | undefined
  ownerClientId: string
}): void {
  if (!canViewFollowingList(args)) {
    throw new Error('Not allowed to view this following list.')
  }
}

export async function toggleProFollow(
  db: FollowsDb,
  args: {
    clientId: string
    professionalId: string
  },
): Promise<{
  following: boolean
  followerCount: number
}> {
  const clientId = normalizeRequiredId('clientId', args.clientId)
  const professionalId = normalizeRequiredId(
    'professionalId',
    args.professionalId,
  )

  return withFollowsTx(db, async (tx) => {
    const existing = await tx.proFollow.findUnique({
      where: {
        clientId_professionalId: {
          clientId,
          professionalId,
        },
      },
      select: { id: true },
    })

    if (existing) {
      await tx.proFollow.delete({
        where: {
          clientId_professionalId: {
            clientId,
            professionalId,
          },
        },
      })

      const followerCount = await tx.proFollow.count({
        where: { professionalId },
      })

      return {
        following: false,
        followerCount,
      }
    }

    await tx.proFollow.create({
      data: {
        clientId,
        professionalId,
      },
      select: { id: true },
    })

    const followerCount = await tx.proFollow.count({
      where: { professionalId },
    })

    return {
      following: true,
      followerCount,
    }
  })
}

export async function countFollowers(
  db: FollowsDb,
  professionalId: string,
): Promise<number> {
  const normalizedProfessionalId = normalizeRequiredId(
    'professionalId',
    professionalId,
  )

  return db.proFollow.count({
    where: {
      professionalId: normalizedProfessionalId,
    },
  })
}

export async function getViewerFollowState(
  db: FollowsDb,
  args: {
    viewerClientId: string | null | undefined
    professionalId: string
  },
): Promise<boolean> {
  const viewerClientId = normalizeOptionalId(args.viewerClientId)
  const professionalId = normalizeRequiredId(
    'professionalId',
    args.professionalId,
  )

  if (!viewerClientId) return false

  const existing = await db.proFollow.findUnique({
    where: {
      clientId_professionalId: {
        clientId: viewerClientId,
        professionalId,
      },
    },
    select: { id: true },
  })

  return Boolean(existing)
}

export async function listFollowing(
  db: FollowsDb,
  args: {
    clientId: string
    viewerClientId?: string | null
    take?: number
    skip?: number
  },
): Promise<FollowingListItem[]> {
  const clientId = normalizeRequiredId('clientId', args.clientId)

  if (args.viewerClientId !== undefined) {
    assertCanViewFollowingList({
      viewerClientId: args.viewerClientId,
      ownerClientId: clientId,
    })
  }

  const rows = await db.proFollow.findMany({
    where: {
      clientId,
    },
    orderBy: {
      createdAt: 'desc',
    },
    take: normalizeTake(args.take),
    skip: normalizeSkip(args.skip),
    select: {
      createdAt: true,
      professional: {
        select: followProfessionalPreviewSelect,
      },
    },
  })

  return rows.map((row) => ({
    followedAt: row.createdAt.toISOString(),
    professional: row.professional,
  }))
}