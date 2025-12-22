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

export async function getAdminUiPerms(): Promise<{ userId: string; email: string; perms: AdminUiPerms } | null> {
  const user = await getCurrentUser().catch(() => null)
  if (!user || user.role !== 'ADMIN') return null

  const [canReviewPros, canManageCatalog, canManagePermissions] = await Promise.all([
    hasAdminPermission({
      adminUserId: user.id,
      allowedRoles: [AdminPermissionRole.SUPER_ADMIN, AdminPermissionRole.REVIEWER],
    }),
    hasAdminPermission({
      adminUserId: user.id,
      allowedRoles: [AdminPermissionRole.SUPER_ADMIN, AdminPermissionRole.SUPPORT],
    }),
    hasAdminPermission({
      adminUserId: user.id,
      allowedRoles: [AdminPermissionRole.SUPER_ADMIN],
    }),
  ])

  // Logs: keep it SUPER_ADMIN-only for now (you can relax later)
  const canViewLogs = canManagePermissions

  return {
    userId: user.id,
    email: user.email,
    perms: {
      canReviewPros,
      canManageCatalog,
      canManagePermissions,
      canViewLogs,
    },
  }
}
