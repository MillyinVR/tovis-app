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

// ─── Types ────────────────────────────────────────────────────────────────────

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

type CalendarBlockRow = {
  id: string
  startsAt: Date
  endsAt: Date
  note: string | null
  locationId: string | null
}

type BlockCreateTransactionSuccess = {
  ok: true
  status: number
  block: CalendarBlockRow
}

type BlockCreateTransactionFailure = {
  ok: false
  status: number
  code: BlockCollectionRouteLocalErrorCode
  error: string
}

type BlockCreateTransactionResult =
  | BlockCreateTransactionSuccess
  | BlockCreateTransactionFailure

type BlockQueryRange = {
  from: Date
  to: Date
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MS_PER_DAY = 24 * 60 * 60_000
const DEFAULT_BLOCK_LOOKBACK_DAYS = 7
const DEFAULT_BLOCK_LOOKAHEAD_DAYS = 60
const BLOCK_GET_TAKE_LIMIT = 1000

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function normalizeLocationBufferMinutes(value: unknown): number {
  return clampInt(value, 0, MAX_BUFFER_MINUTES)
}

function blockCreateFailure(args: {
  status: number
  code: BlockCollectionRouteLocalErrorCode
  error: string
}): BlockCreateTransactionFailure {
  return {
    ok: false,
    status: args.status,
    code: args.code,
    error: args.error,
  }
}

function blockCreateSuccess(args: {
  status: number
  block: CalendarBlockRow
}): BlockCreateTransactionSuccess {
  return {
    ok: true,
    status: args.status,
    block: args.block,
  }
}

function defaultBlockQueryRange(now = Date.now()): BlockQueryRange {
  return {
    from: new Date(now - DEFAULT_BLOCK_LOOKBACK_DAYS * MS_PER_DAY),
    to: new Date(now + DEFAULT_BLOCK_LOOKAHEAD_DAYS * MS_PER_DAY),
  }
}

function parseBlockQueryRange(url: URL): BlockQueryRange {
  const fallback = defaultBlockQueryRange()

  let from = toDateOrNull(url.searchParams.get('from')) ?? fallback.from
  let to = toDateOrNull(url.searchParams.get('to')) ?? fallback.to

  if (to < from) {
    const previousFrom = from
    from = to
    to = previousFrom
  }

  return clampRange(from, to)
}

function hasOwnField(
  record: Record<string, unknown>,
  field: string,
): boolean {
  return Object.prototype.hasOwnProperty.call(record, field)
}

function logBlockConflict(args: {
  professionalId: string
  locationId: string
  requestedStart: Date
  requestedEnd: Date
  conflictType: 'BLOCKED' | 'BOOKING' | 'HOLD'
}): void {
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

// ─── Route handlers ───────────────────────────────────────────────────────────

export async function GET(req: Request) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const professionalId = auth.professionalId
    const url = new URL(req.url)
    const { from, to } = parseBlockQueryRange(url)

    const locationIdInput = parseLocationIdInput(
      url.searchParams.get('locationId'),
    )

    if (!locationIdInput.ok) {
      return jsonFail(400, 'Invalid locationId.', {
        code: 'INVALID_LOCATION_ID',
      })
    }

    const locationId = locationIdInput.value

    const blocks = await prisma.calendarBlock.findMany({
      where: {
        professionalId,
        ...(locationId ? { locationId } : {}),
        startsAt: { lt: to },
        endsAt: { gt: from },
      },
      select: {
        id: true,
        startsAt: true,
        endsAt: true,
        note: true,
        locationId: true,
      },
      orderBy: { startsAt: 'asc' },
      take: BLOCK_GET_TAKE_LIMIT,
    })

    return jsonOk(
      {
        blocks: blocks.map(toBlockDto),
        range: {
          from: from.toISOString(),
          to: to.toISOString(),
        },
      },
      200,
    )
  } catch (error) {
    console.error('GET /api/pro/calendar/blocked error:', error)

    return jsonFail(500, 'Failed to load blocked time.', {
      code: 'INTERNAL_ERROR',
    })
  }
}

export async function POST(req: Request) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const rawBody: unknown = await req.json().catch(() => ({}))
    const body = isRecord(rawBody) ? rawBody : {}

    if (!hasOwnField(body, 'startsAt') || !hasOwnField(body, 'endsAt')) {
      return jsonFail(400, 'Missing startsAt/endsAt.', {
        code: 'BLOCK_WINDOW_REQUIRED',
      })
    }

    const startsAt = toDateOrNull(body.startsAt)
    if (!startsAt) {
      return jsonFail(400, 'Invalid startsAt.', {
        code: 'INVALID_STARTS_AT',
      })
    }

    const endsAt = toDateOrNull(body.endsAt)
    if (!endsAt) {
      return jsonFail(400, 'Invalid endsAt.', {
        code: 'INVALID_ENDS_AT',
      })
    }

    const windowError = validateBlockWindow(startsAt, endsAt)
    if (windowError) {
      return jsonFail(400, windowError, {
        code: 'INVALID_BLOCK_WINDOW',
      })
    }

    const noteInput = parseNoteInput(body.note, 'post')
    if (!noteInput.ok) {
      return jsonFail(400, 'Invalid note.', {
        code: 'INVALID_NOTE',
      })
    }

    const locationIdInput = parseLocationIdInput(body.locationId)
    if (!locationIdInput.ok) {
      return jsonFail(400, 'Invalid locationId.', {
        code: 'INVALID_LOCATION_ID',
      })
    }

    const locationId = locationIdInput.value
    if (!locationId) {
      return jsonFail(400, 'Blocked time requires a locationId.', {
        code: 'LOCATION_ID_REQUIRED',
      })
    }

    const professionalId = auth.professionalId

    const result = await withLockedProfessionalTransaction(
      professionalId,
      async ({ tx }): Promise<BlockCreateTransactionResult> => {
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
          return blockCreateFailure({
            status: 404,
            code: 'BLOCK_LOCATION_NOT_FOUND',
            error: 'Location not found.',
          })
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

        return blockCreateSuccess({
          status: 201,
          block: created,
        })
      },
    )

    if (!result.ok) {
      return jsonFail(result.status, result.error, {
        code: result.code,
      })
    }

    return jsonOk(
      {
        block: toBlockDto(result.block),
      },
      result.status,
    )
  } catch (error) {
    if (isBookingError(error)) {
      const fail = getBookingFailPayload(error.code, {
        message: error.message,
        userMessage: error.userMessage,
      })

      return jsonFail(fail.httpStatus, fail.userMessage, fail.extra)
    }

    console.error('POST /api/pro/calendar/blocked error:', error)

    return jsonFail(500, 'Failed to create blocked time.', {
      code: 'INTERNAL_ERROR',
    })
  }
}