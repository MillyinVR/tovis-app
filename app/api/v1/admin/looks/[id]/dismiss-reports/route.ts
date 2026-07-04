// POST /api/v1/admin/looks/[id]/dismiss-reports — mark every unresolved report
// on a look as reviewed/dismissed (keeps the look live). SUPER_ADMIN only.
// No-op when there's nothing unresolved; every real dismissal is audited.
import { jsonFail, jsonOk } from '@/app/api/_utils'
import { writeAdminAuditLog } from '@/lib/admin/auditLog'
import { dismissLookPostReports } from '@/lib/adminModeration/lookReports'
import { prisma } from '@/lib/prisma'
import {
  requireLookAdmin,
  type LookAdminRouteContext,
} from '../_utils/requireLookAdmin'

export const dynamic = 'force-dynamic'

export async function POST(_req: Request, ctx: LookAdminRouteContext) {
  try {
    const auth = await requireLookAdmin(ctx)
    if (!auth.ok) return auth.res

    const result = await dismissLookPostReports(prisma, {
      lookPostId: auth.lookPostId,
      adminUserId: auth.adminUserId,
    })

    if (!result.found) return jsonFail(404, 'Look post not found.')

    if (result.dismissedCount > 0) {
      await writeAdminAuditLog({
        adminUserId: auth.adminUserId,
        action: 'LOOK_POST_REPORTS_DISMISSED',
        professionalId: result.professionalId,
        serviceId: result.serviceId,
        targetType: 'lookPost',
        targetId: auth.lookPostId,
        newValue: { dismissedCount: result.dismissedCount },
      })
    }

    return jsonOk({ ok: true, dismissedCount: result.dismissedCount })
  } catch (error) {
    console.error(
      'POST /api/v1/admin/looks/[id]/dismiss-reports error',
      error,
    )
    return jsonFail(500, 'Internal server error')
  }
}
