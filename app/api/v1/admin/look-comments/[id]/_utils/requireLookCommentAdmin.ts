// Shared SUPER_ADMIN gate for the per-comment moderation action routes
// (dismiss-reports). Mirrors requireLookAdmin, resolving the scope through the
// comment's parent look. The existing .../moderate route additionally allows
// the REVIEWER role; report dismissal stays SUPER_ADMIN.
import { AdminPermissionRole, Role } from '@prisma/client'

import { jsonFail } from '@/app/api/_utils'
import { requireAdminPermission } from '@/app/api/_utils/auth/requireAdminPermission'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import { prisma } from '@/lib/prisma'

export type LookCommentAdminRouteContext = RouteContext<{ id: string }>

export type LookCommentAdminAuth =
  | { ok: true; adminUserId: string; lookCommentId: string }
  | { ok: false; res: Response }

export async function requireLookCommentAdmin(
  ctx: LookCommentAdminRouteContext,
): Promise<LookCommentAdminAuth> {
  const auth = await requireUser({ roles: [Role.ADMIN] })
  if (!auth.ok) return { ok: false, res: auth.res }

  const { id: rawId } = await resolveRouteParams(ctx)
  const lookCommentId = typeof rawId === 'string' ? rawId.trim() : ''
  if (!lookCommentId) {
    return { ok: false, res: jsonFail(400, 'Missing look comment id.') }
  }

  const comment = await prisma.lookComment.findUnique({
    where: { id: lookCommentId },
    select: {
      id: true,
      lookPost: {
        select: {
          professionalId: true,
          serviceId: true,
          service: { select: { categoryId: true } },
        },
      },
    },
  })
  if (!comment) {
    return { ok: false, res: jsonFail(404, 'Look comment not found.') }
  }

  const { professionalId, serviceId, service } = comment.lookPost
  const permission = await requireAdminPermission({
    adminUserId: auth.user.id,
    allowedRoles: [AdminPermissionRole.SUPER_ADMIN],
    scope: {
      professionalId,
      ...(serviceId ? { serviceId } : {}),
      ...(service?.categoryId ? { categoryId: service.categoryId } : {}),
    },
  })
  if (!permission.ok) return { ok: false, res: permission.res }

  return { ok: true, adminUserId: auth.user.id, lookCommentId }
}
