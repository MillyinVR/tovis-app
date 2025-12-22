// lib/adminPermissions.ts
import { prisma } from '@/lib/prisma'
import { AdminPermissionRole } from '@prisma/client'

type Scope = {
  professionalId?: string | null
  serviceId?: string | null
  categoryId?: string | null
}

/**
 * Permission rules:
 * - SUPER_ADMIN always allows (if present for the user at all).
 * - A permission row matches a target if ALL non-null scope fields on the row match the target scope.
 * - A global row (all scope fields null) matches any scope.
 *
 * When scope is NOT provided:
 * - We interpret it as: "Does user have any permission row for these roles?"
 */
export async function hasAdminPermission(args: {
  adminUserId: string
  allowedRoles: AdminPermissionRole[]
  scope?: Scope
}) {
  const { adminUserId, allowedRoles, scope } = args

  const perms = await prisma.adminPermission.findMany({
    where: {
      adminUserId,
      role: { in: allowedRoles },
    },
    select: {
      role: true,
      professionalId: true,
      serviceId: true,
      categoryId: true,
    },
    take: 500,
  })

  if (perms.length === 0) return false

  // SUPER_ADMIN always wins
  if (perms.some((p) => p.role === 'SUPER_ADMIN')) return true

  // If no scope provided, any permission row for allowedRoles is enough
  if (!scope) return true

  const target = {
    professionalId: scope.professionalId ?? null,
    serviceId: scope.serviceId ?? null,
    categoryId: scope.categoryId ?? null,
  }

  return perms.some((p) => {
    // Global permission row matches anything
    const isGlobal = !p.professionalId && !p.serviceId && !p.categoryId
    if (isGlobal) return true

    // AND semantics: all non-null fields on the permission row must match target
    if (p.professionalId && p.professionalId !== target.professionalId) return false
    if (p.serviceId && p.serviceId !== target.serviceId) return false
    if (p.categoryId && p.categoryId !== target.categoryId) return false

    return true
  })
}

export function forbidden() {
  return new Response(JSON.stringify({ error: 'Forbidden' }), {
    status: 403,
    headers: { 'content-type': 'application/json' },
  })
}
