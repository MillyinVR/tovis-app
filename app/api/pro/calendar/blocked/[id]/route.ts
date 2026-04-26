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
} from '@/lib/booking/errors'

import {
  parseNoteInput,
  toBlockDto,
  toDateOrNull,
  validateBlockWindow,
} from '../_shared'

export const dynamic = 'force-dynamic'

// ─── Types ────────────────────────────────────────────────────────────────────

type Ctx = {
  params: { id: string } | Promise<{ id: string }>
}

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

type CalendarBlockRow = {
  id: string
  startsAt: Date
  endsAt: Date
  note: string | null
  locationId: string | null
}

type BlockUpdateTransactionSuccess = {
  ok: true
  status: number
  block: CalendarBlockRow
}

type BlockUpdateTransactionFailure = {
  ok: false
  status: number
  code: BlockRouteLocalErrorCode
  error: string
}

type BlockUpdateTransactionResult =
  | BlockUpdateTransactionSuccess
  | BlockUpdateTransactionFailure

type BlockDeleteTransactionSuccess = {
  ok: true
  status: number
  id: string
}

type BlockDeleteTransactionFailure = {
  ok: false
  status: number
  code: BlockRouteLocalErrorCode
  error: string
}

type BlockDeleteTransactionResult =
  | BlockDeleteTransactionSuccess
  | BlockDeleteTransactionFailure

type BlockConflictType = 'BLOCKED' | 'BOOKING' | 'HOLD'

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function normalizeLocationBufferMinutes(value: unknown): number {
  return clampInt(value, 0, MAX_BUFFER_MINUTES)
}

async function getBlockId(ctx: Ctx): Promise<string | null> {
  const params = await Promise.resolve(ctx.params)

  return pickString(params?.id)
}

function hasOwnField(
  record: Record<string, unknown>,
  field: string,
): boolean {
  return Object.prototype.hasOwnProperty.call(record, field)
}

function blockUpdateFailure(args: {
  status: number
  code: BlockRouteLocalErrorCode
  error: string
}): BlockUpdateTransactionFailure {
  return {
    ok: false,
    status: args.status,
    code: args.code,
    error: args.error,
  }
}

function blockUpdateSuccess(args: {
  status: number
  block: CalendarBlockRow
}): BlockUpdateTransactionSuccess {
  return {
    ok: true,
    status: args.status,
    block: args.block,
  }
}

function blockDeleteFailure(args: {
  status: number
  code: BlockRouteLocalErrorCode
  error: string
}): BlockDeleteTransactionFailure {
  return {
    ok: false,
    status: args.status,
    code: args.code,
    error: args.error,
  }
}

function blockDeleteSuccess(args: {
  status: number
  id: string
}): BlockDeleteTransactionSuccess {
  return {
    ok: true,
    status: args.status,
    id: args.id,
  }
}

function logBlockUpdateConflict(args: {
  professionalId: string
  locationId: string
  requestedStart: Date
  requestedEnd: Date
  conflictType: BlockConflictType
  blockId: string
  conflictingBlockId?: string | null
}): void {
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

function throwBlockedConflict(args: {
  professionalId: string
  locationId: string
  requestedStart: Date
  requestedEnd: Date
  blockId: string
  conflictingBlockId?: string | null
}): never {
  logBlockUpdateConflict({
    professionalId: args.professionalId,
    locationId: args.locationId,
    requestedStart: args.requestedStart,
    requestedEnd: args.requestedEnd,
    conflictType: 'BLOCKED',
    blockId: args.blockId,
    conflictingBlockId: args.conflictingBlockId,
  })

  throw bookingError('TIME_BLOCKED', {
    userMessage: 'That time overlaps an existing block.',
  })
}

function handleCalendarBlockConflictError(args: {
  error: unknown
  professionalId: string
  locationId: string
  requestedStart: Date
  requestedEnd: Date
  blockId: string
}): void {
  const {
    error,
    professionalId,
    locationId,
    requestedStart,
    requestedEnd,
    blockId,
  } = args

  if (!(error instanceof Error)) {
    throw error
  }

  if (error.message === 'TIME_BLOCKED' || error.message === 'BLOCKED') {
    throwBlockedConflict({
      professionalId,
      locationId,
      requestedStart,
      requestedEnd,
      blockId,
    })
  }

  if (error.message.startsWith('BLOCK_CONFLICT:')) {
    const conflictingBlockId =
      error.message.slice('BLOCK_CONFLICT:'.length).trim() || null

    throwBlockedConflict({
      professionalId,
      locationId,
      requestedStart,
      requestedEnd,
      blockId,
      conflictingBlockId,
    })
  }

  throw error
}

// ─── Route handlers ───────────────────────────────────────────────────────────

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const professionalId = auth.professionalId
    const blockId = await getBlockId(ctx)

    if (!blockId) {
      return jsonFail(400, 'Missing block id.', {
        code: 'BLOCK_ID_REQUIRED',
      })
    }

    const block = await prisma.calendarBlock.findFirst({
      where: {
        id: blockId,
        professionalId,
      },
      select: {
        id: true,
        startsAt: true,
        endsAt: true,
        note: true,
        locationId: true,
      },
    })

    if (!block) {
      return jsonFail(404, 'Block not found.', {
        code: 'BLOCK_NOT_FOUND',
      })
    }

    return jsonOk(
      {
        block: toBlockDto(block),
      },
      200,
    )
  } catch (error) {
    console.error('GET /api/pro/calendar/blocked/[id] error:', error)

    return jsonFail(500, 'Failed to load block.', {
      code: 'INTERNAL_ERROR',
    })
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const professionalId = auth.professionalId
    const blockId = await getBlockId(ctx)

    if (!blockId) {
      return jsonFail(400, 'Missing block id.', {
        code: 'BLOCK_ID_REQUIRED',
      })
    }

    const rawBody: unknown = await req.json().catch(() => ({}))
    const body = isRecord(rawBody) ? rawBody : {}

    const hasStartsAt = hasOwnField(body, 'startsAt')
    const hasEndsAt = hasOwnField(body, 'endsAt')

    const startsAtInput = hasStartsAt ? toDateOrNull(body.startsAt) : null
    const endsAtInput = hasEndsAt ? toDateOrNull(body.endsAt) : null

    if (hasStartsAt && !startsAtInput) {
      return jsonFail(400, 'Invalid startsAt.', {
        code: 'INVALID_STARTS_AT',
      })
    }

    if (hasEndsAt && !endsAtInput) {
      return jsonFail(400, 'Invalid endsAt.', {
        code: 'INVALID_ENDS_AT',
      })
    }

    const noteInput = parseNoteInput(body.note, 'patch')

    if (!noteInput.ok) {
      return jsonFail(400, 'Invalid note.', {
        code: 'INVALID_NOTE',
      })
    }

    const result = await withLockedProfessionalTransaction(
      professionalId,
      async ({ tx }): Promise<BlockUpdateTransactionResult> => {
        const existing = await tx.calendarBlock.findFirst({
          where: {
            id: blockId,
            professionalId,
          },
          select: {
            id: true,
            startsAt: true,
            endsAt: true,
            note: true,
            locationId: true,
          },
        })

        if (!existing) {
          return blockUpdateFailure({
            status: 404,
            code: 'BLOCK_NOT_FOUND',
            error: 'Not found.',
          })
        }

        if (!existing.locationId) {
          return blockUpdateFailure({
            status: 400,
            code: 'BLOCK_LOCATION_MISSING',
            error: 'This block is missing a location and cannot be edited.',
          })
        }

        if (!hasStartsAt && !hasEndsAt && !noteInput.isSet) {
          return blockUpdateSuccess({
            status: 200,
            block: existing,
          })
        }

        const startsAt = startsAtInput ?? existing.startsAt
        const endsAt = endsAtInput ?? existing.endsAt

        const windowError = validateBlockWindow(startsAt, endsAt)

        if (windowError) {
          return blockUpdateFailure({
            status: 400,
            code: 'INVALID_BLOCK_WINDOW',
            error: windowError,
          })
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
          return blockUpdateFailure({
            status: 404,
            code: 'BLOCK_LOCATION_NOT_FOUND',
            error: 'Location not found.',
          })
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
        } catch (error) {
          handleCalendarBlockConflictError({
            error,
            professionalId,
            locationId: existing.locationId,
            requestedStart: startsAt,
            requestedEnd: endsAt,
            blockId: existing.id,
          })
        }

        const defaultBufferMinutes = normalizeLocationBufferMinutes(
          location.bufferMinutes,
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
          where: {
            id: existing.id,
          },
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

        return blockUpdateSuccess({
          status: 200,
          block: updated,
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

    console.error('PATCH /api/pro/calendar/blocked/[id] error:', error)

    return jsonFail(500, 'Failed to update block.', {
      code: 'INTERNAL_ERROR',
    })
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const professionalId = auth.professionalId
    const blockId = await getBlockId(ctx)

    if (!blockId) {
      return jsonFail(400, 'Missing block id.', {
        code: 'BLOCK_ID_REQUIRED',
      })
    }

    const result = await withLockedProfessionalTransaction(
      professionalId,
      async ({ tx }): Promise<BlockDeleteTransactionResult> => {
        const existing = await tx.calendarBlock.findFirst({
          where: {
            id: blockId,
            professionalId,
          },
          select: {
            id: true,
          },
        })

        if (!existing) {
          return blockDeleteFailure({
            status: 404,
            code: 'BLOCK_NOT_FOUND',
            error: 'Not found.',
          })
        }

        await tx.calendarBlock.delete({
          where: {
            id: existing.id,
          },
        })

        return blockDeleteSuccess({
          status: 200,
          id: existing.id,
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
        id: result.id,
      },
      result.status,
    )
  } catch (error) {
    console.error('DELETE /api/pro/calendar/blocked/[id] error:', error)

    return jsonFail(500, 'Failed to delete block.', {
      code: 'INTERNAL_ERROR',
    })
  }
}