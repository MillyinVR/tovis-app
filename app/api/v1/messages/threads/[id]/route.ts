// app/api/v1/messages/threads/[id]/route.ts
import { clampInt } from '@/lib/pick'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { jsonFail, jsonOk, pickString, enforceRateLimit, rateLimitIdentity } from '@/app/api/_utils'
import { broadcastLive, liveChannelForUser } from '@/lib/live/broadcast'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import type { Prisma } from '@prisma/client'
import type {
  CreateMessageResponseDTO,
  MessageThreadMessagesResponseDTO,
} from '@/lib/dto/messaging'

export const dynamic = 'force-dynamic'

function trimId(v: unknown) {
  return typeof v === 'string' ? v.trim() : ''
}

function parseTake(sp: URLSearchParams, fallback: number) {
  const raw = sp.get('take')
  if (!raw) return fallback
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) ? n : fallback
}

/**
 * If a cursor is provided, make sure it exists AND belongs to this thread.
 * If not, treat it like "no cursor" (prevents Prisma cursor errors).
 */
async function validateCursorForThread(threadId: string, cursor: string | null) {
  const c = (cursor || '').trim()
  if (!c) return null

  const ok = await prisma.message.findFirst({
    where: { id: c, threadId },
    select: { id: true },
  })

  return ok?.id ?? null
}

export async function GET(req: Request, ctx: RouteContext) {
  try {
    const auth = await requireUser()
    if (!auth.ok) return auth.res
    const user = auth.user

    const { id } = await resolveRouteParams(ctx)
    const threadId = trimId(id)
    if (!threadId) return jsonFail(400, 'Missing id.')

    // ✅ Rate limit reads (per-thread, per-user)
    const identity = await rateLimitIdentity(user.id)
    const limited = await enforceRateLimit({
      bucket: 'messages:read',
      identity,
      keySuffix: threadId,
    })
    if (limited) return limited

    const url = new URL(req.url)
    const sp = url.searchParams

    const take = clampInt(parseTake(sp, 40), 1, 100)
    const cursorRaw = pickString(sp.get('cursor')) ?? null
    const cursor = await validateCursorForThread(threadId, cursorRaw)

    const thread = await prisma.messageThread.findUnique({
      where: { id: threadId },
      select: {
        id: true,
        professional: { select: { userId: true } },
        // Both participant rows (max 2): the viewer's for the membership check,
        // the counterparty's read timestamp for the sender's read receipt.
        participants: { select: { userId: true, lastReadAt: true } },
      },
    })

    if (!thread) return jsonFail(404, 'Thread not found.')
    if (!thread.participants.some((p) => p.userId === user.id)) {
      return jsonFail(403, 'Forbidden.')
    }

    const isViewerPro =
      thread.professional?.userId != null && thread.professional.userId === user.id
    const counterpartyLastReadAt =
      thread.participants.find((p) => p.userId !== user.id)?.lastReadAt?.toISOString() ??
      null

    // newest -> oldest
    const pageDesc = await prisma.message.findMany({
      where: { threadId },
      orderBy: { createdAt: 'desc' },
      take,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      select: {
        id: true,
        body: true,
        createdAt: true,
        senderUserId: true,
        attachments: { select: { id: true, url: true, mediaType: true } },
      },
    })

    const messages = pageDesc.slice().reverse()

    // Cursor points to the oldest item in this DESC page (last element).
    const nextCursor = pageDesc.length === take ? pageDesc[pageDesc.length - 1]?.id ?? null : null
    const hasMore = Boolean(nextCursor)

    return jsonOk({
      thread: { id: threadId, isViewerPro, counterpartyLastReadAt },
      messages: messages.map((m) => ({
        id: m.id,
        body: m.body,
        createdAt: m.createdAt.toISOString(),
        senderUserId: m.senderUserId,
        attachments: m.attachments,
      })),
      nextCursor,
      hasMore,
      take,
    } satisfies MessageThreadMessagesResponseDTO)
  } catch (e: unknown) {
    console.error('GET /api/v1/messages/threads/[id]', e)
    const msg = e instanceof Error ? e.message : 'Internal error'
    return jsonFail(500, msg)
  }
}

export async function POST(req: Request, ctx: RouteContext) {
  const debugId = Math.random().toString(36).slice(2, 9)

  try {
    const auth = await requireUser()
    if (!auth.ok) return auth.res
    const user = auth.user
    const userId = user.id

    const { id } = await resolveRouteParams(ctx)
    const threadId = trimId(id)
    if (!threadId) return jsonFail(400, 'Missing id.')

    // ✅ Rate limit sends BEFORE parsing + DB work
    const identity = await rateLimitIdentity(userId)
    const limited = await enforceRateLimit({
      bucket: 'messages:send',
      identity,
      keySuffix: threadId,
    })
    if (limited) return limited

    const body = await readJsonRecord(req)
    const raw = pickString(body.body)
    const text = (raw ?? '').trim()

    if (!text) return jsonFail(400, 'Missing body.')
    if (text.length > 4000) return jsonFail(400, 'Message too long.')

    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const thread = await tx.messageThread.findUnique({
        where: { id: threadId },
        select: {
          id: true,
          participants: { where: { userId }, select: { userId: true }, take: 1 },
        },
      })

      if (!thread) return { ok: false as const, status: 404, error: 'Thread not found.' }
      if (!thread.participants.length) return { ok: false as const, status: 403, error: 'Forbidden.' }

      const msg = await tx.message.create({
        data: { threadId, senderUserId: userId, body: text },
        select: { id: true, body: true, createdAt: true, senderUserId: true },
      })

      await tx.messageThread.update({
        where: { id: threadId },
        data: { lastMessageAt: msg.createdAt, lastMessagePreview: text.slice(0, 140) },
      })

      await tx.messageThreadParticipant.update({
        where: { threadId_userId: { threadId, userId } },
        data: { lastReadAt: msg.createdAt },
      })

      return { ok: true as const, msg }
    })

    if (!result.ok) {
      return jsonFail(result.status, result.error)
    }

    // Live-sync: ping the OTHER participants' devices so the new message lands
    // without a reload (the sender already has it).
    const recipients = await prisma.messageThreadParticipant.findMany({
      where: { threadId, userId: { not: userId } },
      select: { userId: true },
    })
    await broadcastLive(
      recipients.map((participant) => liveChannelForUser(participant.userId)),
      'messages',
    )

    return jsonOk({
      message: {
        id: result.msg.id,
        body: result.msg.body,
        createdAt: result.msg.createdAt.toISOString(),
        senderUserId: result.msg.senderUserId,
      },
    } satisfies CreateMessageResponseDTO)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Internal error'
    console.error('POST /api/v1/messages/threads/[id]', { debugId, err: msg })
    return jsonFail(500, msg)
  }
}