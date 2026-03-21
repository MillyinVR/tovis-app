// app/api/pro/bookings/[id]/start/route.ts
import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'
import {
  getBookingFailPayload,
  isBookingError,
  type BookingErrorCode,
} from '@/lib/booking/errors'
import { startBookingSession } from '@/lib/booking/writeBoundary'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } | Promise<{ id: string }> }

function bookingBase(bookingId: string): string {
  return `/pro/bookings/${encodeURIComponent(bookingId)}`
}

function sessionHubHref(bookingId: string): string {
  return `${bookingBase(bookingId)}/session`
}

function bookingJsonFail(
  code: BookingErrorCode,
  overrides?: {
    message?: string
    userMessage?: string
  },
) {
  const fail = getBookingFailPayload(code, overrides)
  return jsonFail(fail.httpStatus, fail.userMessage, fail.extra)
}

export async function POST(_request: Request, ctx: Ctx) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const proId = auth.professionalId
    const params = await Promise.resolve(ctx.params)
    const bookingId = pickString(params.id)

    if (!bookingId) {
      return jsonFail(400, 'Missing booking id.')
    }

    const result = await startBookingSession({
      bookingId,
      professionalId: proId,
    })

    return jsonOk(
      {
        booking: result.booking,
        nextHref: sessionHubHref(result.booking.id),
        meta: result.meta,
      },
      200,
    )
  } catch (error: unknown) {
    if (isBookingError(error)) {
      return bookingJsonFail(error.code, {
        message: error.message,
        userMessage: error.userMessage,
      })
    }

    console.error('POST /api/pro/bookings/[id]/start error', error)
    return jsonFail(500, 'Internal server error')
  }
}