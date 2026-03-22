// app/api/pro/calendar/blocked/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import { isRecord } from '@/lib/guards'
import { clampInt } from '@/lib/pick'
import { getTimeRangeConflict } from '@/lib/booking/conflictQueries'
import { logBookingConflict } from '@/lib/booking/conflictLogging'
import { MAX_BUFFER_MINUTES } from '@/lib/booking/constants'
import { withLockedProfessionalTransaction } from '@/lib/booking/scheduleTransaction'
import {
  bookingError,
  getBookingFailPayload,
  isBookingError,
  type BookingErrorCode,
} from '@/lib/booking/errors'
import {
  clampRange,
  parseLocationIdInput,
  parseNoteInput,
  toBlockDto,
  toDateOrNull,
  validateBlockWindow,
} from './_shared'

export const dynamic = 'force-dynamic'

type BlockCollectionRouteLocalErrorCode =
  | 'BLOCK_WINDOW_REQUIRED'
  | 'INVALID_STARTS_AT'
  | 'INVALID_ENDS_AT'
  | 'INVALID_NOTE'
  | 'INVALID_LOCATION_ID'
  | 'LOCATION_ID_REQUIRED'
  | 'BLOCK_LOCATION_NOT_FOUND'
  | 'INVALID_BLOCK_WINDOW'
  | 'INTERNAL_ERROR'

function normalizeLocationBufferMinutes(value: unknown): number {
  return clampInt(value, 0, MAX_BUFFER_MINUTES)
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

function localJsonFail(
  status: number,
  code: BlockCollectionRouteLocalErrorCode,
  error: string,
) {
  return jsonFail(status, error, { code })
}

function logBlockConflict(args: {
  professionalId: string
  locationId: string
  requestedStart: Date
  requestedEnd: Date
  conflictType: 'BLOCKED' | 'BOOKING' | 'HOLD'
}) {
  logBookingConflict({
    action: 'BLOCK_CREATE',
    professionalId: args.professionalId,
    locationId: args.locationId,
    requestedStart: args.requestedStart,
    requestedEnd: args.requestedEnd,
    conflictType: args.conflictType,
    meta: {
      route: 'app/api/pro/calendar/blocked/route.ts',
    },
  })
}

export async function GET(req: Request) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const professionalId = auth.professionalId
    const url = new URL(req.url)

    const defaultFrom = new Date(Date.now() - 7 * 24 * 60 * 60_000)
    const defaultTo = new Date(Date.now() + 60 * 24 * 60 * 60_000)

    let from = toDateOrNull(url.searchParams.get('from')) ?? defaultFrom
    let to = toDateOrNull(url.searchParams.get('to')) ?? defaultTo

    if (to < from) {
      const tmp = from
      from = to
      to = tmp
    }

    ;({ from, to } = clampRange(from, to))

    const blocks = await prisma.calendarBlock.findMany({
      where: {
        professionalId,
        startsAt: { lte: to },
        endsAt: { gte: from },
      },
      select: {
        id: true,
        startsAt: true,
        endsAt: true,
        note: true,
        locationId: true,
      },
      orderBy: { startsAt: 'asc' },
      take: 1000,
    })

    return jsonOk(
      {
        blocks: blocks.map(toBlockDto),
      },
      200,
    )
  } catch (error) {
    console.error('GET /api/pro/calendar/blocked error:', error)
    return localJsonFail(500, 'INTERNAL_ERROR', 'Failed to load blocked time.')
  }
}

export async function POST(req: Request) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const professionalId = auth.professionalId
    const rawBody: unknown = await req.json().catch(() => ({}))
    const body = isRecord(rawBody) ? rawBody : {}

    const hasStartsAt = Object.prototype.hasOwnProperty.call(body, 'startsAt')
    const hasEndsAt = Object.prototype.hasOwnProperty.call(body, 'endsAt')

    if (!hasStartsAt || !hasEndsAt) {
      return localJsonFail(
        400,
        'BLOCK_WINDOW_REQUIRED',
        'Missing startsAt/endsAt.',
      )
    }

    const startsAt = toDateOrNull(body.startsAt)
    if (!startsAt) {
      return localJsonFail(400, 'INVALID_STARTS_AT', 'Invalid startsAt.')
    }

    const endsAt = toDateOrNull(body.endsAt)
    if (!endsAt) {
      return localJsonFail(400, 'INVALID_ENDS_AT', 'Invalid endsAt.')
    }

    const windowError = validateBlockWindow(startsAt, endsAt)
    if (windowError) {
      return localJsonFail(400, 'INVALID_BLOCK_WINDOW', windowError)
    }

    const noteInput = parseNoteInput(body.note, 'post')
    if (!noteInput.ok) {
      return localJsonFail(400, 'INVALID_NOTE', 'Invalid note.')
    }

    const locationIdInput = parseLocationIdInput(body.locationId)
    if (!locationIdInput.ok) {
      return localJsonFail(400, 'INVALID_LOCATION_ID', 'Invalid locationId.')
    }

    const locationId = locationIdInput.value
    if (!locationId) {
      return localJsonFail(
        400,
        'LOCATION_ID_REQUIRED',
        'Blocked time requires a locationId.',
      )
    }

    const result = await withLockedProfessionalTransaction(
      professionalId,
      async ({ tx }) => {
        const location = await tx.professionalLocation.findFirst({
          where: {
            id: locationId,
            professionalId,
            isBookable: true,
          },
          select: {
            id: true,
            bufferMinutes: true,
          },
        })

        if (!location) {
          return {
            ok: false as const,
            status: 404,
            code: 'BLOCK_LOCATION_NOT_FOUND' as const,
            error: 'Location not found.',
          }
        }

        const timeRangeConflict = await getTimeRangeConflict({
          tx,
          professionalId,
          locationId,
          requestedStart: startsAt,
          requestedEnd: endsAt,
          defaultBufferMinutes: normalizeLocationBufferMinutes(
            location.bufferMinutes,
          ),
        })

        if (timeRangeConflict === 'BLOCKED') {
          logBlockConflict({
            professionalId,
            locationId,
            requestedStart: startsAt,
            requestedEnd: endsAt,
            conflictType: 'BLOCKED',
          })

          throw bookingError('TIME_BLOCKED', {
            userMessage: 'That time overlaps an existing block.',
          })
        }

        if (timeRangeConflict === 'BOOKING') {
          logBlockConflict({
            professionalId,
            locationId,
            requestedStart: startsAt,
            requestedEnd: endsAt,
            conflictType: 'BOOKING',
          })

          throw bookingError('TIME_BOOKED', {
            userMessage: 'That time overlaps an existing booking.',
          })
        }

        if (timeRangeConflict === 'HOLD') {
          logBlockConflict({
            professionalId,
            locationId,
            requestedStart: startsAt,
            requestedEnd: endsAt,
            conflictType: 'HOLD',
          })

          throw bookingError('TIME_HELD', {
            userMessage: 'That time is temporarily held for booking.',
          })
        }

        const created = await tx.calendarBlock.create({
          data: {
            professionalId,
            startsAt,
            endsAt,
            note: noteInput.value,
            locationId,
          },
          select: {
            id: true,
            startsAt: true,
            endsAt: true,
            note: true,
            locationId: true,
          },
        })

        return {
          ok: true as const,
          status: 201,
          block: created,
        }
      },
    )

    if (!result.ok) {
      return localJsonFail(result.status, result.code, result.error)
    }

    return jsonOk({ block: toBlockDto(result.block) }, result.status)
  } catch (error) {
    if (isBookingError(error)) {
      return bookingJsonFail(error.code, {
        message: error.message,
        userMessage: error.userMessage,
      })
    }

    console.error('POST /api/pro/calendar/blocked error:', error)
    return localJsonFail(
      500,
      'INTERNAL_ERROR',
      'Failed to create blocked time.',
    )
  }
}