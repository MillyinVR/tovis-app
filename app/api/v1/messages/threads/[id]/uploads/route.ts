// app/api/v1/messages/threads/[id]/uploads/route.ts
//
// Presign a media-private upload target for a message image attachment. Scoped
// to a thread participant — the returned path lives under messages/<threadId>/,
// which the POST send route requires so an attachment can't be pointed at
// another conversation's or an unrelated private object.
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import {
  jsonFail,
  jsonOk,
  enforceRateLimit,
  rateLimitIdentity,
} from '@/app/api/_utils'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import {
  MESSAGE_ATTACHMENT_BUCKET,
  buildMessageAttachmentPath,
  isSupportedAttachmentContentType,
} from '@/lib/messages/attachments'
import type { MessageUploadInitDTO } from '@/lib/dto/messaging'
import { getStorageEnvironmentMismatch } from '@/lib/media/storageEnvironment'

export const dynamic = 'force-dynamic'

const MAX_ATTACHMENT_BYTES = 30 * 1024 * 1024

function trimOrEmpty(v: unknown) {
  return typeof v === 'string' ? v.trim() : ''
}

export async function POST(req: Request, ctx: RouteContext) {
  try {
    const auth = await requireUser()
    if (!auth.ok) return auth.res

    // Refuse rather than silently PUT bytes into a remote bucket from a local
    // database (see lib/media/storageEnvironment.ts). After the auth gate so an
    // anonymous caller gets its 401 and never sees infra hostnames; fails open,
    // so it returns null in production and CI.
    const storageMismatch = getStorageEnvironmentMismatch()
    if (storageMismatch) return jsonFail(500, storageMismatch)
    const userId = auth.user.id

    const { id } = await resolveRouteParams(ctx)
    const threadId = trimOrEmpty(id)
    if (!threadId) return jsonFail(400, 'Missing id.')

    const identity = await rateLimitIdentity(userId)
    const limited = await enforceRateLimit({
      bucket: 'messages:send',
      identity,
      keySuffix: threadId,
    })
    if (limited) return limited

    // Only a participant may attach to this thread.
    const participant = await prisma.messageThreadParticipant.findUnique({
      where: { threadId_userId: { threadId, userId } },
      select: { userId: true },
    })
    if (!participant) return jsonFail(403, 'Forbidden.')

    const body = await readJsonRecord(req)
    const contentType = trimOrEmpty(body.contentType)
    if (!contentType) return jsonFail(400, 'Missing contentType.')
    if (!isSupportedAttachmentContentType(contentType)) {
      return jsonFail(400, 'Only image uploads are supported.')
    }

    const size =
      typeof body.size === 'number' && Number.isFinite(body.size)
        ? body.size
        : null
    if (size != null && size > MAX_ATTACHMENT_BYTES) {
      return jsonFail(400, 'File too large (max 30MB).')
    }

    const bucket = MESSAGE_ATTACHMENT_BUCKET
    const path = buildMessageAttachmentPath({ threadId, userId, contentType })

    const admin = getSupabaseAdmin()
    const { data, error } = await admin.storage
      .from(bucket)
      .createSignedUploadUrl(path)

    if (error || !data?.token) {
      return jsonFail(500, error?.message || 'Failed to create signed upload URL.')
    }

    const signedUrlRaw = (data as Record<string, unknown>).signedUrl
    const signedUrl = typeof signedUrlRaw === 'string' ? signedUrlRaw : null

    return jsonOk({
      bucket,
      path,
      token: data.token,
      signedUrl,
    } satisfies MessageUploadInitDTO)
  } catch (e: unknown) {
    console.error('POST /api/v1/messages/threads/[id]/uploads', e)
    const msg = e instanceof Error ? e.message : 'Internal error'
    return jsonFail(500, msg)
  }
}
