// lib/follows/index.ts
import { Prisma, PrismaClient } from '@prisma/client'
import { mapLooksProProfilePreviewToDto } from '@/lib/looks/profilePreview'
import {
  looksProProfilePreviewSelect,
  type LooksProProfilePreviewRow,
} from '@/lib/looks/selects'
import type { LooksProProfilePreviewDto } from '@/lib/looks/types'

type FollowsDb = PrismaClient | Prisma.TransactionClient

export const followProfessionalPreviewSelect = looksProProfilePreviewSelect

export type FollowProfessionalPreviewRow = LooksProProfilePreviewRow

export const followClientPreviewSelect =
  Prisma.validator<Prisma.ClientProfileSelect>()({
    id: true,
    firstName: true,
    lastName: true,
    avatarUrl: true,
  })

export type FollowClientPreviewRow = Prisma.ClientProfileGetPayload<{
  select: typeof followClientPreviewSelect
}>

export const followProfessionalTargetSelect =
  Prisma.validator<Prisma.ProfessionalProfileSelect>()({
    id: true,
    userId: true,
  })

export type FollowProfessionalTargetRow =
  Prisma.ProfessionalProfileGetPayload<{
    select: typeof followProfessionalTargetSelect
  }>

export type FollowingListItem = {
  followedAt: string
  professional: FollowProfessionalPreviewRow
}

export type FollowerListItem = {
  followedAt: string
  client: FollowClientPreviewRow
}

export type FollowPagination = {
  take: number
  skip: number
  hasMore: boolean
}

export type FollowingListPage = {
  items: FollowingListItem[]
  pagination: FollowPagination
}

export type FollowersListPage = {
  followerCount: number
  items: FollowerListItem[]
  pagination: FollowPagination
}

export type ProfessionalFollowState = {
  following: boolean
  followerCount: number
}

export type ProFollowStateResponseDto = {
  professionalId: string
  following: boolean
  followerCount: number
}

export type FollowClientPreviewDto = {
  id: string
  firstName: string
  lastName: string
  avatarUrl: string | null
}

export type FollowerListItemDto = {
  followedAt: string
  client: FollowClientPreviewDto
}

export type FollowersListResponseDto = {
  professionalId: string
  followerCount: number
  items: FollowerListItemDto[]
  pagination: FollowPagination
}

export type FollowingListItemDto = {
  followedAt: string
  professional: LooksProProfilePreviewDto
}

export type MyFollowingListResponseDto = {
  clientId: string
  items: FollowingListItemDto[]
  pagination: FollowPagination
}

export type FollowErrorMeta = {
  status: 403 | 404
  message: string
  code: 'PRO_NOT_FOUND' | 'FOLLOWERS_FORBIDDEN' | 'FOLLOWING_FORBIDDEN'
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

function mapFollowClientPreviewToDto(
  client: FollowClientPreviewRow,
): FollowClientPreviewDto {
  return {
    id: client.id,
    firstName: client.firstName,
    lastName: client.lastName,
    avatarUrl: client.avatarUrl ?? null,
  }
}

function buildPagination(args: {
  take: number
  skip: number
  returnedCount: number
}): FollowPagination {
  return {
    take: args.take,
    skip: args.skip,
    hasMore: args.returnedCount > args.take,
  }
}

export function getFollowErrorMeta(error: unknown): FollowErrorMeta | null {
  const message = error instanceof Error ? error.message : ''

  switch (message) {
    case 'Professional not found.':
      return {
        status: 404,
        message,
        code: 'PRO_NOT_FOUND',
      }
    case 'Not allowed to view this followers list.':
      return {
        status: 403,
        message,
        code: 'FOLLOWERS_FORBIDDEN',
      }
    case 'Not allowed to view this following list.':
      return {
        status: 403,
        message,
        code: 'FOLLOWING_FORBIDDEN',
      }
    default:
      return null
  }
}

export function canViewFollowersList(args: {
  viewerProfessionalId: string | null | undefined
  ownerProfessionalId: string
}): boolean {
  const viewerProfessionalId = normalizeOptionalId(args.viewerProfessionalId)
  const ownerProfessionalId = normalizeRequiredId(
    'ownerProfessionalId',
    args.ownerProfessionalId,
  )

  return viewerProfessionalId === ownerProfessionalId
}

export function assertCanViewFollowersList(args: {
  viewerProfessionalId: string | null | undefined
  ownerProfessionalId: string
}): void {
  if (!canViewFollowersList(args)) {
    throw new Error('Not allowed to view this followers list.')
  }
}

export async function requireFollowProfessionalTarget(
  db: FollowsDb,
  professionalId: string,
): Promise<FollowProfessionalTargetRow> {
  const normalizedProfessionalId = normalizeRequiredId(
    'professionalId',
    professionalId,
  )

  const professional = await db.professionalProfile.findUnique({
    where: { id: normalizedProfessionalId },
    select: followProfessionalTargetSelect,
  })

  if (!professional) {
    throw new Error('Professional not found.')
  }

  return professional
}

export async function getProfessionalFollowState(
  db: FollowsDb,
  args: {
    viewerClientId: string | null | undefined
    professionalId: string
  },
): Promise<ProfessionalFollowState> {
  const professionalId = normalizeRequiredId(
    'professionalId',
    args.professionalId,
  )

  const [following, followerCount] = await Promise.all([
    getViewerFollowState(db, {
      viewerClientId: args.viewerClientId,
      professionalId,
    }),
    countFollowers(db, professionalId),
  ])

  return {
    following,
    followerCount,
  }
}

export function buildProFollowStateResponse(args: {
  professionalId: string
  following: boolean
  followerCount: number
}): ProFollowStateResponseDto {
  return {
    professionalId: normalizeRequiredId('professionalId', args.professionalId),
    following: args.following,
    followerCount: Math.max(Math.trunc(args.followerCount), 0),
  }
}

export function buildProFollowersListResponse(args: {
  professionalId: string
  followerCount: number
  items: FollowerListItem[]
  pagination: FollowPagination
}): FollowersListResponseDto {
  return {
    professionalId: normalizeRequiredId('professionalId', args.professionalId),
    followerCount: Math.max(Math.trunc(args.followerCount), 0),
    items: args.items.map((item) => ({
      followedAt: item.followedAt,
      client: mapFollowClientPreviewToDto(item.client),
    })),
    pagination: {
      take: args.pagination.take,
      skip: args.pagination.skip,
      hasMore: args.pagination.hasMore,
    },
  }
}

export function buildMyFollowingListResponse(args: {
  clientId: string
  items: FollowingListItem[]
  pagination: FollowPagination
}): MyFollowingListResponseDto {
  return {
    clientId: normalizeRequiredId('clientId', args.clientId),
    items: args.items.map((item) => ({
      followedAt: item.followedAt,
      professional: mapLooksProProfilePreviewToDto(item.professional),
    })),
    pagination: {
      take: args.pagination.take,
      skip: args.pagination.skip,
      hasMore: args.pagination.hasMore,
    },
  }
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

export async function listFollowersPage(
  db: FollowsDb,
  args: {
    professionalId: string
    viewerProfessionalId?: string | null
    take?: number
    skip?: number
  },
): Promise<FollowersListPage> {
  const professionalId = normalizeRequiredId(
    'professionalId',
    args.professionalId,
  )
  const take = normalizeTake(args.take)
  const skip = normalizeSkip(args.skip)

  if (args.viewerProfessionalId !== undefined) {
    assertCanViewFollowersList({
      viewerProfessionalId: args.viewerProfessionalId,
      ownerProfessionalId: professionalId,
    })
  }

  const [rows, followerCount] = await Promise.all([
    db.proFollow.findMany({
      where: {
        professionalId,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      skip,
      select: {
        createdAt: true,
        client: {
          select: followClientPreviewSelect,
        },
      },
    }),
    countFollowers(db, professionalId),
  ])

  return {
    followerCount,
    items: rows.slice(0, take).map((row) => ({
      followedAt: row.createdAt.toISOString(),
      client: row.client,
    })),
    pagination: buildPagination({
      take,
      skip,
      returnedCount: rows.length,
    }),
  }
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
  const page = await listFollowingPage(db, args)
  return page.items
}

export async function listFollowingPage(
  db: FollowsDb,
  args: {
    clientId: string
    viewerClientId?: string | null
    take?: number
    skip?: number
  },
): Promise<FollowingListPage> {
  const clientId = normalizeRequiredId('clientId', args.clientId)
  const take = normalizeTake(args.take)
  const skip = normalizeSkip(args.skip)

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
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: take + 1,
    skip,
    select: {
      createdAt: true,
      professional: {
        select: followProfessionalPreviewSelect,
      },
    },
  })

  return {
    items: rows.slice(0, take).map((row) => ({
      followedAt: row.createdAt.toISOString(),
      professional: row.professional,
    })),
    pagination: buildPagination({
      take,
      skip,
      returnedCount: rows.length,
    }),
  }
}