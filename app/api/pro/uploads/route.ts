// app/api/pro/uploads/route.ts
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/currentUser'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'

function pickString(v: unknown) {
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

/**
 * ✅ Two-bucket strategy:
 * - media-public  : public read (Looks/Portfolio/Reviews/Avatars/Service images)
 * - media-private : private read (DMs/Aftercare/Verify/Consult)
 *
 * ✅ Stable paths:
 * - Avatar:        pro/<proId>/avatar/current.<ext>
 * - Service image: pro/<proId>/services/<serviceId>/image/current.<ext>
 *
 * ✅ Upload flow returned by this route:
 * - bucket + path + token
 * - Use supabase.storage.from(bucket).uploadToSignedUrl(path, token, file, { upsert: true })
 */
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
  const s = pickString(v).toUpperCase()
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

function envCheck() {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  return { base, service }
}

function buildPath(opts: { proId: string; kind: UploadKind; contentType: string; serviceId?: string }) {
  const { proId, kind, contentType, serviceId } = opts
  const ext = guessExtFromType(contentType)

  if (kind === 'AVATAR_PUBLIC') {
    return `pro/${proId}/avatar/current.${ext}`
  }

  if (kind === 'SERVICE_IMAGE_PUBLIC') {
    const id = pickString(serviceId)
    if (!id) throw new Error('SERVICE_IMAGE_PUBLIC requires serviceId')
    return `pro/${proId}/services/${id}/image/current.${ext}`
  }

  // everything else can be timestamped
  const ym = new Date().toISOString().slice(0, 7)
  const rand = Math.random().toString(16).slice(2)
  return `pro/${proId}/${kind.toLowerCase()}/${ym}/${Date.now()}_${rand}.${ext}`
}

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'PRO' || !user.professionalProfile?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { base, service } = envCheck()
    if (!base) return NextResponse.json({ error: 'NEXT_PUBLIC_SUPABASE_URL missing' }, { status: 500 })
    if (!service) {
      return NextResponse.json(
        { error: 'SUPABASE_SERVICE_ROLE_KEY missing (server storage requires admin key)' },
        { status: 500 },
      )
    }

    const body = await req.json().catch(() => ({} as any))

    const kind = parseKind(body?.kind)
    if (!kind) return NextResponse.json({ error: 'Invalid kind' }, { status: 400 })

    const contentType = pickString(body?.contentType)
    const size = typeof body?.size === 'number' ? body.size : null
    const serviceId = pickString(body?.serviceId)

    if (!contentType) return NextResponse.json({ error: 'Missing contentType' }, { status: 400 })

    const isImage = contentType.startsWith('image/')
    const isVideo = contentType.startsWith('video/')

    // tighten rules: only images/videos across the board
    if (!isImage && !isVideo) {
      return NextResponse.json({ error: 'Only image/video uploads allowed' }, { status: 400 })
    }

    // avatar + service images must be image/*
    if (kind === 'AVATAR_PUBLIC' || kind === 'SERVICE_IMAGE_PUBLIC') {
      if (!isImage) return NextResponse.json({ error: `${kind} only supports image/*` }, { status: 400 })
    }

    if (size != null && size > 30 * 1024 * 1024) {
      return NextResponse.json({ error: 'File too large (max 30MB)' }, { status: 400 })
    }

    const { bucket, isPublic } = resolveBucket(kind)
    const proId = user.professionalProfile.id

    let path: string
    try {
      path = buildPath({ proId, kind, contentType, serviceId })
    } catch (err: any) {
      return NextResponse.json({ error: err?.message || 'Invalid upload parameters' }, { status: 400 })
    }

    // ✅ This returns token + signedUrl. Token is what the client SDK uses in uploadToSignedUrl.
    const { data, error } = await supabaseAdmin.storage.from(bucket).createSignedUploadUrl(path)

    if (error) {
      return NextResponse.json(
        {
          error: 'Failed to create signed upload URL',
          supabase: {
            message: error.message,
            name: (error as any).name,
            statusCode: (error as any).statusCode,
          },
          debug: { bucket, path, kind, contentType, size, serviceId: serviceId || null },
        },
        { status: 500 },
      )
    }

    if (!data?.token) {
      return NextResponse.json(
        { error: 'Signed upload token missing', debug: { bucket, path, kind } },
        { status: 500 },
      )
    }

    // signedUrl can exist, but you should NOT rely on PUT fetch with this flow.
    // Clients should use uploadToSignedUrl(path, token, file).
    const publicUrl = isPublic ? `${base}/storage/v1/object/public/${bucket}/${path}` : null

    return NextResponse.json({
      ok: true,
      kind,
      bucket,
      path,
      token: data.token,
      // included for debugging/compat, but client should use uploadToSignedUrl
      signedUrl: data.signedUrl ?? null,
      publicUrl,
      isPublic,
      cacheBuster: Date.now(),
    })
  } catch (e: any) {
    console.error('POST /api/pro/uploads error', e)
    return NextResponse.json(
      {
        error: e?.message || 'Internal server error',
        stack: process.env.NODE_ENV === 'development' ? e?.stack : undefined,
      },
      { status: 500 },
    )
  }
}
