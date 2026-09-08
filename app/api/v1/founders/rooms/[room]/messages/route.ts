import { FounderMessageKind } from '@prisma/client'

import {
  enforceRateLimit,
  jsonFail,
  jsonOk,
  pickString,
  rateLimitIdentity,
} from '@/app/api/_utils'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import type {
  FounderMessageCreateResponseDTO,
  FounderMessagesResponseDTO,
} from '@/lib/dto/founders'
import {
  canAccessFounderRoom,
  resolveFounderPortalAccess,
} from '@/lib/founders/access'
import {
  FOUNDER_MESSAGE_PAGE_SIZE,
  FOUNDER_MESSAGE_SELECT,
  founderMessageDTO,
} from '@/lib/founders/portal'
import { founderRoomDefinition, isFounderRoomKey } from '@/lib/founders/rooms'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

function isMessageKind(value: unknown): value is FounderMessageKind {
  return (
    typeof value === 'string' &&
    Object.values(FounderMessageKind).some((kind) => kind === value)
  )
}

export async function GET(req: Request, ctx: RouteContext<{ room: string }>) {
  try {
    const auth = await requireUser()
    if (!auth.ok) return auth.res

    const { room: rawRoom } = await resolveRouteParams(ctx)
    if (!isFounderRoomKey(rawRoom)) return jsonFail(404, 'Room not found.')

    const access = await resolveFounderPortalAccess(auth.user)
    if (!canAccessFounderRoom(access, rawRoom)) return jsonFail(403, 'Forbidden.')

    const identity = await rateLimitIdentity(auth.user.id)
    const limited = await enforceRateLimit({
      bucket: 'messages:read',
      identity,
      keySuffix: `founders:${rawRoom}`,
    })
    if (limited) return limited

    const requestedCursor = new URL(req.url).searchParams.get('cursor')?.trim() ?? ''
    const cursor = requestedCursor
      ? await prisma.founderMessage.findFirst({
          where: { id: requestedCursor, room: rawRoom },
          select: { id: true },
        })
      : null

    const page = await prisma.founderMessage.findMany({
      where: {
        room: rawRoom,
        ...(access.canModerate ? {} : { hiddenAt: null }),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: FOUNDER_MESSAGE_PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor.id } } : {}),
      select: FOUNDER_MESSAGE_SELECT,
    })

    const nextCursor =
      page.length === FOUNDER_MESSAGE_PAGE_SIZE
        ? (page.at(-1)?.id ?? null)
        : null
    const definition = founderRoomDefinition(rawRoom)

    return jsonOk({
      room: { ...definition, unreadCount: 0 },
      messages: page.slice().reverse().map(founderMessageDTO),
      nextCursor,
      hasMore: nextCursor !== null,
    } satisfies FounderMessagesResponseDTO)
  } catch (error: unknown) {
    console.error('GET /api/v1/founders/rooms/[room]/messages', error)
    return jsonFail(500, 'Could not load messages.')
  }
}

export async function POST(req: Request, ctx: RouteContext<{ room: string }>) {
  try {
    const auth = await requireUser()
    if (!auth.ok) return auth.res

    const { room: rawRoom } = await resolveRouteParams(ctx)
    if (!isFounderRoomKey(rawRoom)) return jsonFail(404, 'Room not found.')

    const access = await resolveFounderPortalAccess(auth.user)
    if (!canAccessFounderRoom(access, rawRoom)) return jsonFail(403, 'Forbidden.')

    const identity = await rateLimitIdentity(auth.user.id)
    const limited = await enforceRateLimit({
      bucket: 'messages:send',
      identity,
      keySuffix: `founders:${rawRoom}`,
    })
    if (limited) return limited

    const input = await readJsonRecord(req)
    const body = (pickString(input.body) ?? '').trim()
    const kind = input.kind ?? FounderMessageKind.CHAT
    const replyToId = pickString(input.replyToId)?.trim() || null

    if (!body) return jsonFail(400, 'Message cannot be empty.')
    if (body.length > 4000) return jsonFail(400, 'Message is too long.')
    if (!isMessageKind(kind)) return jsonFail(400, 'Invalid message type.')
    if (kind === FounderMessageKind.ANNOUNCEMENT && !access.canAdminister) {
      return jsonFail(403, 'Only portal administrators can post announcements.')
    }

    const parent = replyToId
      ? await prisma.founderMessage.findFirst({
          where: { id: replyToId, room: rawRoom, hiddenAt: null },
          select: { id: true, kind: true },
        })
      : null
    if (replyToId && !parent) return jsonFail(400, 'Reply target is unavailable.')

    const message = await prisma.$transaction(async (tx) => {
      const created = await tx.founderMessage.create({
        data: {
          room: rawRoom,
          kind,
          body,
          senderUserId: auth.user.id,
          replyToId,
        },
        select: FOUNDER_MESSAGE_SELECT,
      })
      if (parent?.kind === FounderMessageKind.QUESTION && access.canModerate) {
        await tx.founderMessage.update({
          where: { id: parent.id },
          data: {
            answeredAt: new Date(),
            answeredByUserId: auth.user.id,
          },
        })
      }
      return created
    })

    return jsonOk(
      { message: founderMessageDTO(message) } satisfies FounderMessageCreateResponseDTO,
      201,
    )
  } catch (error: unknown) {
    console.error('POST /api/v1/founders/rooms/[room]/messages', error)
    return jsonFail(500, 'Could not send the message.')
  }
}
