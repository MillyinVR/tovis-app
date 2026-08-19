// app/api/v1/admin/viral-service-requests/[id]/media/route.ts
//
// A reviewer takes down one of the submitter's attachments.
//
// WHY THIS EXISTS. Rejecting a viral request stopped FURTHER attachments but did
// nothing about the ones already on it: the URLs stayed on the row and the bytes
// stayed in a PUBLIC bucket, with no affordance anywhere to remove either. A
// submission can carry someone else's photograph, or something that should not
// be reachable at all, and "we rejected it" was not the same as "it is gone".
//
// Admin-only, at the same bar as promoting a cover (SUPER_ADMIN or REVIEWER,
// scoped to the request's category) — this is the destructive twin of that
// action, so it cannot be the softer of the two. SUPPORT can READ the queue and
// deliberately cannot delete from it.
import { AdminPermissionRole, Role } from '@prisma/client'

import { jsonFail, jsonOk } from '@/app/api/_utils'
import { requireAdminPermission } from '@/app/api/_utils/auth/requireAdminPermission'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { resolveRouteParams, type RouteContext } from '@/app/api/_utils/routeContext'
import { writeAdminAuditLog } from '@/lib/admin/auditLog'
import { isRecord } from '@/lib/guards'
import { prisma } from '@/lib/prisma'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import { BUCKETS } from '@/lib/storageBuckets'
import { removeViralRequestMedia } from '@/lib/viralRequests'
import { toViralRequestDto } from '@/lib/viralRequests/contracts'

export const dynamic = 'force-dynamic'

export async function DELETE(req: Request, ctx: RouteContext) {
  try {
    const auth = await requireUser({ roles: [Role.ADMIN] })
    if (!auth.ok) return auth.res

    const { id: rawId } = await resolveRouteParams(ctx)
    const requestId = rawId.trim()

    if (!requestId) {
      return jsonFail(400, 'Missing viral request id.', {
        code: 'MISSING_VIRAL_REQUEST_ID',
      })
    }

    const contentType = req.headers.get('content-type') ?? ''
    if (!contentType.includes('application/json')) {
      return jsonFail(415, 'Content-Type must be application/json.', {
        code: 'UNSUPPORTED_MEDIA_TYPE',
      })
    }

    const raw: unknown = await req.json().catch(() => null)
    const body = isRecord(raw) ? raw : {}
    const mediaUrl = typeof body.mediaUrl === 'string' ? body.mediaUrl.trim() : ''

    if (!mediaUrl) {
      return jsonFail(400, 'Missing mediaUrl.', { code: 'MISSING_MEDIA_URL' })
    }

    // Read the row before the permission check: the scope is the request's own
    // category, so there is nothing to check against until it is known. A
    // missing request is a 404 for everyone, which leaks nothing an admin
    // session could not already ask the GET route.
    const existing = await prisma.viralServiceRequest.findUnique({
      where: { id: requestId },
      select: { id: true, requestedCategoryId: true },
    })

    if (!existing) {
      return jsonFail(404, 'Viral request not found.', {
        code: 'VIRAL_REQUEST_NOT_FOUND',
      })
    }

    const permission = await requireAdminPermission({
      adminUserId: auth.user.id,
      allowedRoles: [
        AdminPermissionRole.SUPER_ADMIN,
        AdminPermissionRole.REVIEWER,
      ],
      scope: existing.requestedCategoryId
        ? { categoryId: existing.requestedCategoryId }
        : undefined,
    })

    if (!permission.ok) return permission.res

    const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
    if (!base) return jsonFail(500, 'NEXT_PUBLIC_SUPABASE_URL missing')

    const result = await removeViralRequestMedia(prisma, {
      requestId,
      mediaUrl,
      supabaseBaseUrl: base,
    })

    if (!result.ok) {
      switch (result.reason) {
        case 'NOT_FOUND':
          return jsonFail(404, 'Viral request not found.', {
            code: 'VIRAL_REQUEST_NOT_FOUND',
          })
        case 'MEDIA_NOT_ATTACHED':
          return jsonFail(404, 'That attachment is not on this request.', {
            code: 'VIRAL_REQUEST_MEDIA_NOT_ATTACHED',
          })
        case 'INVALID_MEDIA_URL':
        default:
          return jsonFail(
            400,
            'mediaUrl must be an upload this request created.',
            { code: 'INVALID_VIRAL_REQUEST_MEDIA_URL' },
          )
      }
    }

    // 🔴 Storage delete runs AFTER the row is clean, and its failure does not
    // fail the request. The two orders are not equally bad: an orphaned object
    // nothing points at is invisible, while bytes deleted out from under a row
    // that still references them is a broken image on a live surface. The
    // reviewer's intent — take it out of the queue — has already succeeded by
    // the time we get here.
    let storageRemoved = true
    try {
      const { error } = await getSupabaseAdmin()
        .storage.from(BUCKETS.mediaPublic)
        .remove([result.storagePath])

      if (error) throw error
    } catch (error) {
      storageRemoved = false
      console.error(
        'DELETE /api/v1/admin/viral-service-requests/[id]/media storage remove failed',
        error,
      )
    }

    await writeAdminAuditLog({
      adminUserId: auth.user.id,
      action: 'VIRAL_REQUEST_MEDIA_REMOVED',
      note: result.clearedCover
        ? 'Submitter attachment removed; it was the cover, so the cover was cleared'
        : 'Submitter attachment removed',
      targetType: 'other',
      targetId: requestId,
      metadata: {
        requestId,
        storagePath: result.storagePath,
        clearedCover: result.clearedCover,
        storageRemoved,
      },
    }).catch(() => null)

    return jsonOk({
      request: toViralRequestDto(result.request),
      clearedCover: result.clearedCover,
      storageRemoved,
    })
  } catch (error) {
    console.error(
      'DELETE /api/v1/admin/viral-service-requests/[id]/media error',
      error,
    )
    return jsonFail(500, 'Couldn’t remove the attachment. Try again.', {
      code: 'INTERNAL',
    })
  }
}
