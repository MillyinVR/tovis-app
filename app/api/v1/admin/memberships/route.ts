// GET /api/v1/admin/memberships?q= — search pros and report their membership
// state (paid plan/status, active comp, effective plan) for the admin
// memberships dashboard. SUPER_ADMIN only: memberships are money-adjacent.
// The PII-touching search lives in lib/privacy/adminMembershipDirectory.
import { AdminPermissionRole, Role } from '@prisma/client'

import { jsonFail, jsonOk } from '@/app/api/_utils'
import { requireAdminPermission } from '@/app/api/_utils/auth/requireAdminPermission'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { searchAdminMembershipDirectory } from '@/lib/privacy/adminMembershipDirectory'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const auth = await requireUser({ roles: [Role.ADMIN] })
    if (!auth.ok) return auth.res

    const permission = await requireAdminPermission({
      adminUserId: auth.user.id,
      allowedRoles: [AdminPermissionRole.SUPER_ADMIN],
    })
    if (!permission.ok) return permission.res

    const q = new URL(req.url).searchParams.get('q') ?? ''
    const items = await searchAdminMembershipDirectory(q)

    return jsonOk({ ok: true, items })
  } catch (error) {
    console.error('GET /api/v1/admin/memberships error', error)
    return jsonFail(500, 'Internal server error')
  }
}
