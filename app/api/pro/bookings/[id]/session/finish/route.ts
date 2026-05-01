// app/api/pro/bookings/[id]/finish/route.ts
import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'
import {
  getBookingFailPayload,
  isBookingError,
  type BookingErrorCode,
} from '@/lib/booking/errors'
import { finishBookingSession } from '@/lib/booking/writeBoundary'
import { SessionStep } from '@prisma/client'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } | Promise<{ id: string }> }

function bookingBase(bookingId: string) {
  return `/pro/bookings/${encodeURIComponent(bookingId)}`
}

function sessionHubHref(bookingId: string) {
  return `${bookingBase(bookingId)}/session`
}

function afterPhotosHref(bookingId: string) {
  return `${bookingBase(bookingId)}/session/after-photos`
}

function aftercareHref(bookingId: string) {
  return `${bookingBase(bookingId)}/aftercare`
}

function nextHrefFromState(args: {
  bookingId: string
  sessionStep: SessionStep
  afterCount: number
}): string {
  if (args.sessionStep === SessionStep.DONE) {
    return aftercareHref(args.bookingId)
  }

  if (args.sessionStep === SessionStep.AFTER_PHOTOS) {
    return args.afterCount > 0
      ? aftercareHref(args.bookingId)
      : afterPhotosHref(args.bookingId)
  }

  return sessionHubHref(args.bookingId)
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

/**
 * Finish (pro)
 * - Does NOT complete the booking (aftercare send does)
 * - Requires startedAt
 * - Canonical behavior: move session into FINISH_REVIEW
 * - Idempotent: if already in FINISH_REVIEW/AFTER_PHOTOS/DONE, returns a stable nextHref
 */
export async function POST(_req: Request, ctx: Ctx) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const proId = auth.professionalId
    const params = await Promise.resolve(ctx.params)
    const bookingId = pickString(params?.id)

    if (!bookingId) {
      return jsonFail(400, 'Missing booking id.')
    }

    const result = await finishBookingSession({
      bookingId,
      professionalId: proId,
    })

    return jsonOk(
      {
        booking: result.booking,
        nextHref: nextHrefFromState({
          bookingId: result.booking.id,
          sessionStep: result.booking.sessionStep,
          afterCount: result.afterCount,
        }),
        afterCount: result.afterCount,
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

    console.error('POST /api/pro/bookings/[id]/finish error', error)
    return jsonFail(500, 'Internal server error')
  }
}