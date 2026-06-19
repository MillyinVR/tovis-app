// app/api/client/bookings/[id]/aftercare-rebook/route.ts

import { Role } from '@prisma/client'

import { jsonFail, jsonOk, pickString, requireClient, upper } from '@/app/api/_utils'
import { withRouteIdempotency } from '@/app/api/_utils/idempotency'
import { bookingJsonFail } from '@/app/api/_utils/bookingResponses'
import { resolveRouteParams, type RouteContext } from '@/app/api/_utils/routeContext'
import {
  confirmClientAftercareNextAppointment,
  declineClientAftercareNextAppointment,
} from '@/lib/booking/writeBoundary'
import { isBookingError } from '@/lib/booking/errors'
import { prisma } from '@/lib/prisma'
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

async function requireOwnership(
  bookingId: string,
  clientId: string,
): Promise<{ ok: true } | { ok: false; res: Response }> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { id: true, clientId: true },
  })

  if (!booking) return { ok: false, res: jsonFail(404, 'Booking not found.') }
  if (booking.clientId !== clientId) {
    return { ok: false, res: jsonFail(403, 'Forbidden.') }
  }

  return { ok: true }
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

    const own = await requireOwnership(bookingId, clientId)
    if (!own.ok) return own.res

    const body = (await req.json().catch(() => ({}))) as { action?: unknown }
    const action = upper(body?.action)

    if (action !== 'CONFIRM' && action !== 'DECLINE') {
      return jsonFail(400, 'Invalid action.')
    }

    if (action === 'DECLINE') {
      await declineClientAftercareNextAppointment({ bookingId, clientId })
      return jsonOk({ ok: true })
    }

    const requestId = readRequestId(req)

    return await withRouteIdempotency<ConfirmResponseBody>(
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
        operation: 'POST /api/client/bookings/[id]/aftercare-rebook',
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
  } catch (error: unknown) {
    if (isBookingError(error)) {
      return bookingJsonFail(error.code, {
        message: error.message,
        userMessage: error.userMessage,
      })
    }

    console.error('POST /api/client/bookings/[id]/aftercare-rebook error', {
      error: safeError(error),
    })

    captureBookingException({
      error,
      route: 'POST /api/client/bookings/[id]/aftercare-rebook',
    })

    return jsonFail(500, 'Internal server error')
  }
}
