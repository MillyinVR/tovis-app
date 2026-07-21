// app/api/v1/pro/bookings/[id]/aftercare/send/route.ts
import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'
import {
  bookingErrorJsonFail,
  bookingJsonFail,
} from '@/app/api/_utils/bookingResponses'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import { isBookingError } from '@/lib/booking/errors'
import { sendExistingAftercareDraft } from '@/lib/booking/writeBoundary'
import { kickNotificationDrain } from '@/lib/notifications/delivery/kickNotificationDrain'
import { captureBookingException } from '@/lib/observability/bookingEvents'
import { enforceRateLimit } from '@/lib/rateLimit/enforce'
import { proRateLimitKey } from '@/lib/rateLimit/identity'
import { rateLimitExceededResponse } from '@/lib/rateLimit/response'
import { safeError } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const OPERATION = 'POST /api/v1/pro/bookings/[id]/aftercare/send'

/**
 * Send an already-saved aftercare draft to the client — the one-tap "Send"
 * action on a draft card in the pro aftercare list. Thin wrapper over the
 * `sendExistingAftercareDraft` write boundary (the same SSOT the web server
 * action uses), so there is no duplicated delivery/notification logic. Flips
 * the draft to sent, queues the magic-link delivery, and raises AFTERCARE_READY.
 * Idempotent — a no-op when the summary was already sent. Foreign/missing
 * bookings 404 uniformly; a booking with no draft returns AFTERCARE_NOT_COMPLETED.
 */
export async function POST(req: Request, ctx: RouteContext) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const professionalId = auth.professionalId
    const actorUserId = auth.userId

    if (!actorUserId || !actorUserId.trim()) {
      return bookingJsonFail('FORBIDDEN', {
        message: 'Authenticated actor user id is required.',
        userMessage: 'You are not allowed to send this aftercare.',
      })
    }

    const params = await resolveRouteParams(ctx)
    const bookingId = pickString(params?.id)
    if (!bookingId) {
      return bookingJsonFail('BOOKING_ID_REQUIRED')
    }

    const rateLimit = await enforceRateLimit({
      bucket: 'pro:bookings:write',
      key: proRateLimitKey({ professionalId, userId: actorUserId, request: req }),
    })

    if (!rateLimit.allowed) {
      return rateLimitExceededResponse(rateLimit)
    }

    await sendExistingAftercareDraft({
      bookingId,
      professionalId,
      actorUserId,
    })

    // The magic-link email/SMS was enqueued inside the committed transaction —
    // deliver it now rather than waiting for the cron tick.
    kickNotificationDrain()

    return jsonOk({ ok: true }, 200)
  } catch (error: unknown) {
    if (isBookingError(error)) {
      return bookingErrorJsonFail(error)
    }

    console.error(`${OPERATION} error`, { error: safeError(error) })
    captureBookingException({ error, route: OPERATION })

    return jsonFail(500, 'Internal server error.')
  }
}
