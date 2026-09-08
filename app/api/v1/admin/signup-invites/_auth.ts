import { AdminPermissionRole, Role } from '@prisma/client'

import { jsonFail } from '@/app/api/_utils/responses'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { hasAdminPermission } from '@/lib/adminPermissions'

export async function requireSignupInviteAdmin() {
  const auth = await requireUser({ roles: [Role.ADMIN] })
  if (!auth.ok) return auth

  const allowed = await hasAdminPermission({
    adminUserId: auth.user.id,
    allowedRoles: [AdminPermissionRole.SUPER_ADMIN],
  })

  return allowed
    ? auth
    : { ok: false as const, res: jsonFail(403, 'Forbidden') }
}
