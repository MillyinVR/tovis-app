// PUT    /api/v1/admin/reviews/[reviewId]/hidden — hide a review (soft-moderation)
// DELETE /api/v1/admin/reviews/[reviewId]/hidden — unhide it
//
// SUPER_ADMIN only. Hide keeps the row but removes the review from every
// public/pro list and rating aggregate (lib/reviews/visibility). Repeat
// actions are no-ops; every state change lands in the admin audit log.
import { jsonFail, jsonOk } from '@/app/api/_utils'
import { pickString } from '@/app/api/_utils/pick'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import { writeAdminAuditLog } from '@/lib/admin/auditLog'
import {
  hideReviewByAdmin,
  unhideReviewByAdmin,
} from '@/lib/adminModeration/reviews'
import {
  requireReviewAdmin,
  type ReviewAdminRouteContext,
} from '../_utils/requireReviewAdmin'

export const dynamic = 'force-dynamic'

const MAX_REASON_LENGTH = 500

export async function PUT(req: Request, ctx: ReviewAdminRouteContext) {
  try {
    const auth = await requireReviewAdmin(ctx)
    if (!auth.ok) return auth.res

    const body = await readJsonRecord(req)
    const reason = pickString(body.reason)?.slice(0, MAX_REASON_LENGTH) ?? null

    const result = await hideReviewByAdmin({
      reviewId: auth.reviewId,
      adminUserId: auth.adminUserId,
      reason,
    })

    if (!result.found) return jsonFail(404, 'Review not found.')

    if (!result.alreadyHidden) {
      await writeAdminAuditLog({
        adminUserId: auth.adminUserId,
        action: 'review_hide',
        professionalId: result.professionalId,
        targetType: 'review',
        targetId: auth.reviewId,
        note: reason,
        newValue: { hiddenAt: result.hiddenAt.toISOString() },
      })
    }

    return jsonOk({ ok: true, hidden: true })
  } catch (error) {
    console.error('PUT /api/v1/admin/reviews/[reviewId]/hidden error', error)
    return jsonFail(500, 'Internal server error')
  }
}

export async function DELETE(_req: Request, ctx: ReviewAdminRouteContext) {
  try {
    const auth = await requireReviewAdmin(ctx)
    if (!auth.ok) return auth.res

    const result = await unhideReviewByAdmin({ reviewId: auth.reviewId })

    if (!result.found) return jsonFail(404, 'Review not found.')

    if (result.wasHidden) {
      await writeAdminAuditLog({
        adminUserId: auth.adminUserId,
        action: 'review_unhide',
        professionalId: result.professionalId,
        targetType: 'review',
        targetId: auth.reviewId,
      })
    }

    return jsonOk({ ok: true, hidden: false })
  } catch (error) {
    console.error('DELETE /api/v1/admin/reviews/[reviewId]/hidden error', error)
    return jsonFail(500, 'Internal server error')
  }
}
