// app/api/v1/admin/uploads/route.ts

import { NextRequest } from 'next/server'
import { AdminPermissionRole, Role } from '@prisma/client'

import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { jsonFail, jsonOk } from '@/app/api/_utils/responses'
import { writeAdminAuditLog } from '@/lib/admin/auditLog'
import { hasAdminPermission } from '@/lib/adminPermissions'
import { isRecord } from '@/lib/guards'
import { errorMessageFromUnknown } from '@/lib/http'
import { safeError } from '@/lib/security/logging'
import { safeUrl } from '@/lib/media'
import { pickNumber, pickString } from '@/lib/pick'
import { prisma } from '@/lib/prisma'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
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

function isAllowedImageContentType(contentType: string): boolean {
  return contentType.toLowerCase().startsWith('image/')
}

function safeExtFromContentType(contentType: string): string {
  const normalized = contentType.toLowerCase()

  if (normalized.includes('png')) return 'png'
  if (normalized.includes('webp')) return 'webp'
  if (normalized.includes('jpeg') || normalized.includes('jpg')) return 'jpg'

  return 'bin'
}

function mustBaseUrl(): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()

  if (!base) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL missing')
  }

  return base
}

async function cleanupOldServiceDefaultImages(args: {
  bucket: string
  serviceId: string
}): Promise<void> {
  const base = `service/default/${args.serviceId}/default`

  await supabaseAdmin.storage
    .from(args.bucket)
    .remove([`${base}.jpg`, `${base}.jpeg`, `${base}.png`, `${base}.webp`])
    .catch(() => null)
}

async function requireSupportScope(args: {
  adminUserId: string
  serviceId: string
}): Promise<boolean> {
  return hasAdminPermission({
    adminUserId: args.adminUserId,
    allowedRoles: [
      AdminPermissionRole.SUPER_ADMIN,
      AdminPermissionRole.SUPPORT,
    ],
    scope: { serviceId: args.serviceId },
  })
}

function buildPublicUrl(args: {
  base: string
  bucket: string
  path: string
}): string {
  return `${args.base}/storage/v1/object/public/${args.bucket}/${args.path}`
}

async function objectExists(args: {
  bucket: string
  path: string
}): Promise<boolean> {
  const parts = args.path.split('/')
  const file = parts.pop() || ''
  const folder = parts.join('/') || ''

  const { data, error } = await supabaseAdmin.storage
    .from(args.bucket)
    .list(folder, { limit: 1000 })

  if (error) return false

  return (data ?? []).some(
    (item) => typeof item?.name === 'string' && item.name === file,
  )
}

function parseInitBody(raw: Record<string, unknown>): InitBody | null {
  const kind = pickString(raw.kind)

  if (kind !== 'SERVICE_DEFAULT_IMAGE_PUBLIC') {
    return null
  }

  const serviceId = pickString(raw.serviceId)
  const contentType = pickString(raw.contentType)
  const size = pickNumber(raw.size)

  if (!serviceId || !contentType || size == null) {
    return null
  }

  return {
    kind: 'SERVICE_DEFAULT_IMAGE_PUBLIC',
    serviceId,
    contentType,
    size,
  }
}

function parseFinalizeBody(raw: Record<string, unknown>): FinalizeBody | null {
  const kind = pickString(raw.kind)

  if (kind !== 'SERVICE_DEFAULT_IMAGE_PUBLIC_FINALIZE') {
    return null
  }

  const serviceId = pickString(raw.serviceId)
  const publicUrl = pickString(raw.publicUrl)

  if (!serviceId || !publicUrl) {
    return null
  }

  const cacheBusterRaw = raw.cacheBuster
  const cacheBuster =
    typeof cacheBusterRaw === 'number' && Number.isFinite(cacheBusterRaw)
      ? cacheBusterRaw
      : undefined

  const path = pickString(raw.path) ?? undefined

  return {
    kind: 'SERVICE_DEFAULT_IMAGE_PUBLIC_FINALIZE',
    serviceId,
    publicUrl,
    cacheBuster,
    path,
  }
}

async function createSignedUploadUrl(args: {
  bucket: string
  path: string
}): Promise<string | null> {
  try {
    const { data, error } = await supabaseAdmin.storage
      .from(args.bucket)
      .createSignedUploadUrl(args.path, { upsert: true })

    if (error) throw error

    return data?.token ?? null
  } catch {
    const { data, error } = await supabaseAdmin.storage
      .from(args.bucket)
      .createSignedUploadUrl(args.path)

    if (error) {
      throw error
    }

    return data?.token ?? null
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireUser({ roles: [Role.ADMIN] })
    if (!auth.ok) return auth.res

    const user = auth.user

    const rawJson: unknown = await req.json().catch(() => null)

    if (!isRecord(rawJson)) {
      return jsonFail(400, 'Invalid JSON')
    }

    const finalize = parseFinalizeBody(rawJson)

    if (finalize) {
      const allowed = await requireSupportScope({
        adminUserId: user.id,
        serviceId: finalize.serviceId,
      })

      if (!allowed) {
        return jsonFail(403, 'Forbidden')
      }

      const cleaned = safeUrl(finalize.publicUrl)

      if (!cleaned) {
        return jsonFail(400, 'Invalid publicUrl')
      }

      const bucket = 'media-public'

      const uploadedObjectExists = finalize.path
        ? await objectExists({ bucket, path: finalize.path }).catch(() => false)
        : null

      const finalUrl = finalize.cacheBuster
        ? withCacheBuster(cleaned, finalize.cacheBuster)
        : cleaned

      await prisma.service.update({
        where: { id: finalize.serviceId },
        data: { defaultImageUrl: finalUrl },
      })

      await writeAdminAuditLog({
        adminUserId: user.id,
        serviceId: finalize.serviceId,
        action: 'SERVICE_IMAGE_UPDATED',
        note: 'Service default image updated',
        metadata: {
          serviceId: finalize.serviceId,
          hasStoragePath: Boolean(finalize.path),
          uploadedObjectExists,
          cacheBusterProvided: finalize.cacheBuster !== undefined,
        },
      }).catch(() => null)

      return jsonOk({ defaultImageUrl: finalUrl })
    }

    const init = parseInitBody(rawJson)

    if (!init) {
      return jsonFail(400, 'Unsupported kind')
    }

    if (!isAllowedImageContentType(init.contentType)) {
      return jsonFail(400, 'Invalid contentType')
    }

    if (!Number.isFinite(init.size) || init.size <= 0 || init.size > 8_000_000) {
      return jsonFail(400, 'Invalid size (max 8MB)')
    }

    const allowed = await requireSupportScope({
      adminUserId: user.id,
      serviceId: init.serviceId,
    })

    if (!allowed) {
      return jsonFail(403, 'Forbidden')
    }

    const base = mustBaseUrl()
    const bucket = 'media-public'
    const ext = safeExtFromContentType(init.contentType)
    const cacheBuster = Date.now()
    const path = `service/default/${init.serviceId}/default.${ext}`

    await cleanupOldServiceDefaultImages({
      bucket,
      serviceId: init.serviceId,
    })

    let token: string | null = null

    try {
      token = await createSignedUploadUrl({ bucket, path })
    } catch (error: unknown) {
      return jsonFail(
        500,
        errorMessageFromUnknown(error) || 'Failed to create signed upload URL',
      )
    }

    if (!token) {
      return jsonFail(500, 'Signed upload token missing')
    }

    const publicUrl = buildPublicUrl({ base, bucket, path })

    return jsonOk({
      bucket,
      path,
      token,
      publicUrl,
      cacheBuster,
    })
  } catch (error: unknown) {
    console.error('POST /api/v1/admin/uploads error', { error: safeError(error) })

    return jsonFail(
      500,
      errorMessageFromUnknown(error) || 'Internal server error',
    )
  }
}