// app/api/pro/bookings/[id]/rebook/route.ts
import { prisma } from '@/lib/prisma'
import {
  jsonFail,
  jsonOk,
  pickIsoDate,
  pickString,
  requirePro,
} from '@/app/api/_utils'
import { isRecord } from '@/lib/guards'
import {
  getBookingFailPayload,
  isBookingError,
  type BookingErrorCode,
} from '@/lib/booking/errors'
import { createRebookedBookingFromCompletedBooking } from '@/lib/booking/writeBoundary'
import { AftercareRebookMode, BookingStatus } from '@prisma/client'

export const dynamic = 'force-dynamic'

type RebookMode = 'BOOK' | 'RECOMMEND_WINDOW' | 'CLEAR'
type Ctx = { params: { id: string } | Promise<{ id: string }> }

function isMode(value: unknown): value is RebookMode {
  return (
    value === 'BOOK' ||
    value === 'RECOMMEND_WINDOW' ||
    value === 'CLEAR'
  )
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

export async function POST(req: Request, ctx: Ctx) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const professionalId = auth.professionalId
    const params = await Promise.resolve(ctx.params)
    const bookingId = pickString(params?.id)

    if (!bookingId) {
      return jsonFail(400, 'Missing booking id.')
    }

    const rawBody: unknown = await req.json().catch(() => null)
    const body = isRecord(rawBody) ? rawBody : {}

    const mode = isMode(body.mode) ? body.mode : 'BOOK'

    const existing = await prisma.booking.findFirst({
      where: {
        id: bookingId,
        professionalId,
      },
      select: {
        id: true,
        status: true,
      },
    })

    if (!existing) {
      return jsonFail(404, 'Booking not found.')
    }

    if (existing.status !== BookingStatus.COMPLETED) {
      return jsonFail(409, 'Only COMPLETED bookings can be rebooked.')
    }

    if (mode === 'CLEAR') {
      const aftercare = await prisma.aftercareSummary.upsert({
        where: { bookingId: existing.id },
        create: {
          bookingId: existing.id,
          rebookMode: AftercareRebookMode.NONE,
          rebookedFor: null,
          rebookWindowStart: null,
          rebookWindowEnd: null,
        },
        update: {
          rebookMode: AftercareRebookMode.NONE,
          rebookedFor: null,
          rebookWindowStart: null,
          rebookWindowEnd: null,
        },
        select: {
          id: true,
          rebookMode: true,
        },
      })

      return jsonOk(
        {
          mode,
          aftercareId: aftercare.id,
          rebookMode: aftercare.rebookMode,
        },
        200,
      )
    }

    if (mode === 'RECOMMEND_WINDOW') {
      const windowStart = pickIsoDate(body.windowStart)
      const windowEnd = pickIsoDate(body.windowEnd)

      if (!windowStart || !windowEnd) {
        return jsonFail(
          400,
          'windowStart and windowEnd are required ISO strings for RECOMMEND_WINDOW.',
        )
      }

      if (windowEnd <= windowStart) {
        return jsonFail(400, 'windowEnd must be after windowStart.')
      }

      const aftercare = await prisma.aftercareSummary.upsert({
        where: { bookingId: existing.id },
        create: {
          bookingId: existing.id,
          rebookMode: AftercareRebookMode.RECOMMENDED_WINDOW,
          rebookWindowStart: windowStart,
          rebookWindowEnd: windowEnd,
          rebookedFor: null,
        },
        update: {
          rebookMode: AftercareRebookMode.RECOMMENDED_WINDOW,
          rebookWindowStart: windowStart,
          rebookWindowEnd: windowEnd,
          rebookedFor: null,
        },
        select: {
          id: true,
          rebookMode: true,
          rebookWindowStart: true,
          rebookWindowEnd: true,
          rebookedFor: true,
        },
      })

      return jsonOk({ mode, aftercare }, 200)
    }

    const scheduledFor = pickIsoDate(body.scheduledFor)
    if (!scheduledFor) {
      return jsonFail(
        400,
        'scheduledFor is required (ISO string) for BOOK mode.',
      )
    }

    const result = await createRebookedBookingFromCompletedBooking({
      bookingId: existing.id,
      professionalId,
      scheduledFor,
    })

    return jsonOk(
      {
        mode,
        nextBookingId: result.booking.id,
        aftercare: result.aftercare,
      },
      201,
    )
  } catch (error: unknown) {
    if (isBookingError(error)) {
      return bookingJsonFail(error.code, {
        message: error.message,
        userMessage: error.userMessage,
      })
    }

    console.error('POST /api/pro/bookings/[id]/rebook error', error)
    return jsonFail(500, 'Internal server error')
  }
}