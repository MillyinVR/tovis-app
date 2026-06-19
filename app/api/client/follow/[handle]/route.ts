// app/api/client/follow/[handle]/route.ts
//
// Client→client follow toggle, addressed by the target's public handle (same
// addressing as the `/u/[handle]` profile page). POST toggles; GET reports the
// viewer's current state. Only logged-in clients may follow.
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickString, requireClient } from '@/app/api/_utils'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import {
  buildClientFollowStateResponse,
  getClientFollowErrorMeta,
  getClientFollowState,
  requireFollowableClientByHandle,
  toggleClientFollow,
} from '@/lib/follows'
import { createClientFollowNotification } from '@/lib/notifications/clientFollowNew'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, ctx: RouteContext<{ handle: string }>) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const { handle: rawHandle } = await resolveRouteParams(ctx)
    const handle = pickString(rawHandle)

    if (!handle) {
      return jsonFail(400, 'Missing handle.', { code: 'MISSING_HANDLE' })
    }

    const target = await requireFollowableClientByHandle(prisma, handle)

    const state = await getClientFollowState(prisma, {
      viewerClientId: auth.clientId,
      followedClientId: target.id,
    })

    return jsonOk(
      buildClientFollowStateResponse({
        handle: target.handle ?? handle,
        following: state.following,
        followerCount: state.followerCount,
      }),
      200,
    )
  } catch (error) {
    const followError = getClientFollowErrorMeta(error)
    if (followError) {
      return jsonFail(followError.status, followError.message, {
        code: followError.code,
      })
    }

    console.error('GET /api/client/follow/[handle] error', error)
    return jsonFail(500, 'Couldn’t load follow state. Try again.', {
      code: 'INTERNAL',
    })
  }
}

export async function POST(_req: Request, ctx: RouteContext<{ handle: string }>) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const { handle: rawHandle } = await resolveRouteParams(ctx)
    const handle = pickString(rawHandle)

    if (!handle) {
      return jsonFail(400, 'Missing handle.', { code: 'MISSING_HANDLE' })
    }

    const target = await requireFollowableClientByHandle(prisma, handle)

    if (auth.clientId === target.id) {
      return jsonFail(403, 'You can’t follow yourself.', {
        code: 'SELF_FOLLOW_FORBIDDEN',
      })
    }

    const state = await toggleClientFollow(prisma, {
      followerClientId: auth.clientId,
      followedClientId: target.id,
    })

    if (state.following) {
      // Best-effort: the follow already committed; a notification failure must
      // never fail the request or roll the follow back. Powers the followed
      // client's activity feed ("started following you").
      await createClientFollowNotification({
        followedClientId: target.id,
        followerClientId: auth.clientId,
      }).catch((error) => {
        console.error(
          'POST /api/client/follow/[handle] notify error',
          error,
        )
      })
    }

    return jsonOk(
      buildClientFollowStateResponse({
        handle: target.handle ?? handle,
        following: state.following,
        followerCount: state.followerCount,
      }),
      200,
    )
  } catch (error) {
    const followError = getClientFollowErrorMeta(error)
    if (followError) {
      return jsonFail(followError.status, followError.message, {
        code: followError.code,
      })
    }

    console.error('POST /api/client/follow/[handle] error', error)
    return jsonFail(500, 'Couldn’t update follow state. Try again.', {
      code: 'INTERNAL',
    })
  }
}
