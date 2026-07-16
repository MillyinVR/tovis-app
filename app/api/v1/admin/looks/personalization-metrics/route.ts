// GET /api/v1/admin/looks/personalization-metrics — §9 personalization funnel +
// health rollup. Platform-wide, read-only: save→book conversion, saved-not-booked
// gap, board→booking, hide-rate, per-trigger notification opt-out, and lifetime
// rebook rate — recomputed from tables (no serve-log dependency). SUPER_ADMIN or
// REVIEWER, like the rest of the Looks observability surface.
import { AdminPermissionRole, Role } from '@prisma/client'

import { jsonFail, jsonOk } from '@/app/api/_utils'
import { requireAdminPermission } from '@/app/api/_utils/auth/requireAdminPermission'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { computePersonalizationMetrics } from '@/lib/looks/personalizationMetrics'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

function parsePositiveInt(raw: string | null): number | undefined {
  if (raw === null) return undefined
  const value = Number.parseInt(raw, 10)
  return Number.isFinite(value) && value > 0 ? value : undefined
}

export async function GET(req: Request) {
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

    const params = new URL(req.url).searchParams
    const metrics = await computePersonalizationMetrics(prisma, {
      now: new Date(),
      windowDays: parsePositiveInt(params.get('windowDays')),
    })

    return jsonOk({ ok: true, ...metrics })
  } catch (error) {
    console.error(
      'GET /api/v1/admin/looks/personalization-metrics error',
      error,
    )
    return jsonFail(500, 'Internal server error')
  }
}
