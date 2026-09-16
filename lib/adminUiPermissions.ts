// lib/adminUiPermissions.ts
import { getCurrentUser } from '@/lib/currentUser'
import { hasAdminPermission } from '@/lib/adminPermissions'
import { AdminPermissionRole } from '@prisma/client'

export type AdminUiPerms = {
  canReviewPros: boolean
  canManageCatalog: boolean
  canManagePermissions: boolean
  canViewLogs: boolean
}

/**
 * The permission map for ONE admin, keyed only by their user id.
 *
 * Split out of `getAdminUiPerms` so the API door (`GET /api/v1/admin/me`, which
 * native clients read to decide which admin surfaces to render) and the server
 * components share one definition of what each admin role unlocks. A second
 * copy of this mapping is exactly how a native client ends up offering a screen
 * the endpoint behind it refuses.
 */
export async function getAdminUiPermsForUser(
  adminUserId: string,
): Promise<AdminUiPerms> {
  const [canReviewPros, canManageCatalog, canManagePermissions] =
    await Promise.all([
      hasAdminPermission({
        adminUserId,
        allowedRoles: [
          AdminPermissionRole.SUPER_ADMIN,
          AdminPermissionRole.REVIEWER,
        ],
      }),
      hasAdminPermission({
        adminUserId,
        allowedRoles: [
          AdminPermissionRole.SUPER_ADMIN,
          AdminPermissionRole.SUPPORT,
        ],
      }),
      hasAdminPermission({
        adminUserId,
        allowedRoles: [AdminPermissionRole.SUPER_ADMIN],
      }),
    ])

  return {
    canReviewPros,
    canManageCatalog,
    canManagePermissions,
    canViewLogs: canManagePermissions,
  }
}

export async function getAdminUiPerms(): Promise<{
  userId: string
  email: string | null
  perms: AdminUiPerms
} | null> {
  const user = await getCurrentUser().catch(() => null)
  if (!user || user.role !== 'ADMIN') return null

  return {
    userId: user.id,
    email: user.email,
    perms: await getAdminUiPermsForUser(user.id),
  }
}
