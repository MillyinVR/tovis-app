// app/api/messages/threads/[id]/route.ts
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { jsonFail, jsonOk, pickString, enforceRateLimit, rateLimitIdentity } from '@/app/api/_utils'
import type { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'

type JsonRecord = Record<string, unknown>

function isRecord(v: unknown): v is JsonRecord {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

async function readJsonObject(req: Request): Promise<JsonRecord> {
  const raw: unknown = await req.json().catch(() => ({}))
  return isRecord(raw) ? raw : {}
}

async function readParams(ctx: { params: { id: string } | Promise<{ id: string }> }) {
  return await Promise.resolve(ctx.params)
}

function trimId(v: unknown) {
  return typeof v === 'string' ? v.trim() : ''
}

function clampInt(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.trunc(n)))
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

export async function GET(req: Request, ctx: { params: { id: string } | Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user) return jsonFail(401, 'Unauthorized.')

    const { id } = await readParams(ctx)
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
        participants: { where: { userId: user.id }, select: { userId: true }, take: 1 },
      },
    })

    if (!thread) return jsonFail(404, 'Thread not found.')
    if (!thread.participants.length) return jsonFail(403, 'Forbidden.')

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

    return jsonOk({ thread: { id: threadId }, messages, nextCursor, hasMore, take })
  } catch (e: unknown) {
    console.error('GET /api/messages/threads/[id]', e)
    const msg = e instanceof Error ? e.message : 'Internal error'
    return jsonFail(500, msg)
  }
}

export async function POST(req: Request, ctx: { params: { id: string } | Promise<{ id: string }> }) {
  const debugId = Math.random().toString(36).slice(2, 9)

  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user) return jsonFail(401, 'Unauthorized.')
    const userId = user.id

    const { id } = await readParams(ctx)
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

    const body = await readJsonObject(req)
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
      console.warn('[messages/thread send] blocked', { debugId, status: result.status, error: result.error })
      return jsonFail(result.status, result.error)
    }

    console.log('[messages/thread send] ok', { debugId, threadId, msgId: result.msg.id })
    return jsonOk({ message: result.msg })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Internal error'
    console.error('POST /api/messages/threads/[id]', { debugId, err: msg })
    return jsonFail(500, msg)
  }
}