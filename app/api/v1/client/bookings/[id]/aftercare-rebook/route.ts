// app/api/v1/client/bookings/[id]/aftercare-rebook/route.ts

import { Role } from '@prisma/client'

import { jsonFail, jsonOk, pickString, requireClient, upper } from '@/app/api/_utils'
import { withRouteIdempotency } from '@/app/api/_utils/idempotency'
import { bookingJsonFail } from '@/app/api/_utils/bookingResponses'
import { resolveRouteParams, type RouteContext } from '@/app/api/_utils/routeContext'
import { requireClientBookingOwnership } from '@/app/api/_utils/auth/requireClientBookingOwnership'
import {
  confirmClientAftercareNextAppointment,
  declineClientAftercareNextAppointment,
} from '@/lib/booking/writeBoundary'
import { isBookingError } from '@/lib/booking/errors'
import { kickNotificationDrain } from '@/lib/notifications/delivery/kickNotificationDrain'
import { broadcastBookingChange } from '@/lib/live/broadcastBooking'
import { IDEMPOTENCY_ROUTES } from '@/lib/idempotency'
import { captureBookingException } from '@/lib/observability/bookingEvents'
import { safeError } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type ConfirmResponseBody = {
  ok: true
  booking: {
    id: string
    status: string
    scheduledFor: string
  }
}

function readRequestId(req: Request): string | null {
  return (
    pickString(req.headers.get('x-request-id')) ??
    pickString(req.headers.get('request-id')) ??
    null
  )
}

export async function POST(req: Request, ctx: RouteContext) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res
    const { clientId } = auth

    const { id: rawId } = await resolveRouteParams(ctx)
    const bookingId = pickString(rawId)
    if (!bookingId) return jsonFail(400, 'Missing booking id.')

    const own = await requireClientBookingOwnership(bookingId, clientId)
    if (!own.ok) return own.res

    const body = (await req.json().catch(() => ({}))) as { action?: unknown }
    const action = upper(body?.action)

    if (action !== 'CONFIRM' && action !== 'DECLINE') {
      return jsonFail(400, 'Invalid action.')
    }

    if (action === 'DECLINE') {
      await declineClientAftercareNextAppointment({ bookingId, clientId })
      kickNotificationDrain()
      await broadcastBookingChange(bookingId, 'bookings')
      return jsonOk({ ok: true })
    }

    const requestId = readRequestId(req)

    const response = await withRouteIdempotency<ConfirmResponseBody>(
      {
        request: req,
        actor: {
          actorKey: clientId,
          actorRole: Role.CLIENT,
        },
        route: IDEMPOTENCY_ROUTES.CLIENT_AFTERCARE_REBOOK,
        requestLabel: 'aftercare next-appointment confirm',
        requestBody: { action: 'CONFIRM', bookingId, clientId },
        messages: {
          missingKey: 'Missing idempotency key.',
          inProgress: 'A matching confirm request is already in progress.',
          conflict:
            'This idempotency key was already used with a different request body.',
        },
        operation: 'POST /api/v1/client/bookings/[id]/aftercare-rebook',
      },
      async (idem) => {
        const result = await confirmClientAftercareNextAppointment({
          bookingId,
          clientId,
          requestId,
          idempotencyKey: idem.idempotencyKey,
        })

        return {
          status: 201,
          body: {
            ok: true,
            booking: {
              id: result.booking.id,
              status: result.booking.status,
              scheduledFor: result.booking.scheduledFor.toISOString(),
            },
          },
        }
      },
    )

    // Next appointment confirmed (new booking created) — deliver its
    // confirmation immediately.
    kickNotificationDrain()
    await broadcastBookingChange(bookingId, 'bookings')

    return response
  } catch (error: unknown) {
    if (isBookingError(error)) {
      return bookingJsonFail(error.code, {
        message: error.message,
        userMessage: error.userMessage,
      })
    }

    console.error('POST /api/v1/client/bookings/[id]/aftercare-rebook error', {
      error: safeError(error),
    })

    captureBookingException({
      error,
      route: 'POST /api/v1/client/bookings/[id]/aftercare-rebook',
    })

    return jsonFail(500, 'Internal server error')
  }
}
