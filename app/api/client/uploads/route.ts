// app/api/client/uploads/route.ts
import { jsonFail, jsonOk, requireClient } from '@/app/api/_utils'
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

function buildPath(args: { clientId: string; kind: 'REVIEW_PUBLIC'; contentType: string }) {
  const ext = guessExtFromType(args.contentType)
  const ym = new Date().toISOString().slice(0, 7)
  const rand = Math.random().toString(16).slice(2)
  return `client/${args.clientId}/${args.kind.toLowerCase()}/${ym}/${Date.now()}_${rand}.${ext}`
}

type Body = {
  kind?: unknown
  contentType?: unknown
  size?: unknown
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
    if (kind !== 'REVIEW_PUBLIC') return jsonFail(400, 'Invalid kind')

    const contentType = trimOrEmpty(body.contentType)
    if (!contentType) return jsonFail(400, 'Missing contentType')

    const size = typeof body.size === 'number' && Number.isFinite(body.size) ? body.size : null

    const isImage = contentType.startsWith('image/')
    const isVideo = contentType.startsWith('video/')
    if (!isImage && !isVideo) return jsonFail(400, 'Only image/video uploads allowed')

    // Keep consistent with your pro route limit
    if (size != null && size > 30 * 1024 * 1024) return jsonFail(400, 'File too large (max 30MB)')

    const bucket = 'media-public'
    const path = buildPath({ clientId, kind: 'REVIEW_PUBLIC', contentType })

    const { data, error } = await supabaseAdmin.storage.from(bucket).createSignedUploadUrl(path)

    if (error) return jsonFail(500, error.message || 'Failed to create signed upload URL')
    if (!data || typeof data !== 'object' || !('token' in data) || typeof (data as { token?: unknown }).token !== 'string') {
      return jsonFail(500, 'Signed upload token missing')
    }

    const token = (data as { token: string }).token
    const signedUrl = readSignedUrl(data)

    const publicUrl = `${base}/storage/v1/object/public/${bucket}/${path}`

    return jsonOk({
      kind: 'REVIEW_PUBLIC',
      bucket,
      path,
      token,
      signedUrl,
      publicUrl,
      isPublic: true,
      cacheBuster: Date.now(),
    })
  } catch (e: unknown) {
    console.error('POST /api/client/uploads error', e)
    const msg = e instanceof Error ? e.message : 'Internal server error'
    return jsonFail(500, msg)
  }
}