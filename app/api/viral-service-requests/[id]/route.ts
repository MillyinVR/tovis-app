// app/api/viral-service-requests/[id]/route.ts
import { AdminPermissionRole, Role } from '@prisma/client'

import { jsonFail, jsonOk } from '@/app/api/_utils'
import { requireAdminPermission } from '@/app/api/_utils/auth/requireAdminPermission'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { prisma } from '@/lib/prisma'
import { viralRequestListSelect } from '@/lib/viralRequests'
import { toViralRequestDto } from '@/lib/viralRequests/contracts'

export const dynamic = 'force-dynamic'

type Params = { id: string }
type Ctx = { params: Params | Promise<Params> }

async function getParams(ctx: Ctx): Promise<Params> {
  return await Promise.resolve(ctx.params)
}

function pickRequestId(value: string): string | null {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const auth = await requireUser()
    if (!auth.ok) return auth.res

    const { id: rawId } = await getParams(ctx)
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
    console.error('GET /api/viral-service-requests/[id] error', error)
    return jsonFail(500, 'Couldn’t load viral request. Try again.', {
      code: 'INTERNAL',
    })
  }
}