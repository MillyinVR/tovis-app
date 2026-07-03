// DELETE /api/v1/admin/reviews/[reviewId]/reply — remove an abusive pro reply.
//
// SUPER_ADMIN only. Admin-authorized, cross-tenant counterpart of the pro's
// own DELETE /api/v1/pro/reviews/[id]/reply: clears the same two columns
// (proReplyBody/proReplyAt) without the ownership constraint. Audit-logged
// when a reply was actually removed.
import { jsonFail, jsonOk } from '@/app/api/_utils'
import { writeAdminAuditLog } from '@/lib/admin/auditLog'
import { clearReviewProReplyByAdmin } from '@/lib/adminModeration/reviews'
import {
  requireReviewAdmin,
  type ReviewAdminRouteContext,
} from '../_utils/requireReviewAdmin'

export const dynamic = 'force-dynamic'

export async function DELETE(_req: Request, ctx: ReviewAdminRouteContext) {
  try {
    const auth = await requireReviewAdmin(ctx)
    if (!auth.ok) return auth.res

    const result = await clearReviewProReplyByAdmin({
      reviewId: auth.reviewId,
    })

    if (!result.found) return jsonFail(404, 'Review not found.')

    if (result.hadReply) {
      await writeAdminAuditLog({
        adminUserId: auth.adminUserId,
        action: 'review_pro_reply_remove',
        professionalId: result.professionalId,
        targetType: 'review',
        targetId: auth.reviewId,
      })
    }

    return jsonOk({ ok: true, hadReply: result.hadReply })
  } catch (error) {
    console.error('DELETE /api/v1/admin/reviews/[reviewId]/reply error', error)
    return jsonFail(500, 'Internal server error')
  }
}
