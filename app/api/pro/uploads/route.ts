// app/api/pro/uploads/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'

function trimOrEmpty(v: unknown) {
  return typeof v === 'string' ? v.trim() : ''
}

function upper(v: unknown) {
  return typeof v === 'string' ? v.trim().toUpperCase() : ''
}

function guessExtFromType(type: string) {
  const t = type.toLowerCase()
  if (t.includes('png')) return 'png'
  if (t.includes('jpeg') || t.includes('jpg')) return 'jpg'
  if (t.includes('webp')) return 'webp'
  if (t.includes('heic') || t.includes('heif')) return 'heic'
  if (t.includes('mp4')) return 'mp4'
  if (t.includes('quicktime')) return 'mov'
  return 'bin'
}

type UploadKind =
  | 'LOOKS_PUBLIC'
  | 'PORTFOLIO_PUBLIC'
  | 'REVIEW_PUBLIC'
  | 'AVATAR_PUBLIC'
  | 'SERVICE_IMAGE_PUBLIC'
  | 'DM_PRIVATE'
  | 'AFTERCARE_PRIVATE'
  | 'VERIFY_PRIVATE'
  | 'CONSULT_PRIVATE'

type BookingPhase = 'BEFORE' | 'AFTER' | 'OTHER'

function parseKind(v: unknown): UploadKind | null {
  const s = upper(v)
  switch (s) {
    case 'LOOKS_PUBLIC':
    case 'PORTFOLIO_PUBLIC':
    case 'REVIEW_PUBLIC':
    case 'AVATAR_PUBLIC':
    case 'SERVICE_IMAGE_PUBLIC':
    case 'DM_PRIVATE':
    case 'AFTERCARE_PRIVATE':
    case 'VERIFY_PRIVATE':
    case 'CONSULT_PRIVATE':
      return s as UploadKind
    default:
      return null
  }
}

function parsePhase(v: unknown): BookingPhase | null {
  const s = upper(v)
  if (s === 'BEFORE' || s === 'AFTER' || s === 'OTHER') return s
  return null
}

function resolveBucket(kind: UploadKind) {
  const isPublic =
    kind === 'LOOKS_PUBLIC' ||
    kind === 'PORTFOLIO_PUBLIC' ||
    kind === 'REVIEW_PUBLIC' ||
    kind === 'AVATAR_PUBLIC' ||
    kind === 'SERVICE_IMAGE_PUBLIC'

  return { bucket: isPublic ? 'media-public' : 'media-private', isPublic }
}

function shouldUpsert(kind: UploadKind) {
  // We overwrite stable "current.*" objects.
  return kind === 'AVATAR_PUBLIC' || kind === 'SERVICE_IMAGE_PUBLIC'
}

function buildBookingScopedPath(opts: {
  bookingId: string
  phase: BookingPhase
  contentType: string
}) {
  const ext = guessExtFromType(opts.contentType)
  const now = new Date()
  const yyyy = String(now.getUTCFullYear())
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(now.getUTCDate()).padStart(2, '0')
  const ts = String(now.getTime())
  const rand = Math.random().toString(16).slice(2)

  // bookings/<bookingId>/<phase>/YYYY/MM/DD/<ts>_<rand>.<ext>
  return [
    'bookings',
    opts.bookingId,
    opts.phase.toLowerCase(),
    yyyy,
    mm,
    dd,
    `${ts}_${rand}.${ext}`,
  ].join('/')
}

function buildPath(opts: {
  proId: string
  kind: UploadKind
  contentType: string
  serviceId?: string
  bookingId?: string
  phase?: BookingPhase
}) {
  const { proId, kind, contentType, serviceId, bookingId, phase } = opts
  const ext = guessExtFromType(contentType)

  // ✅ Booking-scoped consult/session uploads MUST live under bookings/<id>/...
  if (kind === 'CONSULT_PRIVATE') {
    const bid = trimOrEmpty(bookingId)
    if (!bid) throw new Error('CONSULT_PRIVATE requires bookingId')
    if (!phase) throw new Error('CONSULT_PRIVATE requires phase (BEFORE/AFTER/OTHER)')
    return buildBookingScopedPath({ bookingId: bid, phase, contentType })
  }

  // Stable paths (these are intentionally overwritten)
  if (kind === 'AVATAR_PUBLIC') {
    return `pro/${proId}/avatar/current.${ext}`
  }

  if (kind === 'SERVICE_IMAGE_PUBLIC') {
    const id = trimOrEmpty(serviceId)
    if (!id) throw new Error('SERVICE_IMAGE_PUBLIC requires serviceId')
    return `pro/${proId}/services/${id}/image/current.${ext}`
  }

  // Unique paths (no overwrite expected)
  const ym = new Date().toISOString().slice(0, 7)
  const rand = Math.random().toString(16).slice(2)
  return `pro/${proId}/${kind.toLowerCase()}/${ym}/${Date.now()}_${rand}.${ext}`
}

export async function POST(req: Request) {
  try {
    const auth = await requirePro()
    if (auth.res) return auth.res
    const proId = auth.professionalId

    const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
    if (!base) return jsonFail(500, 'NEXT_PUBLIC_SUPABASE_URL missing')

    const body = await req.json().catch(() => ({} as any))

    const kind = parseKind(body?.kind)
    if (!kind) return jsonFail(400, 'Invalid kind')

    const contentType = trimOrEmpty(body?.contentType)
    const size = typeof body?.size === 'number' ? body.size : null
    const serviceId = trimOrEmpty(body?.serviceId)
    const bookingId = trimOrEmpty(body?.bookingId)
    const phase = body?.phase != null ? parsePhase(body.phase) : null

    if (!contentType) return jsonFail(400, 'Missing contentType')

    const isImage = contentType.startsWith('image/')
    const isVideo = contentType.startsWith('video/')
    if (!isImage && !isVideo) return jsonFail(400, 'Only image/video uploads allowed')

    if (kind === 'AVATAR_PUBLIC' || kind === 'SERVICE_IMAGE_PUBLIC') {
      if (!isImage) return jsonFail(400, `${kind} only supports image/*`)
    }

    if (size != null && size > 30 * 1024 * 1024) {
      return jsonFail(400, 'File too large (max 30MB)')
    }

    // ✅ For consult booking uploads, enforce booking ownership BEFORE issuing signed token.
    if (kind === 'CONSULT_PRIVATE') {
      if (!bookingId) return jsonFail(400, 'Missing bookingId')
      if (!phase) return jsonFail(400, 'Missing/invalid phase (BEFORE/AFTER/OTHER)')

      const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        select: { id: true, professionalId: true },
      })

      if (!booking) return jsonFail(404, 'Booking not found')
      if (booking.professionalId !== proId) return jsonFail(403, 'Forbidden')
    }

    const { bucket, isPublic } = resolveBucket(kind)

    let path: string
    try {
      path = buildPath({
        proId,
        kind,
        contentType,
        serviceId: serviceId || undefined,
        bookingId: bookingId || undefined,
        phase: phase || undefined,
      })
    } catch (err: any) {
      return jsonFail(400, err?.message || 'Invalid upload parameters')
    }

    const admin = getSupabaseAdmin()
    const upsert = shouldUpsert(kind)

    const { data, error } = await admin.storage.from(bucket).createSignedUploadUrl(path, { upsert })

    if (error) {
      return jsonFail(500, error.message || 'Failed to create signed upload URL', {
        supabase: {
          message: error.message,
          name: (error as any).name,
          statusCode: (error as any).statusCode,
        },
        debug: { bucket, path, kind, contentType, size, serviceId: serviceId || null, bookingId: bookingId || null, phase: phase || null, upsert },
      })
    }

    if (!data?.token) {
      return jsonFail(500, 'Signed upload token missing', {
        debug: { bucket, path, kind, upsert },
      })
    }

    const publicUrl = isPublic ? `${base}/storage/v1/object/public/${bucket}/${path}` : null

    return jsonOk(
      {
        ok: true,
        kind,
        bucket,
        path,
        token: data.token,
        signedUrl: (data as any).signedUrl ?? null,
        publicUrl,
        isPublic,
        cacheBuster: Date.now(),
      },
      200,
    )
  } catch (e: any) {
    console.error('POST /api/pro/uploads error', e)
    return jsonFail(500, e?.message || 'Internal server error')
  }
}