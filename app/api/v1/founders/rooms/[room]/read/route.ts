import { jsonFail, jsonOk } from '@/app/api/_utils'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import {
  canAccessFounderRoom,
  resolveFounderPortalAccess,
} from '@/lib/founders/access'
import { isFounderRoomKey } from '@/lib/founders/rooms'
import { prisma } from '@/lib/prisma'

export async function POST(
  _req: Request,
  ctx: RouteContext<{ room: string }>,
) {
  try {
    const auth = await requireUser()
    if (!auth.ok) return auth.res

    const { room: rawRoom } = await resolveRouteParams(ctx)
    if (!isFounderRoomKey(rawRoom)) return jsonFail(404, 'Room not found.')
    const access = await resolveFounderPortalAccess(auth.user)
    if (!canAccessFounderRoom(access, rawRoom)) return jsonFail(403, 'Forbidden.')

    const readAt = new Date()
    await prisma.founderRoomRead.upsert({
      where: { userId_room: { userId: auth.user.id, room: rawRoom } },
      create: { userId: auth.user.id, room: rawRoom, lastReadAt: readAt },
      update: { lastReadAt: readAt },
    })
    return jsonOk({ readAt: readAt.toISOString() })
  } catch (error: unknown) {
    console.error('POST /api/v1/founders/rooms/[room]/read', error)
    return jsonFail(500, 'Could not mark the room as read.')
  }
}
