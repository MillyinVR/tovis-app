// GET /api/v1/admin/viral-service-requests — the cross-tenant viral-look review
// queue, actionable rows first.
//
// The web page at /admin/viral-requests calls `listAdminViralRequests(prisma)`
// straight from its server component, so this queue had no API door at all;
// every OTHER admin moderation queue (looks, look comments, reviews) already
// had one. Native clients get the same rows through the same helper — the sort
// that floats REQUESTED/IN_REVIEW to the top lives in the helper, not here, so
// the two surfaces cannot drift into different queue orders.
//
// SUPER_ADMIN or REVIEWER: the same permission the page redirects on
// (`canReviewPros`) and the same one .../[id]/moderate enforces — a reviewer
// who could not action a row is not shown the queue either.
import { AdminPermissionRole, Role } from '@prisma/client'

import { jsonFail, jsonOk } from '@/app/api/_utils'
import { requireAdminPermission } from '@/app/api/_utils/auth/requireAdminPermission'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { prisma } from '@/lib/prisma'
import { listAdminViralRequests } from '@/lib/viralRequests'
import { toViralRequestDto } from '@/lib/viralRequests/contracts'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const auth = await requireUser({ roles: [Role.ADMIN] })
    if (!auth.ok) return auth.res

    const permission = await requireAdminPermission({
      adminUserId: auth.user.id,
      allowedRoles: [
        AdminPermissionRole.SUPER_ADMIN,
        AdminPermissionRole.REVIEWER,
      ],
    })
    if (!permission.ok) return permission.res

    const rows = await listAdminViralRequests(prisma)

    return jsonOk({ ok: true, items: rows.map(toViralRequestDto) })
  } catch (error) {
    console.error('GET /api/v1/admin/viral-service-requests error', error)
    return jsonFail(500, 'Internal server error')
  }
}
