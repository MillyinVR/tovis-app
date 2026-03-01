// app/api/_utils/auth/requireAdminPermission.ts
import type { AdminPermissionRole } from '@prisma/client'
import { hasAdminPermission } from '@/lib/adminPermissions'
import { jsonFail } from '@/app/api/_utils'

type Scope = {
  professionalId?: string
  serviceId?: string
  categoryId?: string
}

export type RequireAdminPermissionOk = { ok: true }

export type RequireAdminPermissionFail = {
  ok: false
  res: Response
}

export type RequireAdminPermissionResult = RequireAdminPermissionOk | RequireAdminPermissionFail

export async function requireAdminPermission(args: {
  adminUserId: string
  allowedRoles: readonly AdminPermissionRole[]
  scope?: Scope
}): Promise<RequireAdminPermissionResult> {
  const allowed = await hasAdminPermission({
    adminUserId: args.adminUserId,
    allowedRoles: [...args.allowedRoles],
    scope: args.scope,
  })

  if (!allowed) {
    // ✅ single source of truth for envelope + error message
    return { ok: false, res: jsonFail(403, 'Forbidden') }
  }

  return { ok: true }
}