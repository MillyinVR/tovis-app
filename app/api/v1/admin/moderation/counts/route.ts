// GET /api/v1/admin/moderation/counts — how much is waiting in each moderation
// queue, in one round trip.
//
// Exists for the native admin inbox, which opens on a list of queues and has to
// show what needs attention BEFORE the admin picks one. The web admin never
// needed it: /admin is a static grid of link cards that never says what is
// waiting. Fetching three full lists just to read their lengths would move
// megabytes of media URLs and PII to render three numbers, so this route counts
// in the database and returns only the numbers — no row data crosses.
//
// SUPER_ADMIN only: the numbers summarise exactly the queues GET /admin/looks
// and GET /admin/look-comments serve, and both of those are SUPER_ADMIN. A
// count is a disclosure — "how many looks were reported platform-wide" is not
// something to hand to a narrower admin role the lists themselves refuse.
//
// ⚠️ Reviews are deliberately ABSENT. There is no Review report model (reports
// exist for LookPost, LookComment and ViralServiceRequest only), so reviews are
// a browse-and-hide surface with no pending state to count.
import { AdminPermissionRole, Role } from '@prisma/client'

import { jsonFail, jsonOk } from '@/app/api/_utils'
import { requireAdminPermission } from '@/app/api/_utils/auth/requireAdminPermission'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { prisma } from '@/lib/prisma'
import {
  countAdminLookCommentModeration,
  countAdminLookModeration,
} from '@/lib/privacy/adminLookModeration'
import type { AdminModerationCountsDTO } from '@/lib/dto/adminModeration'
import { countAdminViralRequestsAwaitingReview } from '@/lib/viralRequests'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const auth = await requireUser({ roles: [Role.ADMIN] })
    if (!auth.ok) return auth.res

    const permission = await requireAdminPermission({
      adminUserId: auth.user.id,
      allowedRoles: [AdminPermissionRole.SUPER_ADMIN],
    })
    if (!permission.ok) return permission.res

    const [reportedLooks, pendingLooks, reportedComments, viralAwaitingReview] =
      await Promise.all([
        countAdminLookModeration({ status: 'REPORTED' }),
        countAdminLookModeration({ status: 'PENDING' }),
        countAdminLookCommentModeration({ status: 'REPORTED' }),
        countAdminViralRequestsAwaitingReview(prisma),
      ])

    const counts: AdminModerationCountsDTO = {
      reportedLooks,
      pendingLooks,
      reportedComments,
      viralAwaitingReview,
    }

    return jsonOk({ ok: true, counts })
  } catch (error) {
    console.error('GET /api/v1/admin/moderation/counts error', error)
    return jsonFail(500, 'Internal server error')
  }
}
