// app/api/v1/messages/threads/[id]/route.ts
import { clampInt } from '@/lib/pick'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { jsonFail, jsonOk, pickString, enforceRateLimit, rateLimitIdentity } from '@/app/api/_utils'
import { broadcastLive, liveChannelForUser } from '@/lib/live/broadcast'
import { kickNotificationDrain } from '@/lib/notifications/delivery/kickNotificationDrain'
import { notifyNewMessageRecipients } from '@/lib/messages/notifyNewMessage'
import { THREAD_MESSAGE_PAGE_SIZE, nextOlderCursor } from '@/lib/messages/paging'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import type { MediaType, Prisma } from '@prisma/client'
import {
  MAX_MESSAGE_ATTACHMENTS,
  MESSAGE_ATTACHMENT_BUCKET,
  isMessageAttachmentPathForThread,
  signMessageAttachmentUrls,
} from '@/lib/messages/attachments'
import type {
  CreateMessageResponseDTO,
  MessageAttachmentDTO,
  MessageThreadMessagesResponseDTO,
} from '@/lib/dto/messaging'

export const dynamic = 'force-dynamic'

function trimId(v: unknown) {
  return typeof v === 'string' ? v.trim() : ''
}

/** Inbox preview label for a message that carries only an image, no text. */
const ATTACHMENT_ONLY_PREVIEW = '📷 Photo'

type AttachmentRow = {
  id: string
  url: string | null
  mediaType: MediaType
  storageBucket: string | null
  storagePath: string | null
}

const ATTACHMENT_SELECT = {
  id: true,
  url: true,
  mediaType: true,
  storageBucket: true,
  storagePath: true,
} as const

/**
 * Sign every media-private attachment pointer in ONE batch and return a
 * per-attachment DTO map. A private attachment with no signable URL is omitted
 * (dropped rather than shipped broken). Callers group the DTOs by message.
 */
async function signAttachmentsForRead(
  rows: AttachmentRow[],
): Promise<Map<string, MessageAttachmentDTO>> {
  const paths = rows
    .filter((r) => r.storageBucket === MESSAGE_ATTACHMENT_BUCKET && r.storagePath)
    .map((r) => r.storagePath as string)

  const signed = paths.length
    ? await signMessageAttachmentUrls(paths)
    : new Map<string, string>()

  const byId = new Map<string, MessageAttachmentDTO>()
  for (const r of rows) {
    const url =
      r.storageBucket === MESSAGE_ATTACHMENT_BUCKET && r.storagePath
        ? (signed.get(r.storagePath) ?? null)
        : r.url
    if (!url) continue
    byId.set(r.id, { id: r.id, url, mediaType: r.mediaType })
  }
  return byId
}

/** Map a message's raw attachment rows to their signed DTOs (order preserved). */
function attachmentsForMessage(
  rows: AttachmentRow[],
  signedById: Map<string, MessageAttachmentDTO>,
): MessageAttachmentDTO[] {
  const out: MessageAttachmentDTO[] = []
  for (const r of rows) {
    const dto = signedById.get(r.id)
    if (dto) out.push(dto)
  }
  return out
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

    const take = clampInt(parseTake(sp, THREAD_MESSAGE_PAGE_SIZE), 1, 100)
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
        attachments: { select: ATTACHMENT_SELECT },
      },
    })

    const messages = pageDesc.slice().reverse()

    // Sign every attachment across the page in a single batch.
    const signedById = await signAttachmentsForRead(
      messages.flatMap((m) => m.attachments),
    )

    // Cursor points to the oldest item in this DESC page (last element), present
    // only when the page filled — a partial page means there's nothing older.
    const nextCursor = nextOlderCursor(
      pageDesc.map((m) => m.id),
      take,
    )
    const hasMore = Boolean(nextCursor)

    return jsonOk({
      thread: { id: threadId, isViewerPro, counterpartyLastReadAt },
      messages: messages.map((m) => ({
        id: m.id,
        body: m.body,
        createdAt: m.createdAt.toISOString(),
        senderUserId: m.senderUserId,
        attachments: attachmentsForMessage(m.attachments, signedById),
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

    if (text.length > 4000) return jsonFail(400, 'Message too long.')

    // Attachments: an array of media-private storage paths the client just
    // uploaded via POST .../uploads. Each must live under this thread's
    // namespace, which bounds it to media the two participants can already see.
    const attachmentPaths: string[] = []
    if (body.attachments != null) {
      if (!Array.isArray(body.attachments)) {
        return jsonFail(400, 'Invalid attachments.')
      }
      if (body.attachments.length > MAX_MESSAGE_ATTACHMENTS) {
        return jsonFail(400, 'Too many attachments.')
      }
      for (const candidate of body.attachments) {
        if (!isMessageAttachmentPathForThread(candidate, threadId)) {
          return jsonFail(400, 'Invalid attachment.')
        }
        attachmentPaths.push(candidate.trim())
      }
    }

    // A message needs text or at least one attachment.
    if (!text && attachmentPaths.length === 0) {
      return jsonFail(400, 'Missing body.')
    }

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
        data: {
          threadId,
          senderUserId: userId,
          body: text || null,
          attachments: attachmentPaths.length
            ? {
                create: attachmentPaths.map((path) => ({
                  storageBucket: MESSAGE_ATTACHMENT_BUCKET,
                  storagePath: path,
                  mediaType: 'IMAGE' as MediaType,
                })),
              }
            : undefined,
        },
        select: {
          id: true,
          body: true,
          createdAt: true,
          senderUserId: true,
          attachments: { select: ATTACHMENT_SELECT },
        },
      })

      // Inbox preview: the text, or a short label for an attachment-only message.
      const preview = text ? text.slice(0, 140) : ATTACHMENT_ONLY_PREVIEW

      await tx.messageThread.update({
        where: { id: threadId },
        data: { lastMessageAt: msg.createdAt, lastMessagePreview: preview },
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

    // Notify the other participant(s) of the new message (in-app + push,
    // debounced per thread). Best-effort — a notification failure must never
    // fail the send, which already committed. Then kick the drain so the push
    // goes out immediately instead of waiting for the cron tick.
    await notifyNewMessageRecipients({
      threadId,
      senderUserId: userId,
      preview: text ? text.slice(0, 140) : ATTACHMENT_ONLY_PREVIEW,
    }).catch((err: unknown) => {
      console.error('notifyNewMessageRecipients', {
        debugId,
        threadId,
        err: err instanceof Error ? err.message : String(err),
      })
    })
    kickNotificationDrain()

    // Sign the freshly-created attachments so the sender can render the image
    // immediately (rather than waiting for the next poll to re-sign it).
    const signedById = await signAttachmentsForRead(result.msg.attachments)

    return jsonOk({
      message: {
        id: result.msg.id,
        body: result.msg.body,
        createdAt: result.msg.createdAt.toISOString(),
        senderUserId: result.msg.senderUserId,
        attachments: attachmentsForMessage(result.msg.attachments, signedById),
      },
    } satisfies CreateMessageResponseDTO)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Internal error'
    console.error('POST /api/v1/messages/threads/[id]', { debugId, err: msg })
    return jsonFail(500, msg)
  }
}