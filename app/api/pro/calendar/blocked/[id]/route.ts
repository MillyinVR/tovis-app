// app/api/pro/calendar/blocked/[id]/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'
import { isRecord } from '@/lib/guards'
import { clampInt } from '@/lib/pick'
import {
  assertNoCalendarBlockConflict,
  hasBookingConflict,
  hasHoldConflict,
} from '@/lib/booking/conflictQueries'
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
  parseNoteInput,
  toBlockDto,
  toDateOrNull,
  validateBlockWindow,
} from '../_shared'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } | Promise<{ id: string }> }

type BlockRouteLocalErrorCode =
  | 'BLOCK_ID_REQUIRED'
  | 'BLOCK_NOT_FOUND'
  | 'BLOCK_LOCATION_MISSING'
  | 'BLOCK_LOCATION_NOT_FOUND'
  | 'INVALID_STARTS_AT'
  | 'INVALID_ENDS_AT'
  | 'INVALID_NOTE'
  | 'INVALID_BLOCK_WINDOW'
  | 'INTERNAL_ERROR'

function normalizeLocationBufferMinutes(value: unknown): number {
  return clampInt(value, 0, MAX_BUFFER_MINUTES)
}

async function getBlockId(ctx: Ctx): Promise<string | null> {
  const params = await Promise.resolve(ctx.params)
  return pickString(params?.id)
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
  code: BlockRouteLocalErrorCode,
  error: string,
) {
  return jsonFail(status, error, { code })
}

function logBlockUpdateConflict(args: {
  professionalId: string
  locationId: string
  requestedStart: Date
  requestedEnd: Date
  conflictType: 'BLOCKED' | 'BOOKING' | 'HOLD'
  blockId: string
  conflictingBlockId?: string | null
}) {
  logBookingConflict({
    action: 'BLOCK_UPDATE',
    professionalId: args.professionalId,
    locationId: args.locationId,
    requestedStart: args.requestedStart,
    requestedEnd: args.requestedEnd,
    conflictType: args.conflictType,
    blockId: args.blockId,
    meta: {
      ...(args.conflictingBlockId
        ? { conflictingBlockId: args.conflictingBlockId }
        : {}),
      route: 'app/api/pro/calendar/blocked/[id]/route.ts',
    },
  })
}

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const professionalId = auth.professionalId
    const blockId = await getBlockId(ctx)

    if (!blockId) {
      return localJsonFail(400, 'BLOCK_ID_REQUIRED', 'Missing block id.')
    }

    const block = await prisma.calendarBlock.findFirst({
      where: { id: blockId, professionalId },
      select: {
        id: true,
        startsAt: true,
        endsAt: true,
        note: true,
        locationId: true,
      },
    })

    if (!block) {
      return localJsonFail(404, 'BLOCK_NOT_FOUND', 'Block not found.')
    }

    return jsonOk({ block: toBlockDto(block) }, 200)
  } catch (error) {
    console.error('GET /api/pro/calendar/blocked/[id] error:', error)
    return localJsonFail(500, 'INTERNAL_ERROR', 'Failed to load block.')
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const professionalId = auth.professionalId
    const blockId = await getBlockId(ctx)

    if (!blockId) {
      return localJsonFail(400, 'BLOCK_ID_REQUIRED', 'Missing block id.')
    }

    const rawBody: unknown = await req.json().catch(() => ({}))
    const body = isRecord(rawBody) ? rawBody : {}

    const hasStartsAt = Object.prototype.hasOwnProperty.call(body, 'startsAt')
    const hasEndsAt = Object.prototype.hasOwnProperty.call(body, 'endsAt')

    const startsAtInput = hasStartsAt ? toDateOrNull(body.startsAt) : null
    const endsAtInput = hasEndsAt ? toDateOrNull(body.endsAt) : null

    if (hasStartsAt && !startsAtInput) {
      return localJsonFail(400, 'INVALID_STARTS_AT', 'Invalid startsAt.')
    }

    if (hasEndsAt && !endsAtInput) {
      return localJsonFail(400, 'INVALID_ENDS_AT', 'Invalid endsAt.')
    }

    const noteInput = parseNoteInput(body.note, 'patch')
    if (!noteInput.ok) {
      return localJsonFail(400, 'INVALID_NOTE', 'Invalid note.')
    }

    const result = await withLockedProfessionalTransaction(
      professionalId,
      async ({ tx }) => {
        const existing = await tx.calendarBlock.findFirst({
          where: { id: blockId, professionalId },
          select: {
            id: true,
            startsAt: true,
            endsAt: true,
            note: true,
            locationId: true,
          },
        })

        if (!existing) {
          return {
            ok: false as const,
            type: 'local' as const,
            status: 404,
            code: 'BLOCK_NOT_FOUND' as const,
            error: 'Not found.',
          }
        }

        if (!existing.locationId) {
          return {
            ok: false as const,
            type: 'local' as const,
            status: 400,
            code: 'BLOCK_LOCATION_MISSING' as const,
            error: 'This block is missing a location and cannot be edited.',
          }
        }

        if (!hasStartsAt && !hasEndsAt && !noteInput.isSet) {
          return {
            ok: true as const,
            status: 200,
            block: existing,
          }
        }

        const startsAt = startsAtInput ?? existing.startsAt
        const endsAt = endsAtInput ?? existing.endsAt

        const windowError = validateBlockWindow(startsAt, endsAt)
        if (windowError) {
          return {
            ok: false as const,
            type: 'local' as const,
            status: 400,
            code: 'INVALID_BLOCK_WINDOW' as const,
            error: windowError,
          }
        }

        const location = await tx.professionalLocation.findFirst({
          where: {
            id: existing.locationId,
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
            type: 'local' as const,
            status: 404,
            code: 'BLOCK_LOCATION_NOT_FOUND' as const,
            error: 'Location not found.',
          }
        }

        try {
          await assertNoCalendarBlockConflict({
            tx,
            professionalId,
            locationId: existing.locationId,
            requestedStart: startsAt,
            requestedEnd: endsAt,
            excludeBlockId: existing.id,
          })
        } catch (error: unknown) {
          if (error instanceof Error) {
            if (error.message === 'TIME_BLOCKED' || error.message === 'BLOCKED') {
              logBlockUpdateConflict({
                professionalId,
                locationId: existing.locationId,
                requestedStart: startsAt,
                requestedEnd: endsAt,
                conflictType: 'BLOCKED',
                blockId: existing.id,
              })

              throw bookingError('TIME_BLOCKED', {
                userMessage: 'That time overlaps an existing block.',
              })
            }

            if (error.message.startsWith('BLOCK_CONFLICT:')) {
              const conflictingBlockId =
                error.message.slice('BLOCK_CONFLICT:'.length).trim() || null

              logBlockUpdateConflict({
                professionalId,
                locationId: existing.locationId,
                requestedStart: startsAt,
                requestedEnd: endsAt,
                conflictType: 'BLOCKED',
                blockId: existing.id,
                conflictingBlockId,
              })

              throw bookingError('TIME_BLOCKED', {
                userMessage: 'That time overlaps an existing block.',
              })
            }
          }

          throw error
        }

        const defaultBufferMinutes = normalizeLocationBufferMinutes(
          location.bufferMinutes ?? 0,
        )

        const bookingConflict = await hasBookingConflict({
          tx,
          professionalId,
          requestedStart: startsAt,
          requestedEnd: endsAt,
        })

        if (bookingConflict) {
          logBlockUpdateConflict({
            professionalId,
            locationId: existing.locationId,
            requestedStart: startsAt,
            requestedEnd: endsAt,
            conflictType: 'BOOKING',
            blockId: existing.id,
          })

          throw bookingError('TIME_BOOKED', {
            userMessage: 'That time overlaps an existing booking.',
          })
        }

        const holdConflict = await hasHoldConflict({
          tx,
          professionalId,
          requestedStart: startsAt,
          requestedEnd: endsAt,
          defaultBufferMinutes,
        })

        if (holdConflict) {
          logBlockUpdateConflict({
            professionalId,
            locationId: existing.locationId,
            requestedStart: startsAt,
            requestedEnd: endsAt,
            conflictType: 'HOLD',
            blockId: existing.id,
          })

          throw bookingError('TIME_HELD', {
            userMessage: 'That time is temporarily held for booking.',
          })
        }

        const updated = await tx.calendarBlock.update({
          where: { id: existing.id },
          data: {
            ...(hasStartsAt ? { startsAt } : {}),
            ...(hasEndsAt ? { endsAt } : {}),
            ...(noteInput.isSet ? { note: noteInput.value } : {}),
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
          status: 200,
          block: updated,
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

    console.error('PATCH /api/pro/calendar/blocked/[id] error:', error)
    return localJsonFail(500, 'INTERNAL_ERROR', 'Failed to update block.')
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const professionalId = auth.professionalId
    const blockId = await getBlockId(ctx)

    if (!blockId) {
      return localJsonFail(400, 'BLOCK_ID_REQUIRED', 'Missing block id.')
    }

    const result = await withLockedProfessionalTransaction(
      professionalId,
      async ({ tx }) => {
        const existing = await tx.calendarBlock.findFirst({
          where: { id: blockId, professionalId },
          select: { id: true },
        })

        if (!existing) {
          return {
            ok: false as const,
            status: 404,
            code: 'BLOCK_NOT_FOUND' as const,
            error: 'Not found.',
          }
        }

        await tx.calendarBlock.delete({
          where: { id: existing.id },
        })

        return {
          ok: true as const,
          status: 200,
          id: existing.id,
        }
      },
    )

    if (!result.ok) {
      return localJsonFail(result.status, result.code, result.error)
    }

    return jsonOk({ ok: true, id: result.id }, result.status)
  } catch (error) {
    console.error('DELETE /api/pro/calendar/blocked/[id] error:', error)
    return localJsonFail(500, 'INTERNAL_ERROR', 'Failed to delete block.')
  }
}