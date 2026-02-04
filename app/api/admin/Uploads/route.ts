// app/api/admin/uploads/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { AdminPermissionRole } from '@prisma/client'
import { hasAdminPermission } from '@/lib/adminPermissions'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'

function pickString(v: unknown) {
  return typeof v === 'string' ? v.trim() : ''
}

function isAllowedImageContentType(ct: string) {
  return ct.toLowerCase().startsWith('image/')
}

function safeExtFromContentType(ct: string) {
  const t = ct.toLowerCase()
  if (t.includes('png')) return 'png'
  if (t.includes('webp')) return 'webp'
  if (t.includes('jpeg') || t.includes('jpg')) return 'jpg'
  return 'bin'
}

function mustBaseUrl() {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  if (!base) throw new Error('NEXT_PUBLIC_SUPABASE_URL missing')
  return base
}

async function cleanupOldServiceDefaultImages(args: { bucket: string; serviceId: string }) {
  const { bucket, serviceId } = args
  const base = `service/default/${serviceId}/default`
  // Best-effort cleanup; ignore failures.
  await supabaseAdmin.storage
    .from(bucket)
    .remove([`${base}.jpg`, `${base}.jpeg`, `${base}.png`, `${base}.webp`])
    .catch(() => null)
}

export async function POST(req: NextRequest) {
  try {
    const { user, res } = await requireUser({ roles: ['ADMIN'] as any })
    if (res) return res

    const body = (await req.json().catch(() => null)) as any
    if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

    const kind = pickString(body.kind)
    const serviceId = pickString(body.serviceId)
    const contentType = pickString(body.contentType)
    const size = Number(body.size ?? 0)

    if (kind !== 'SERVICE_DEFAULT_IMAGE_PUBLIC') {
      return NextResponse.json({ error: 'Unsupported kind' }, { status: 400 })
    }
    if (!serviceId) return NextResponse.json({ error: 'Missing serviceId' }, { status: 400 })
    if (!contentType || !isAllowedImageContentType(contentType)) {
      return NextResponse.json({ error: 'Invalid contentType' }, { status: 400 })
    }
    if (!Number.isFinite(size) || size <= 0 || size > 8_000_000) {
      return NextResponse.json({ error: 'Invalid size (max 8MB)' }, { status: 400 })
    }

    const ok = await hasAdminPermission({
      adminUserId: user.id,
      allowedRoles: [AdminPermissionRole.SUPER_ADMIN, AdminPermissionRole.SUPPORT],
      scope: { serviceId },
    })
    if (!ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const base = mustBaseUrl()
    const bucket = 'media-public'
    const ext = safeExtFromContentType(contentType)
    const cacheBuster = Date.now()

    // Deterministic path, replaces existing image
    const path = `service/default/${serviceId}/default.${ext}`

    // ✅ Prevent extension drift leaving old files behind (best effort)
    await cleanupOldServiceDefaultImages({ bucket, serviceId })

    // ✅ Create signed upload URL (prefer upsert)
    let signed:
      | { token?: string; signedUrl?: string | null }
      | null = null

    // Supabase SDK versions differ; try upsert, fallback if needed.
    const tryUpsert = await supabaseAdmin.storage
      .from(bucket)
      .createSignedUploadUrl(path, { upsert: true })
      .catch((e) => ({ data: null as any, error: e }))

    if (tryUpsert && (tryUpsert as any).data?.token) {
      signed = (tryUpsert as any).data
    } else {
      const fallback = await supabaseAdmin.storage.from(bucket).createSignedUploadUrl(path)
      if (fallback?.data?.token) signed = fallback.data as any
      if (fallback?.error) {
        return NextResponse.json(
          { error: fallback.error.message || 'Failed to create signed upload URL' },
          { status: 500 },
        )
      }
    }

    if (!signed?.token) {
      return NextResponse.json({ error: 'Signed upload token missing' }, { status: 500 })
    }

    const publicUrl = `${base}/storage/v1/object/public/${bucket}/${path}`

    return NextResponse.json({
      ok: true,
      bucket,
      path,
      token: signed.token,
      publicUrl,
      cacheBuster,
    })
  } catch (e: any) {
    console.error('POST /api/admin/uploads error', e)
    return NextResponse.json({ error: e?.message || 'Internal server error' }, { status: 500 })
  }
}
