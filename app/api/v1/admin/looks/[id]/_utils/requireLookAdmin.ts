// Shared SUPER_ADMIN gate for the per-look moderation action routes
// (dismiss-reports, feature). Mirrors requireReviewAdmin: coarse Role.ADMIN
// first, then a SUPER_ADMIN permission check scoped to the look's pro/service/
// category (SUPER_ADMIN always passes; the scope keeps the door open for future
// scoped admin roles). The existing .../moderate route additionally allows the
// REVIEWER role; these higher-trust curation/report actions stay SUPER_ADMIN.
import { AdminPermissionRole, Role } from '@prisma/client'

import { jsonFail } from '@/app/api/_utils'
import { requireAdminPermission } from '@/app/api/_utils/auth/requireAdminPermission'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import { prisma } from '@/lib/prisma'

export type LookAdminRouteContext = RouteContext<{ id: string }>

export type LookAdminAuth =
  | { ok: true; adminUserId: string; lookPostId: string }
  | { ok: false; res: Response }

export async function requireLookAdmin(
  ctx: LookAdminRouteContext,
): Promise<LookAdminAuth> {
  const auth = await requireUser({ roles: [Role.ADMIN] })
  if (!auth.ok) return { ok: false, res: auth.res }

  const { id: rawId } = await resolveRouteParams(ctx)
  const lookPostId = typeof rawId === 'string' ? rawId.trim() : ''
  if (!lookPostId) {
    return { ok: false, res: jsonFail(400, 'Missing look id.') }
  }

  const look = await prisma.lookPost.findUnique({
    where: { id: lookPostId },
    select: {
      id: true,
      professionalId: true,
      serviceId: true,
      service: { select: { categoryId: true } },
    },
  })
  if (!look) {
    return { ok: false, res: jsonFail(404, 'Look post not found.') }
  }

  const permission = await requireAdminPermission({
    adminUserId: auth.user.id,
    allowedRoles: [AdminPermissionRole.SUPER_ADMIN],
    scope: {
      professionalId: look.professionalId,
      ...(look.serviceId ? { serviceId: look.serviceId } : {}),
      ...(look.service?.categoryId
        ? { categoryId: look.service.categoryId }
        : {}),
    },
  })
  if (!permission.ok) return { ok: false, res: permission.res }

  return { ok: true, adminUserId: auth.user.id, lookPostId }
}
