// app/api/v1/viral-service-requests/[id]/route.ts
import { AdminPermissionRole, Role } from '@prisma/client'

import { jsonFail, jsonOk } from '@/app/api/_utils'
import { requireAdminPermission } from '@/app/api/_utils/auth/requireAdminPermission'
import { requireClient } from '@/app/api/_utils/auth/requireClient'
import { resolveRouteParams, type RouteContext } from '@/app/api/_utils/routeContext'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { isRecord } from '@/lib/guards'
import { prisma } from '@/lib/prisma'
import {
  attachClientViralRequestMedia,
  VIRAL_REQUEST_MEDIA_LIMIT,
  viralRequestListSelect,
} from '@/lib/viralRequests'
import { toViralRequestDto } from '@/lib/viralRequests/contracts'

export const dynamic = 'force-dynamic'

function pickRequestId(value: string): string | null {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export async function GET(_req: Request, ctx: RouteContext) {
  try {
    const auth = await requireUser()
    if (!auth.ok) return auth.res

    const { id: rawId } = await resolveRouteParams(ctx)
    const requestId = pickRequestId(rawId)

    if (!requestId) {
      return jsonFail(400, 'Missing viral request id.', {
        code: 'MISSING_VIRAL_REQUEST_ID',
      })
    }

    const request = await prisma.viralServiceRequest.findUnique({
      where: { id: requestId },
      select: viralRequestListSelect,
    })

    if (!request) {
      return jsonFail(404, 'Viral request not found.', {
        code: 'VIRAL_REQUEST_NOT_FOUND',
      })
    }

    const isAdmin = auth.user.role === Role.ADMIN
    const viewerClientId = auth.user.clientProfile?.id ?? null
    const isRequester = viewerClientId === request.clientId

    if (!isRequester && !isAdmin) {
      return jsonFail(403, 'Forbidden', {
        code: 'FORBIDDEN',
      })
    }

    if (isAdmin) {
      const permission = await requireAdminPermission({
        adminUserId: auth.user.id,
        allowedRoles: [
          AdminPermissionRole.SUPER_ADMIN,
          AdminPermissionRole.REVIEWER,
          AdminPermissionRole.SUPPORT,
        ],
        scope: request.requestedCategoryId
          ? { categoryId: request.requestedCategoryId }
          : undefined,
      })

      if (!permission.ok) return permission.res
    }

    return jsonOk({
      request: toViralRequestDto(request),
    })
  } catch (error) {
    console.error('GET /api/v1/viral-service-requests/[id] error', error)
    return jsonFail(500, 'Couldn’t load viral request. Try again.', {
      code: 'INTERNAL',
    })
  }
}

/**
 * The submitter records what they just uploaded: `{ mediaUrl }`.
 *
 * The third leg of the attach flow — create the request, POST
 * `…/viral-service-requests/upload` for a signed URL, PUT the bytes, then land
 * here. It exists because the signing route needs a request id and therefore
 * cannot run before create, so nothing was ever writing the URL back.
 *
 * 🔴 What arrives is EVIDENCE for the review queue, never a published picture:
 * only an admin sets a look's cover (`setViralRequestCoverImage`), and
 * `resolveViralCoverImage` reads nothing else. The URL is checked to be one this
 * server minted for this very request, so a reviewer's "Use this" can never
 * promote a stranger's server.
 */
export async function PATCH(req: Request, ctx: RouteContext) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const { id: rawId } = await resolveRouteParams(ctx)
    const requestId = pickRequestId(rawId)

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

    const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
    if (!base) return jsonFail(500, 'NEXT_PUBLIC_SUPABASE_URL missing')

    const result = await attachClientViralRequestMedia(prisma, {
      clientId: auth.clientId,
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
        case 'FORBIDDEN':
          return jsonFail(403, 'Forbidden', { code: 'FORBIDDEN' })
        case 'FINALIZED':
          return jsonFail(
            409,
            'Cannot attach media to a finalized viral request.',
            { code: 'VIRAL_REQUEST_FINALIZED' },
          )
        case 'MEDIA_LIMIT':
          return jsonFail(
            409,
            `A viral request can carry at most ${VIRAL_REQUEST_MEDIA_LIMIT} attachments.`,
            { code: 'VIRAL_REQUEST_MEDIA_LIMIT' },
          )
        case 'INVALID_MEDIA_URL':
        default:
          return jsonFail(
            400,
            'mediaUrl must be an upload this request created.',
            { code: 'INVALID_VIRAL_REQUEST_MEDIA_URL' },
          )
      }
    }

    return jsonOk({
      request: toViralRequestDto(result.request),
    })
  } catch (error) {
    console.error('PATCH /api/v1/viral-service-requests/[id] error', error)
    return jsonFail(500, 'Couldn’t attach your file. Try again.', {
      code: 'INTERNAL',
    })
  }
}
