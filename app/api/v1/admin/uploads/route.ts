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
import type {
  MediaAdminUploadFinalizeDTO,
  MediaAdminUploadInitDTO,
  MediaAdminViralCoverFinalizeDTO,
} from '@/lib/dto/media'
import { safeUrl } from '@/lib/media'
import { pickNumber, pickString } from '@/lib/pick'
import { prisma } from '@/lib/prisma'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import { withCacheBuster } from '@/lib/url'
import { getStorageEnvironmentMismatch } from '@/lib/media/storageEnvironment'
import {
  buildViralRequestCoverTargetPath,
  setViralRequestCoverImage,
} from '@/lib/viralRequests'

export const dynamic = 'force-dynamic'

type InitBody =
  | {
      kind: 'SERVICE_DEFAULT_IMAGE_PUBLIC'
      serviceId: string
      contentType: string
      size: number
    }
  | {
      kind: 'VIRAL_REQUEST_COVER_IMAGE_PUBLIC'
      requestId: string
      contentType: string
      size: number
    }

type FinalizeBody =
  | {
      kind: 'SERVICE_DEFAULT_IMAGE_PUBLIC_FINALIZE'
      serviceId: string
      publicUrl: string
      cacheBuster?: number
      path?: string
    }
  | {
      kind: 'VIRAL_REQUEST_COVER_IMAGE_PUBLIC_FINALIZE'
      requestId: string
      /** Null clears the reviewer's pick, falling back to the submitter's photo. */
      publicUrl: string | null
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

  await getSupabaseAdmin().storage
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

/**
 * A viral request's reviewer scope.
 *
 * REVIEWER, not SUPPORT: setting the picture a look is published under is part
 * of reviewing it, and it is the same pair of roles
 * `app/api/v1/admin/viral-service-requests/[id]/moderate` already gates the
 * approve/reject decision on. Scoped by the request's own requested category,
 * exactly as `buildViralRequestPermissionScope` does for moderation, so a
 * category-scoped reviewer cannot set covers outside their remit.
 *
 * Returns null when the request does not exist — the caller answers 404 rather
 * than leaking existence through a 403.
 */
async function requireViralReviewScope(args: {
  adminUserId: string
  requestId: string
}): Promise<boolean | null> {
  const request = await prisma.viralServiceRequest.findUnique({
    where: { id: args.requestId },
    select: { id: true, requestedCategoryId: true },
  })

  if (!request) return null

  return hasAdminPermission({
    adminUserId: args.adminUserId,
    allowedRoles: [
      AdminPermissionRole.SUPER_ADMIN,
      AdminPermissionRole.REVIEWER,
    ],
    scope: { categoryId: request.requestedCategoryId ?? undefined },
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

  const { data, error } = await getSupabaseAdmin().storage
    .from(args.bucket)
    .list(folder, { limit: 1000 })

  if (error) return false

  return (data ?? []).some(
    (item) => typeof item?.name === 'string' && item.name === file,
  )
}

function parseInitBody(raw: Record<string, unknown>): InitBody | null {
  const kind = pickString(raw.kind)
  const contentType = pickString(raw.contentType)
  const size = pickNumber(raw.size)

  if (!contentType || size == null) {
    return null
  }

  if (kind === 'SERVICE_DEFAULT_IMAGE_PUBLIC') {
    const serviceId = pickString(raw.serviceId)
    if (!serviceId) return null

    return { kind, serviceId, contentType, size }
  }

  if (kind === 'VIRAL_REQUEST_COVER_IMAGE_PUBLIC') {
    const requestId = pickString(raw.requestId)
    if (!requestId) return null

    return { kind, requestId, contentType, size }
  }

  return null
}

function parseFinalizeBody(raw: Record<string, unknown>): FinalizeBody | null {
  const kind = pickString(raw.kind)
  const publicUrl = pickString(raw.publicUrl)
  // Only the viral cover can be cleared — a service's default image is removed
  // through its own form, and an unset `clear` must never read as "clear".
  const clear = raw.clear === true

  if (!publicUrl && !clear) {
    return null
  }

  const cacheBusterRaw = raw.cacheBuster
  const cacheBuster =
    typeof cacheBusterRaw === 'number' && Number.isFinite(cacheBusterRaw)
      ? cacheBusterRaw
      : undefined

  const path = pickString(raw.path) ?? undefined

  if (kind === 'SERVICE_DEFAULT_IMAGE_PUBLIC_FINALIZE') {
    const serviceId = pickString(raw.serviceId)
    if (!serviceId || !publicUrl) return null

    return { kind, serviceId, publicUrl, cacheBuster, path }
  }

  if (kind === 'VIRAL_REQUEST_COVER_IMAGE_PUBLIC_FINALIZE') {
    const requestId = pickString(raw.requestId)
    if (!requestId) return null

    return {
      kind,
      requestId,
      publicUrl: clear ? null : publicUrl,
      cacheBuster,
      path,
    }
  }

  return null
}

async function createSignedUploadUrl(args: {
  bucket: string
  path: string
}): Promise<string | null> {
  try {
    const { data, error } = await getSupabaseAdmin().storage
      .from(args.bucket)
      .createSignedUploadUrl(args.path, { upsert: true })

    if (error) throw error

    return data?.token ?? null
  } catch {
    const { data, error } = await getSupabaseAdmin().storage
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

    // Refuse rather than silently PUT bytes into a remote bucket from a local
    // database (see lib/media/storageEnvironment.ts). After the auth gate so an
    // anonymous caller gets its 401 and never sees infra hostnames; fails open,
    // so it returns null in production and CI.
    const storageMismatch = getStorageEnvironmentMismatch()
    if (storageMismatch) return jsonFail(500, storageMismatch)

    const user = auth.user

    const rawJson: unknown = await req.json().catch(() => null)

    if (!isRecord(rawJson)) {
      return jsonFail(400, 'Invalid JSON')
    }

    const finalize = parseFinalizeBody(rawJson)

    if (finalize?.kind === 'VIRAL_REQUEST_COVER_IMAGE_PUBLIC_FINALIZE') {
      const allowed = await requireViralReviewScope({
        adminUserId: user.id,
        requestId: finalize.requestId,
      })

      if (allowed === null) return jsonFail(404, 'Viral request not found')
      if (!allowed) return jsonFail(403, 'Forbidden')

      const cleaned =
        finalize.publicUrl === null ? null : safeUrl(finalize.publicUrl)

      if (finalize.publicUrl !== null && !cleaned) {
        return jsonFail(400, 'Invalid publicUrl')
      }

      const bucket = 'media-public'

      const uploadedObjectExists =
        cleaned && finalize.path
          ? await objectExists({ bucket, path: finalize.path }).catch(() => false)
          : null

      const finalUrl =
        cleaned && finalize.cacheBuster
          ? withCacheBuster(cleaned, finalize.cacheBuster)
          : cleaned

      await setViralRequestCoverImage(prisma, {
        requestId: finalize.requestId,
        coverImageUrl: finalUrl,
      })

      await writeAdminAuditLog({
        adminUserId: user.id,
        action: finalUrl
          ? 'VIRAL_REQUEST_COVER_IMAGE_UPDATED'
          : 'VIRAL_REQUEST_COVER_IMAGE_CLEARED',
        note: finalUrl
          ? 'Viral request cover image updated'
          : 'Viral request cover image cleared',
        targetType: 'other',
        targetId: finalize.requestId,
        metadata: {
          requestId: finalize.requestId,
          hasStoragePath: Boolean(finalize.path),
          uploadedObjectExists,
          cacheBusterProvided: finalize.cacheBuster !== undefined,
        },
      }).catch(() => null)

      return jsonOk({
        coverImageUrl: finalUrl,
      } satisfies MediaAdminViralCoverFinalizeDTO)
    }

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

      return jsonOk({
        defaultImageUrl: finalUrl,
      } satisfies MediaAdminUploadFinalizeDTO)
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

    if (init.kind === 'VIRAL_REQUEST_COVER_IMAGE_PUBLIC') {
      const viralAllowed = await requireViralReviewScope({
        adminUserId: user.id,
        requestId: init.requestId,
      })

      if (viralAllowed === null) return jsonFail(404, 'Viral request not found')
      if (!viralAllowed) return jsonFail(403, 'Forbidden')

      const viralBase = mustBaseUrl()
      const viralBucket = 'media-public'
      const viralExt = safeExtFromContentType(init.contentType)
      const viralCacheBuster = Date.now()
      // One object per request, overwritten on replace — a cover has no history
      // worth keeping. `upsert` below is what makes the second upload land.
      const viralPath = buildViralRequestCoverTargetPath({
        requestId: init.requestId,
        extension: viralExt,
      })

      const viralToken = await createSignedUploadUrl({
        bucket: viralBucket,
        path: viralPath,
      })

      if (!viralToken) {
        return jsonFail(500, 'Could not create upload URL')
      }

      return jsonOk({
        bucket: viralBucket,
        path: viralPath,
        token: viralToken,
        publicUrl: buildPublicUrl({
          base: viralBase,
          bucket: viralBucket,
          path: viralPath,
        }),
        cacheBuster: viralCacheBuster,
      } satisfies MediaAdminUploadInitDTO)
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
    } satisfies MediaAdminUploadInitDTO)
  } catch (error: unknown) {
    console.error('POST /api/v1/admin/uploads error', { error: safeError(error) })

    return jsonFail(
      500,
      errorMessageFromUnknown(error) || 'Internal server error',
    )
  }
}