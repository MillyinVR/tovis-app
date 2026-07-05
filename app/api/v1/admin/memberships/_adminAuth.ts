// Shared SUPER_ADMIN gate for the per-pro membership admin routes
// (/api/v1/admin/memberships/[professionalId]/*). Page gates on Role.ADMIN; the
// API requires SUPER_ADMIN scoped to the target pro, and confirms the pro exists.
import { AdminPermissionRole, Role } from '@prisma/client'

import { jsonFail } from '@/app/api/_utils'
import { requireAdminPermission } from '@/app/api/_utils/auth/requireAdminPermission'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import { prisma } from '@/lib/prisma'

export type MembershipAdminRouteContext = RouteContext<{ professionalId: string }>

export type MembershipAdminAuth =
  | { ok: true; adminUserId: string; professionalId: string }
  | { ok: false; res: Response }

export async function requireMembershipAdmin(
  ctx: MembershipAdminRouteContext,
): Promise<MembershipAdminAuth> {
  const auth = await requireUser({ roles: [Role.ADMIN] })
  if (!auth.ok) return { ok: false, res: auth.res }

  const { professionalId: rawId } = await resolveRouteParams(ctx)
  const professionalId = typeof rawId === 'string' ? rawId.trim() : ''
  if (!professionalId) {
    return { ok: false, res: jsonFail(400, 'Missing professional id.') }
  }

  const permission = await requireAdminPermission({
    adminUserId: auth.user.id,
    allowedRoles: [AdminPermissionRole.SUPER_ADMIN],
    scope: { professionalId },
  })
  if (!permission.ok) return { ok: false, res: permission.res }

  const pro = await prisma.professionalProfile.findUnique({
    where: { id: professionalId },
    select: { id: true },
  })
  if (!pro) {
    return { ok: false, res: jsonFail(404, 'Professional not found.') }
  }

  return { ok: true, adminUserId: auth.user.id, professionalId }
}
