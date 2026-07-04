// POST /api/v1/admin/look-comments/[id]/dismiss-reports — mark every unresolved
// report on a comment as reviewed/dismissed (keeps the comment live).
// SUPER_ADMIN only. No-op when there's nothing unresolved; real dismissals audited.
import { jsonFail, jsonOk } from '@/app/api/_utils'
import { writeAdminAuditLog } from '@/lib/admin/auditLog'
import { dismissLookCommentReports } from '@/lib/adminModeration/lookReports'
import { prisma } from '@/lib/prisma'
import {
  requireLookCommentAdmin,
  type LookCommentAdminRouteContext,
} from '../_utils/requireLookCommentAdmin'

export const dynamic = 'force-dynamic'

export async function POST(_req: Request, ctx: LookCommentAdminRouteContext) {
  try {
    const auth = await requireLookCommentAdmin(ctx)
    if (!auth.ok) return auth.res

    const result = await dismissLookCommentReports(prisma, {
      lookCommentId: auth.lookCommentId,
      adminUserId: auth.adminUserId,
    })

    if (!result.found) return jsonFail(404, 'Look comment not found.')

    if (result.dismissedCount > 0) {
      await writeAdminAuditLog({
        adminUserId: auth.adminUserId,
        action: 'LOOK_COMMENT_REPORTS_DISMISSED',
        professionalId: result.professionalId,
        serviceId: result.serviceId,
        targetType: 'lookComment',
        targetId: auth.lookCommentId,
        newValue: { dismissedCount: result.dismissedCount },
      })
    }

    return jsonOk({ ok: true, dismissedCount: result.dismissedCount })
  } catch (error) {
    console.error(
      'POST /api/v1/admin/look-comments/[id]/dismiss-reports error',
      error,
    )
    return jsonFail(500, 'Internal server error')
  }
}
