// lib/dto/adminModeration.ts
//
// Wire shapes for the admin moderation surfaces a NATIVE client renders.
//
// Admin was a web-only surface until iOS grew a moderation inbox, which is why
// the DTO barrel used to exclude "internal-only contracts (admin moderation)".
// Once a Swift build decodes these, they are a wire contract like any other and
// belong under the schema guard: a renamed field here must break CI, not
// silently decode to nil on a device.
//
// The queue ROW shapes are not redeclared — they are re-exported from the
// builders that produce them (`lib/privacy/adminLookModeration`,
// `lib/privacy/adminReviewModeration`), so there is exactly one definition.
// Only the two shapes with no existing home — the permission map envelope and
// the inbox counts — are defined here.
import type { AdminUiPerms } from '@/lib/adminUiPermissions'

/** GET /api/v1/admin/me → `admin`. Which admin surfaces this session unlocks. */
export type AdminMeDTO = {
  userId: string
  email: string | null
  perms: AdminUiPerms
}

/**
 * GET /api/v1/admin/moderation/counts → `counts`.
 *
 * True database counts, NOT list lengths: the queue lists cap at 50 rows, so a
 * badge of 80 beside a list of 50 is correct and intended.
 *
 * ⚠️ No review count exists on purpose — there is no Review report model, so
 * reviews are a browse-and-hide surface with no pending state to count.
 */
export type AdminModerationCountsDTO = {
  /** Looks with at least one UNRESOLVED report. */
  reportedLooks: number
  /** Looks whose moderationStatus is PENDING_REVIEW. */
  pendingLooks: number
  /** Look comments with at least one UNRESOLVED report. */
  reportedComments: number
  /** Viral service requests still REQUESTED or IN_REVIEW. */
  viralAwaitingReview: number
}
