// GET /api/v1/admin/looks/velocity-anomalies — §5.6 anti-gaming review queue.
// Surfaces looks whose recent engagement outruns its matching impressions or
// spikes far above the look's own historical pattern, across ALL tenants, so a
// human can review the pro. Read-only triage — nothing here penalizes anyone
// (impressions are best-effort sampled; a flag is a lead, not a verdict).
// SUPER_ADMIN or REVIEWER, like the rest of the Looks moderation surface.
import { AdminPermissionRole, Role } from '@prisma/client'

import { jsonFail, jsonOk } from '@/app/api/_utils'
import { requireAdminPermission } from '@/app/api/_utils/auth/requireAdminPermission'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { detectLookVelocityAnomalies } from '@/lib/looks/velocityAnomaly'
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
    const result = await detectLookVelocityAnomalies(prisma, {
      now: new Date(),
      windowDays: parsePositiveInt(params.get('windowDays')),
      limit: parsePositiveInt(params.get('limit')),
    })

    return jsonOk({ ok: true, ...result })
  } catch (error) {
    console.error('GET /api/v1/admin/looks/velocity-anomalies error', error)
    return jsonFail(500, 'Internal server error')
  }
}
