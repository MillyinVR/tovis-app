// lib/follows/clientFollows.ts
//
// Client→client follow graph (the engagement-loop FOLLOWERS count). Distinct
// from the client→pro graph in ./index.ts (ProFollow): this is one public
// client following another via their public `/u/[handle]` profile.
import { Prisma, PrismaClient } from '@prisma/client'

import { asTrimmedString, normalizeRequiredId } from '@/lib/guards'
import { normalizeHandle } from '@/lib/handles'

type FollowsDb = PrismaClient | Prisma.TransactionClient

export const followableClientTargetSelect =
  Prisma.validator<Prisma.ClientProfileSelect>()({
    id: true,
    handle: true,
    isPublicProfile: true,
  })

export type FollowableClientTargetRow = Prisma.ClientProfileGetPayload<{
  select: typeof followableClientTargetSelect
}>

export type ClientFollowState = {
  following: boolean
  followerCount: number
}

export type ClientFollowStateResponseDto = {
  handle: string
  following: boolean
  followerCount: number
}

export type ClientFollowErrorMeta = {
  status: 403 | 404
  message: string
  code: 'CLIENT_PROFILE_NOT_FOUND' | 'SELF_FOLLOW_FORBIDDEN'
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

export function getClientFollowErrorMeta(
  error: unknown,
): ClientFollowErrorMeta | null {
  const message = error instanceof Error ? error.message : ''

  switch (message) {
    case 'Public profile not found.':
      return {
        status: 404,
        message,
        code: 'CLIENT_PROFILE_NOT_FOUND',
      }
    case 'You can’t follow yourself.':
      return {
        status: 403,
        message,
        code: 'SELF_FOLLOW_FORBIDDEN',
      }
    default:
      return null
  }
}

/**
 * Resolves a followable client by handle. A client is only followable once
 * they've opted into a public profile and claimed a handle — a private or
 * non-existent handle throws the SAME "not found" error so the two cases stay
 * indistinguishable (no enumeration of private accounts).
 */
export async function requireFollowableClientByHandle(
  db: FollowsDb,
  handle: string,
): Promise<FollowableClientTargetRow> {
  const normalized = normalizeHandle(handle)
  if (!normalized) {
    throw new Error('Public profile not found.')
  }

  const client = await db.clientProfile.findUnique({
    where: { handleNormalized: normalized },
    select: followableClientTargetSelect,
  })

  if (!client || !client.isPublicProfile || !client.handle) {
    throw new Error('Public profile not found.')
  }

  return client
}

export async function countClientFollowers(
  db: FollowsDb,
  followedClientId: string,
): Promise<number> {
  const id = normalizeRequiredId('followedClientId', followedClientId)
  return db.clientFollow.count({ where: { followedClientId: id } })
}

export async function getViewerClientFollowState(
  db: FollowsDb,
  args: {
    viewerClientId: string | null | undefined
    followedClientId: string
  },
): Promise<boolean> {
  const viewerClientId = asTrimmedString(args.viewerClientId)
  const followedClientId = normalizeRequiredId(
    'followedClientId',
    args.followedClientId,
  )

  // A guest, or the owner viewing their own profile, never "follows".
  if (!viewerClientId || viewerClientId === followedClientId) return false

  const existing = await db.clientFollow.findUnique({
    where: {
      followerClientId_followedClientId: {
        followerClientId: viewerClientId,
        followedClientId,
      },
    },
    select: { id: true },
  })

  return Boolean(existing)
}

export async function getClientFollowState(
  db: FollowsDb,
  args: {
    viewerClientId: string | null | undefined
    followedClientId: string
  },
): Promise<ClientFollowState> {
  const followedClientId = normalizeRequiredId(
    'followedClientId',
    args.followedClientId,
  )

  const [following, followerCount] = await Promise.all([
    getViewerClientFollowState(db, {
      viewerClientId: args.viewerClientId,
      followedClientId,
    }),
    countClientFollowers(db, followedClientId),
  ])

  return { following, followerCount }
}

export async function toggleClientFollow(
  db: FollowsDb,
  args: {
    followerClientId: string
    followedClientId: string
  },
): Promise<ClientFollowState> {
  const followerClientId = normalizeRequiredId(
    'followerClientId',
    args.followerClientId,
  )
  const followedClientId = normalizeRequiredId(
    'followedClientId',
    args.followedClientId,
  )

  if (followerClientId === followedClientId) {
    throw new Error('You can’t follow yourself.')
  }

  return withFollowsTx(db, async (tx) => {
    const existing = await tx.clientFollow.findUnique({
      where: {
        followerClientId_followedClientId: {
          followerClientId,
          followedClientId,
        },
      },
      select: { id: true },
    })

    if (existing) {
      await tx.clientFollow.delete({
        where: {
          followerClientId_followedClientId: {
            followerClientId,
            followedClientId,
          },
        },
      })

      const followerCount = await tx.clientFollow.count({
        where: { followedClientId },
      })

      return { following: false, followerCount }
    }

    await tx.clientFollow.create({
      data: { followerClientId, followedClientId },
      select: { id: true },
    })

    const followerCount = await tx.clientFollow.count({
      where: { followedClientId },
    })

    return { following: true, followerCount }
  })
}

export function buildClientFollowStateResponse(args: {
  handle: string
  following: boolean
  followerCount: number
}): ClientFollowStateResponseDto {
  return {
    handle: args.handle,
    following: args.following,
    followerCount: Math.max(Math.trunc(args.followerCount), 0),
  }
}
