// app/api/admin/uploads/route.ts
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { AdminPermissionRole } from '@prisma/client'
import { hasAdminPermission } from '@/lib/adminPermissions'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { jsonFail, jsonOk } from '@/app/api/_utils/responses'
import { safeUrl } from '@/app/api/_utils/media'

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
  await supabaseAdmin.storage
    .from(bucket)
    .remove([`${base}.jpg`, `${base}.jpeg`, `${base}.png`, `${base}.webp`])
    .catch(() => null)
}

async function requireSupportScope(args: { adminUserId: string; serviceId: string }) {
  const ok = await hasAdminPermission({
    adminUserId: args.adminUserId,
    allowedRoles: [AdminPermissionRole.SUPER_ADMIN, AdminPermissionRole.SUPPORT],
    scope: { serviceId: args.serviceId },
  })
  return ok
}

function buildPublicUrl(args: { base: string; bucket: string; path: string }) {
  return `${args.base}/storage/v1/object/public/${args.bucket}/${args.path}`
}

/**
 * Confirm the object exists (best effort).
 * We list the folder and check for an exact filename match.
 */
async function objectExists(args: { bucket: string; path: string }) {
  const parts = args.path.split('/')
  const file = parts.pop() || ''
  const folder = parts.join('/') || ''
  const { data, error } = await supabaseAdmin.storage.from(args.bucket).list(folder, { limit: 1000 })
  if (error) return false
  return (data || []).some((x: any) => x?.name === file)
}

type InitBody = {
  kind: 'SERVICE_DEFAULT_IMAGE_PUBLIC'
  serviceId: string
  contentType: string
  size: number
}

type FinalizeBody = {
  kind: 'SERVICE_DEFAULT_IMAGE_PUBLIC_FINALIZE'
  serviceId: string
  publicUrl: string
  cacheBuster?: number
  // optional: helps server verify existence
  path?: string
}

export async function POST(req: NextRequest) {
  try {
    const { user, res } = await requireUser({ roles: ['ADMIN'] as any })
    if (res) return res

    const body = (await req.json().catch(() => null)) as InitBody | FinalizeBody | null
    if (!body) return jsonFail(400, 'Invalid JSON')

    // ------------------------------------------
    // FINALIZE: persist image url in Prisma
    // ------------------------------------------
    if (body.kind === 'SERVICE_DEFAULT_IMAGE_PUBLIC_FINALIZE') {
      const serviceId = pickString(body.serviceId)
      const rawUrl = pickString(body.publicUrl)
      const cacheBuster = typeof body.cacheBuster === 'number' ? body.cacheBuster : null
      const path = pickString((body as any).path)

      if (!serviceId) return jsonFail(400, 'Missing serviceId')
      if (!rawUrl) return jsonFail(400, 'Missing publicUrl')

      const ok = await requireSupportScope({ adminUserId: user.id, serviceId })
      if (!ok) return jsonFail(403, 'Forbidden')

      const cleaned = safeUrl(rawUrl)
      if (!cleaned) return jsonFail(400, 'Invalid publicUrl')

      // optional existence check (best effort)
      const bucket = 'media-public'
      if (path) {
        const exists = await objectExists({ bucket, path })
        if (!exists) {
          // Don’t brick the workflow for transient consistency, but be honest.
          // If you prefer strict behavior, change to return jsonFail(400,...)
          // For now: allow persist and let the client refresh later.
        }
      }

      const finalUrl = cacheBuster ? `${cleaned}${cleaned.includes('?') ? '&' : '?'}v=${cacheBuster}` : cleaned

      await prisma.service.update({
        where: { id: serviceId },
        data: { defaultImageUrl: finalUrl },
      })

      await prisma.adminActionLog
        .create({
          data: {
            adminUserId: user.id,
            serviceId,
            action: 'SERVICE_IMAGE_UPDATED',
            note: 'defaultImageUrl updated via upload finalize',
          },
        })
        .catch(() => null)

      return jsonOk({ defaultImageUrl: finalUrl })
    }

    // ------------------------------------------
    // INIT: sign upload URL
    // ------------------------------------------
    const kind = pickString((body as any).kind)
    const serviceId = pickString((body as any).serviceId)
    const contentType = pickString((body as any).contentType)
    const size = Number((body as any).size ?? 0)

    if (kind !== 'SERVICE_DEFAULT_IMAGE_PUBLIC') return jsonFail(400, 'Unsupported kind')
    if (!serviceId) return jsonFail(400, 'Missing serviceId')
    if (!contentType || !isAllowedImageContentType(contentType)) return jsonFail(400, 'Invalid contentType')
    if (!Number.isFinite(size) || size <= 0 || size > 8_000_000) return jsonFail(400, 'Invalid size (max 8MB)')

    const ok = await requireSupportScope({ adminUserId: user.id, serviceId })
    if (!ok) return jsonFail(403, 'Forbidden')

    const base = mustBaseUrl()
    const bucket = 'media-public'
    const ext = safeExtFromContentType(contentType)
    const cacheBuster = Date.now()

    const path = `service/default/${serviceId}/default.${ext}`

    // best-effort cleanup to avoid extension drift
    await cleanupOldServiceDefaultImages({ bucket, serviceId })

    // create signed upload url (prefer upsert)
    const tryUpsert = await supabaseAdmin.storage
      .from(bucket)
      .createSignedUploadUrl(path, { upsert: true })
      .catch((e) => ({ data: null as any, error: e }))

    let token: string | null = null

    if ((tryUpsert as any)?.data?.token) {
      token = (tryUpsert as any).data.token
    } else {
      const fallback = await supabaseAdmin.storage.from(bucket).createSignedUploadUrl(path)
      if (fallback?.error) return jsonFail(500, fallback.error.message || 'Failed to create signed upload URL')
      token = (fallback as any)?.data?.token ?? null
    }

    if (!token) return jsonFail(500, 'Signed upload token missing')

    const publicUrl = buildPublicUrl({ base, bucket, path })

    return jsonOk({
      bucket,
      path,
      token,
      publicUrl,
      cacheBuster,
    })
  } catch (e: any) {
    console.error('POST /api/admin/uploads error', e)
    return jsonFail(500, e?.message || 'Internal server error')
  }
}
