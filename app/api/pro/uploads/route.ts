// app/api/pro/uploads/route.ts
import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'

function trimOrEmpty(v: unknown) {
  return typeof v === 'string' ? v.trim() : ''
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

function parseKind(v: unknown): UploadKind | null {
  const s = trimOrEmpty(v).toUpperCase()
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

function resolveBucket(kind: UploadKind) {
  const isPublic =
    kind === 'LOOKS_PUBLIC' ||
    kind === 'PORTFOLIO_PUBLIC' ||
    kind === 'REVIEW_PUBLIC' ||
    kind === 'AVATAR_PUBLIC' ||
    kind === 'SERVICE_IMAGE_PUBLIC'

  return { bucket: isPublic ? 'media-public' : 'media-private', isPublic }
}

function buildPath(opts: { proId: string; kind: UploadKind; contentType: string; serviceId?: string }) {
  const { proId, kind, contentType, serviceId } = opts
  const ext = guessExtFromType(contentType)

  if (kind === 'AVATAR_PUBLIC') {
    return `pro/${proId}/avatar/current.${ext}`
  }

  if (kind === 'SERVICE_IMAGE_PUBLIC') {
    const id = trimOrEmpty(serviceId)
    if (!id) throw new Error('SERVICE_IMAGE_PUBLIC requires serviceId')
    return `pro/${proId}/services/${id}/image/current.${ext}`
  }

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
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()

    if (!base) return jsonFail(500, 'NEXT_PUBLIC_SUPABASE_URL missing')
    if (!serviceKey) return jsonFail(500, 'SUPABASE_SERVICE_ROLE_KEY missing (server storage requires admin key)')

    const body = await req.json().catch(() => ({} as any))

    const kind = parseKind(body?.kind)
    if (!kind) return jsonFail(400, 'Invalid kind')

    const contentType = trimOrEmpty(body?.contentType)
    const size = typeof body?.size === 'number' ? body.size : null
    const serviceId = trimOrEmpty(body?.serviceId)

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

    const { bucket, isPublic } = resolveBucket(kind)

    let path: string
    try {
      path = buildPath({ proId, kind, contentType, serviceId: serviceId || undefined })
    } catch (err: any) {
      return jsonFail(400, err?.message || 'Invalid upload parameters')
    }

    const { data, error } = await supabaseAdmin.storage.from(bucket).createSignedUploadUrl(path)

    if (error) {
      return jsonFail(500, 'Failed to create signed upload URL', {
        supabase: {
          message: error.message,
          name: (error as any).name,
          statusCode: (error as any).statusCode,
        },
        debug: { bucket, path, kind, contentType, size, serviceId: serviceId || null },
      })
    }

    if (!data?.token) return jsonFail(500, 'Signed upload token missing', { debug: { bucket, path, kind } })

    const publicUrl = isPublic ? `${base}/storage/v1/object/public/${bucket}/${path}` : null

    return jsonOk(
      {
        ok: true,
        kind,
        bucket,
        path,
        token: data.token,
        signedUrl: data.signedUrl ?? null,
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
