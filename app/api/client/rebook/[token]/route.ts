// app/api/client/rebook/[token]/route.ts
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  requireClient,
  pickIsoDate,
  pickString,
  jsonFail,
  jsonOk,
} from '@/app/api/_utils'
import { isRecord } from '@/lib/guards'
import {
  getBookingFailPayload,
  isBookingError,
  type BookingErrorCode,
} from '@/lib/booking/errors'
import { createClientRebookedBookingFromAftercare } from '@/lib/booking/writeBoundary'
import { AftercareRebookMode, Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'

type Ctx = { params: { token: string } | Promise<{ token: string }> }

const REBOOK_GET_SELECT = {
  id: true,
  bookingId: true,
  notes: true,
  serviceNotes: true,
  rebookMode: true,
  rebookedFor: true,
  rebookWindowStart: true,
  rebookWindowEnd: true,
  publicToken: true,
  booking: {
    select: {
      id: true,
      clientId: true,
      professionalId: true,
      serviceId: true,
      offeringId: true,
      scheduledFor: true,
      status: true,
      locationType: true,
      locationId: true,
      subtotalSnapshot: true,
      totalDurationMinutes: true,
      service: {
        select: {
          id: true,
          name: true,
        },
      },
      professional: {
        select: {
          id: true,
          businessName: true,
          timeZone: true,
          location: true,
        },
      },
    },
  },
} satisfies Prisma.AftercareSummarySelect

type RebookGetRecord = Prisma.AftercareSummaryGetPayload<{
  select: typeof REBOOK_GET_SELECT
}>

const REBOOK_POST_SELECT = {
  id: true,
  bookingId: true,
  rebookMode: true,
  rebookWindowStart: true,
  rebookWindowEnd: true,
  booking: {
    select: {
      id: true,
      clientId: true,
      professionalId: true,
    },
  },
} satisfies Prisma.AftercareSummarySelect

type RebookPostRecord = Prisma.AftercareSummaryGetPayload<{
  select: typeof REBOOK_POST_SELECT
}>

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

async function getToken(ctx: Ctx): Promise<string | null> {
  const params = await Promise.resolve(ctx.params)
  return pickString(params?.token)
}

function toGetResponse(aftercare: RebookGetRecord) {
  const booking = aftercare.booking

  return {
    aftercare: {
      id: aftercare.id,
      bookingId: aftercare.bookingId,
      notes: aftercare.notes,
      serviceNotes: aftercare.serviceNotes,
      rebookMode: aftercare.rebookMode,
      rebookedFor: aftercare.rebookedFor
        ? aftercare.rebookedFor.toISOString()
        : null,
      rebookWindowStart: aftercare.rebookWindowStart
        ? aftercare.rebookWindowStart.toISOString()
        : null,
      rebookWindowEnd: aftercare.rebookWindowEnd
        ? aftercare.rebookWindowEnd.toISOString()
        : null,
      publicToken: aftercare.publicToken,
    },
    booking: booking
      ? {
          id: booking.id,
          status: booking.status,
          scheduledFor: booking.scheduledFor.toISOString(),
          totalDurationMinutes: booking.totalDurationMinutes,
          subtotalSnapshot: booking.subtotalSnapshot,
          service: booking.service,
          professional: booking.professional,
        }
      : null,
  }
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const token = await getToken(ctx)
    if (!token) return jsonFail(400, 'Missing token.')

    const aftercare: RebookGetRecord | null =
      await prisma.aftercareSummary.findUnique({
        where: { publicToken: token },
        select: REBOOK_GET_SELECT,
      })

    if (!aftercare) {
      return jsonFail(404, 'Invalid rebook link.')
    }

    if (!aftercare.booking) {
      return jsonFail(409, 'Rebook link is missing booking context.')
    }

    if (aftercare.booking.clientId !== auth.clientId) {
      return jsonFail(403, 'Forbidden.')
    }

    return jsonOk(toGetResponse(aftercare), 200)
  } catch (error: unknown) {
    console.error('GET /api/client/rebook/[token] error:', error)
    return jsonFail(500, 'Internal server error')
  }
}

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const token = await getToken(ctx)
    if (!token) return jsonFail(400, 'Missing token.')

    const rawBody: unknown = await req.json().catch(() => null)
    const body = isRecord(rawBody) ? rawBody : {}

    const scheduledFor = pickIsoDate(body.scheduledFor)
    if (!scheduledFor) {
      return jsonFail(400, 'Missing or invalid scheduledFor.')
    }

    if (scheduledFor.getTime() < Date.now()) {
      return jsonFail(400, 'Pick a future time.')
    }

    const aftercare: RebookPostRecord | null =
      await prisma.aftercareSummary.findUnique({
        where: { publicToken: token },
        select: REBOOK_POST_SELECT,
      })

    if (!aftercare) {
      return jsonFail(404, 'Invalid rebook link.')
    }

    if (!aftercare.booking) {
      return jsonFail(409, 'Rebook link is missing booking context.')
    }

    if (aftercare.booking.clientId !== auth.clientId) {
      return jsonFail(403, 'Forbidden.')
    }

    if (aftercare.rebookMode === AftercareRebookMode.RECOMMENDED_WINDOW) {
      const windowStart = aftercare.rebookWindowStart
      const windowEnd = aftercare.rebookWindowEnd

      if (windowStart && windowEnd) {
        const requestedTime = scheduledFor.getTime()
        if (
          requestedTime < windowStart.getTime() ||
          requestedTime > windowEnd.getTime()
        ) {
          return jsonFail(
            409,
            'Selected time is outside the recommended rebook window.',
          )
        }
      }
    }

    const result = await createClientRebookedBookingFromAftercare({
      aftercareId: aftercare.id,
      bookingId: aftercare.booking.id,
      clientId: auth.clientId,
      scheduledFor,
    })

    return jsonOk(
      {
        booking: {
          id: result.booking.id,
          status: result.booking.status,
          scheduledFor: result.booking.scheduledFor.toISOString(),
        },
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

    console.error('POST /api/client/rebook/[token] error:', error)
    return jsonFail(500, 'Internal server error')
  }
}