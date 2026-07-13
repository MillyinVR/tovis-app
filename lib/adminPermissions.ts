// lib/adminPermissions.ts
import { prisma } from '@/lib/prisma'
import { AdminPermissionRole, type PrismaClient } from '@prisma/client'

type Scope = {
  professionalId?: string | null
  serviceId?: string | null
  categoryId?: string | null
}

/**
 * Minimal client surface `ensureGlobalSuperAdminPermission` needs. Satisfied by
 * both the shared `prisma` singleton and a script-owned `new PrismaClient()`,
 * so ops scripts that manage their own connection can pass their client.
 */
type AdminPermissionDb = Pick<PrismaClient, 'adminPermission'>

/**
 * Idempotently ensure `adminUserId` holds a GLOBAL super-admin grant — an
 * AdminPermission row scoped to nothing, which hasAdminPermission treats as
 * "always allows". Returns whether a new row was created.
 *
 * Deliberately does NOT touch `User.role`: the home role is the caller's
 * decision. This lets a non-ADMIN home role (e.g. a pro who is also a super
 * admin) hold the grant and switch into the Admin workspace via canActAs,
 * without giving up their home workspace.
 */
export async function ensureGlobalSuperAdminPermission(
  db: AdminPermissionDb,
  adminUserId: string,
): Promise<{ created: boolean }> {
  const existing = await db.adminPermission.findFirst({
    where: {
      adminUserId,
      role: AdminPermissionRole.SUPER_ADMIN,
      professionalId: null,
      serviceId: null,
      categoryId: null,
    },
    select: { id: true },
  })
  if (existing) return { created: false }

  await db.adminPermission.create({
    data: {
      adminUserId,
      role: AdminPermissionRole.SUPER_ADMIN,
      professionalId: null,
      serviceId: null,
      categoryId: null,
    },
  })
  return { created: true }
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
