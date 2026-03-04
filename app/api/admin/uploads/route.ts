// app/api/admin/uploads/route.ts
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Role, AdminPermissionRole } from '@prisma/client'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { hasAdminPermission } from '@/lib/adminPermissions'

import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { jsonFail, jsonOk } from '@/app/api/_utils/responses'

import { isRecord } from '@/lib/guards'
import { pickNumber, pickString } from '@/lib/pick'
import { errorMessageFromUnknown } from '@/lib/http'
import { safeUrl } from '@/lib/media'
import { withCacheBuster } from '@/lib/url'

export const dynamic = 'force-dynamic'

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
  path?: string
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
  return hasAdminPermission({
    adminUserId: args.adminUserId,
    allowedRoles: [AdminPermissionRole.SUPER_ADMIN, AdminPermissionRole.SUPPORT],
    scope: { serviceId: args.serviceId },
  })
}

function buildPublicUrl(args: { base: string; bucket: string; path: string }) {
  return `${args.base}/storage/v1/object/public/${args.bucket}/${args.path}`
}

async function objectExists(args: { bucket: string; path: string }) {
  const parts = args.path.split('/')
  const file = parts.pop() || ''
  const folder = parts.join('/') || ''

  const { data, error } = await supabaseAdmin.storage.from(args.bucket).list(folder, { limit: 1000 })
  if (error) return false

  return (data ?? []).some((x) => typeof x?.name === 'string' && x.name === file)
}

function parseInitBody(raw: Record<string, unknown>): InitBody | null {
  const kind = pickString(raw.kind)
  if (kind !== 'SERVICE_DEFAULT_IMAGE_PUBLIC') return null

  const serviceId = pickString(raw.serviceId)
  const contentType = pickString(raw.contentType)
  const size = pickNumber(raw.size)

  if (!serviceId || !contentType || size == null) return null
  return { kind: 'SERVICE_DEFAULT_IMAGE_PUBLIC', serviceId, contentType, size }
}

function parseFinalizeBody(raw: Record<string, unknown>): FinalizeBody | null {
  const kind = pickString(raw.kind)
  if (kind !== 'SERVICE_DEFAULT_IMAGE_PUBLIC_FINALIZE') return null

  const serviceId = pickString(raw.serviceId)
  const publicUrl = pickString(raw.publicUrl)
  if (!serviceId || !publicUrl) return null

  const cacheBusterRaw = raw.cacheBuster
  const cacheBuster = typeof cacheBusterRaw === 'number' && Number.isFinite(cacheBusterRaw) ? cacheBusterRaw : undefined

  const path = pickString(raw.path) ?? undefined

  return { kind: 'SERVICE_DEFAULT_IMAGE_PUBLIC_FINALIZE', serviceId, publicUrl, cacheBuster, path }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireUser({ roles: [Role.ADMIN] })
    if (!auth.ok) return auth.res
    const user = auth.user

    const rawJson: unknown = await req.json().catch(() => null)
    if (!isRecord(rawJson)) return jsonFail(400, 'Invalid JSON')

    // ------------------------------------------
    // FINALIZE: persist image url in Prisma
    // ------------------------------------------
    const finalize = parseFinalizeBody(rawJson)
    if (finalize) {
      const ok = await requireSupportScope({ adminUserId: user.id, serviceId: finalize.serviceId })
      if (!ok) return jsonFail(403, 'Forbidden')

      const cleaned = safeUrl(finalize.publicUrl)
      if (!cleaned) return jsonFail(400, 'Invalid publicUrl')

      const bucket = 'media-public'
      if (finalize.path) {
        await objectExists({ bucket, path: finalize.path }).catch(() => false)
      }

      const finalUrl = finalize.cacheBuster ? withCacheBuster(cleaned, finalize.cacheBuster) : cleaned

      await prisma.service.update({
        where: { id: finalize.serviceId },
        data: { defaultImageUrl: finalUrl },
      })

      await prisma.adminActionLog
        .create({
          data: {
            adminUserId: user.id,
            serviceId: finalize.serviceId,
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
    const init = parseInitBody(rawJson)
    if (!init) return jsonFail(400, 'Unsupported kind')

    if (!isAllowedImageContentType(init.contentType)) return jsonFail(400, 'Invalid contentType')
    if (!Number.isFinite(init.size) || init.size <= 0 || init.size > 8_000_000) {
      return jsonFail(400, 'Invalid size (max 8MB)')
    }

    const ok = await requireSupportScope({ adminUserId: user.id, serviceId: init.serviceId })
    if (!ok) return jsonFail(403, 'Forbidden')

    const base = mustBaseUrl()
    const bucket = 'media-public'
    const ext = safeExtFromContentType(init.contentType)
    const cacheBuster = Date.now()
    const path = `service/default/${init.serviceId}/default.${ext}`

    await cleanupOldServiceDefaultImages({ bucket, serviceId: init.serviceId })

    let token: string | null = null

    try {
      const { data, error } = await supabaseAdmin.storage.from(bucket).createSignedUploadUrl(path, { upsert: true })
      if (error) throw error
      token = data?.token ?? null
    } catch {
      const { data, error } = await supabaseAdmin.storage.from(bucket).createSignedUploadUrl(path)
      if (error) return jsonFail(500, errorMessageFromUnknown(error) || 'Failed to create signed upload URL')
      token = data?.token ?? null
    }

    if (!token) return jsonFail(500, 'Signed upload token missing')

    const publicUrl = buildPublicUrl({ base, bucket, path })

    return jsonOk({ bucket, path, token, publicUrl, cacheBuster })
  } catch (e: unknown) {
    console.error('POST /api/admin/uploads error', e)
    return jsonFail(500, errorMessageFromUnknown(e) || 'Internal server error')
  }
}