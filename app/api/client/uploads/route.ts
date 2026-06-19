// app/api/client/uploads/route.ts
import { MediaPhase } from '@prisma/client'
import { jsonFail, jsonOk, requireClient } from '@/app/api/_utils'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { prisma } from '@/lib/prisma'
import { extensionForContentType } from '@/lib/media/contentType'
import {
  createUploadSession,
  uploadSurfaceForKind,
} from '@/lib/media/uploadSession'

export const dynamic = 'force-dynamic'

// Client signing kinds. REVIEW_PUBLIC = review media; LOOK_PUBLIC = a photo for a
// Share-your-look post. Both land in media-public (the client consents to a
// public-intent asset). LOOK_PUBLIC may carry a BEFORE/AFTER phase + bookingId.
type ClientUploadKind = 'REVIEW_PUBLIC' | 'LOOK_PUBLIC'

function isClientUploadKind(value: string): value is ClientUploadKind {
  return value === 'REVIEW_PUBLIC' || value === 'LOOK_PUBLIC'
}

function readPhase(value: unknown): MediaPhase | null {
  if (value === MediaPhase.BEFORE || value === MediaPhase.AFTER) return value
  return null
}

function trimOrEmpty(v: unknown) {
  return typeof v === 'string' ? v.trim() : ''
}

function buildPath(args: { clientId: string; kind: ClientUploadKind; contentType: string }) {
  const ext = extensionForContentType(args.contentType)
  const ym = new Date().toISOString().slice(0, 7)
  const rand = Math.random().toString(16).slice(2)
  return `client/${args.clientId}/${args.kind.toLowerCase()}/${ym}/${Date.now()}_${rand}.${ext}`
}

type Body = {
  kind?: unknown
  contentType?: unknown
  size?: unknown
  phase?: unknown
  bookingId?: unknown
}

function readSignedUrl(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null
  if (!('signedUrl' in data)) return null
  const v = (data as { signedUrl?: unknown }).signedUrl
  return typeof v === 'string' && v.trim() ? v : null
}

export async function POST(req: Request) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res
    const { clientId } = auth

    const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
    if (!base) return jsonFail(500, 'NEXT_PUBLIC_SUPABASE_URL missing')

    const body = (await req.json().catch(() => ({}))) as Body

    const kind = trimOrEmpty(body.kind).toUpperCase()
    if (!isClientUploadKind(kind)) return jsonFail(400, 'Invalid kind')

    const contentType = trimOrEmpty(body.contentType)
    if (!contentType) return jsonFail(400, 'Missing contentType')

    // LOOK_PUBLIC uploads optionally carry the visit booking + a BEFORE/AFTER
    // phase so the share-look attach can validate them. REVIEW_PUBLIC ignores both.
    const phase = kind === 'LOOK_PUBLIC' ? readPhase(body.phase) : null
    const bookingId =
      kind === 'LOOK_PUBLIC' && trimOrEmpty(body.bookingId)
        ? trimOrEmpty(body.bookingId)
        : null

    const size = typeof body.size === 'number' && Number.isFinite(body.size) ? body.size : null

    const isImage = contentType.startsWith('image/')
    const isVideo = contentType.startsWith('video/')
    if (!isImage && !isVideo) return jsonFail(400, 'Only image/video uploads allowed')

    // Keep consistent with your pro route limit
    if (size != null && size > 30 * 1024 * 1024) return jsonFail(400, 'File too large (max 30MB)')

    const bucket = 'media-public'
    const path = buildPath({ clientId, kind, contentType })

    const { data, error } = await supabaseAdmin.storage.from(bucket).createSignedUploadUrl(path)

    if (error) return jsonFail(500, error.message || 'Failed to create signed upload URL')
    if (!data || typeof data !== 'object' || !('token' in data) || typeof (data as { token?: unknown }).token !== 'string') {
      return jsonFail(500, 'Signed upload token missing')
    }

    const token = (data as { token: string }).token
    const signedUrl = readSignedUrl(data)

    const publicUrl = `${base}/storage/v1/object/public/${bucket}/${path}`

    // Bind this signed upload to a PENDING UploadSession. The pro/tenant aren't
    // known until attach, so only clientId (+ optional bookingId/phase for looks)
    // is recorded here; the attach route validates ownership by clientId.
    const surface = uploadSurfaceForKind(kind)
    let uploadSessionId: string | null = null
    if (surface) {
      const session = await createUploadSession(prisma, {
        surface,
        storageBucket: bucket,
        storagePath: path,
        contentType,
        maxBytes: 30 * 1024 * 1024,
        clientId,
        bookingId,
        phase,
        now: new Date(),
      })
      uploadSessionId = session.id
    }

    return jsonOk({
      kind,
      bucket,
      path,
      token,
      signedUrl,
      publicUrl,
      isPublic: true,
      cacheBuster: Date.now(),
      uploadSessionId,
    })
  } catch (e: unknown) {
    console.error('POST /api/client/uploads error', e)
    const msg = e instanceof Error ? e.message : 'Internal server error'
    return jsonFail(500, msg)
  }
}