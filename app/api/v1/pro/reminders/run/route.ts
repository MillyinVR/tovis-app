import { jsonFail, requirePro } from '@/app/api/_utils'

export const dynamic = 'force-dynamic'

/**
 * Legacy route intentionally disabled.
 *
 * Why:
 * - The old booking-level reminder flow depended on Booking.reminderSentAt,
 *   which is no longer part of the Prisma model.
 * - Client reminders should be handled by the current scheduled notification /
 *   internal jobs pipeline, not by this pro-scoped direct-send route.
 *
 * Behavior:
 * - Keep the route present so old callers get a clear response instead of a
 *   confusing 404.
 * - Require pro auth so we do not expose internal migration details publicly.
 * - Return 410 Gone to make the deprecation explicit.
 */
export async function POST() {
  const auth = await requirePro()
  if (!auth.ok) return auth.res

  return jsonFail(
    410,
    'Legacy pro reminder runner has been retired. Use the scheduled client notification job pipeline instead.',
  )
}