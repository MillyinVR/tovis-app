// Shared SUPER_ADMIN gate for the per-review moderation routes. Mirrors
// requireMembershipAdmin on the memberships comp route: coarse Role.ADMIN
// first, then a SUPER_ADMIN permission check scoped to the reviewed pro
// (SUPER_ADMIN always passes; the scope keeps the door open for future
// scoped admin roles).
import { AdminPermissionRole, Role } from '@prisma/client'

import { jsonFail } from '@/app/api/_utils'
import { requireAdminPermission } from '@/app/api/_utils/auth/requireAdminPermission'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import { prisma } from '@/lib/prisma'

export type ReviewAdminRouteContext = RouteContext<{ reviewId: string }>

export type ReviewAdminAuth =
  | { ok: true; adminUserId: string; reviewId: string }
  | { ok: false; res: Response }

export async function requireReviewAdmin(
  ctx: ReviewAdminRouteContext,
): Promise<ReviewAdminAuth> {
  const auth = await requireUser({ roles: [Role.ADMIN] })
  if (!auth.ok) return { ok: false, res: auth.res }

  const { reviewId: rawId } = await resolveRouteParams(ctx)
  const reviewId = typeof rawId === 'string' ? rawId.trim() : ''
  if (!reviewId) {
    return { ok: false, res: jsonFail(400, 'Missing review id.') }
  }

  const review = await prisma.review.findUnique({
    where: { id: reviewId },
    select: { id: true, professionalId: true },
  })
  if (!review) {
    return { ok: false, res: jsonFail(404, 'Review not found.') }
  }

  const permission = await requireAdminPermission({
    adminUserId: auth.user.id,
    allowedRoles: [AdminPermissionRole.SUPER_ADMIN],
    scope: { professionalId: review.professionalId },
  })
  if (!permission.ok) return { ok: false, res: permission.res }

  return { ok: true, adminUserId: auth.user.id, reviewId }
}
