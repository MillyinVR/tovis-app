// app/api/_utils/requireAdminPermission.ts
import { NextResponse } from 'next/server'
import type { AdminPermissionRole } from '@prisma/client'
import { hasAdminPermission } from '@/lib/adminPermissions'

type Scope = {
  professionalId?: string
  serviceId?: string
  categoryId?: string
}

export async function requireAdminPermission(args: {
  adminUserId: string
  allowedRoles: AdminPermissionRole[]
  scope?: Scope
}) {
  const ok = await hasAdminPermission({
    adminUserId: args.adminUserId,
    allowedRoles: args.allowedRoles,
    scope: args.scope,
  })

  if (!ok) {
    return { ok: false, res: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  return { ok: true, res: null as any }
}
