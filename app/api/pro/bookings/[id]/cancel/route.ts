// app/api/pro/bookings/[id]/cancel/route.ts
import { requirePro, jsonFail, jsonOk } from '@/app/api/_utils'
import { BookingStatus } from '@prisma/client'
import { cancelBooking } from '@/lib/booking/writeBoundary'
import { getBookingFailPayload, isBookingError } from '@/lib/booking/errors'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } | Promise<{ id: string }> }

function asTrimmedString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const params = await Promise.resolve(ctx.params)
    const bookingId = asTrimmedString(params.id)

    if (!bookingId) {
      const fail = getBookingFailPayload('BOOKING_ID_REQUIRED')
      return jsonFail(fail.httpStatus, fail.userMessage, fail.extra)
    }

    const body: unknown = await req.json().catch(() => ({}))
    const reason = isRecord(body)
      ? (asTrimmedString(body.reason) ?? 'Cancelled by professional')
      : 'Cancelled by professional'

    const result = await cancelBooking({
      bookingId,
      actor: {
        kind: 'pro',
        professionalId: auth.professionalId,
      },
      notifyClient: true,
      reason,
      allowedStatuses: [BookingStatus.PENDING, BookingStatus.ACCEPTED],
    })

    return jsonOk(
      {
        booking: {
          id: result.booking.id,
          status: result.booking.status,
          sessionStep: result.booking.sessionStep,
        },
        meta: result.meta,
      },
      200,
    )
  } catch (error: unknown) {
    if (isBookingError(error)) {
      const fail = getBookingFailPayload(error.code, {
        message: error.message,
        userMessage: error.userMessage,
      })
      return jsonFail(fail.httpStatus, fail.userMessage, fail.extra)
    }

    console.error('PATCH /api/pro/bookings/[id]/cancel error', error)
    return jsonFail(500, 'Internal server error')
  }
}