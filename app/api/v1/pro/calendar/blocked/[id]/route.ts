// app/api/v1/pro/calendar/blocked/[id]/route.ts

import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import { bumpScheduleVersion } from '@/lib/booking/cacheVersion'
import {
  assertNoCalendarBlockConflict,
  hasBookingConflict,
  hasHoldConflict,
} from '@/lib/booking/conflictQueries'
import { logBookingConflict } from '@/lib/booking/conflictLogging'
import { withLockedProfessionalTransaction } from '@/lib/booking/scheduleTransaction'
import {
  bookingError,
  getBookingFailPayload,
  isBookingError,
} from '@/lib/booking/errors'

import { resolveBlockScope } from '../_blockScope'

import {
  parseBlockScopeInput,
  parseNoteInput,
  toBlockDto,
  toDateOrNull,
  validateBlockWindow,
} from '../_shared'

export const dynamic = 'force-dynamic'

// ─── Types ────────────────────────────────────────────────────────────────────

type BlockRouteLocalErrorCode =
  | 'BLOCK_ID_REQUIRED'
  | 'BLOCK_NOT_FOUND'
  | 'BLOCK_LOCATION_NOT_FOUND'
  | 'INVALID_LOCATION_ID'
  | 'NO_BOOKABLE_LOCATION'
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
  /**
   * Whether the transaction actually wrote. A patch that names no field is a
   * successful no-op, and a no-op must NOT invalidate cached availability:
   * nothing about this pro's occupancy changed, and the request body is caller
   * -controlled, so bumping here would let anyone dump a pro's warm cache by
   * PATCHing an empty object in a loop.
   */
  changed: boolean
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

async function getBlockId(ctx: RouteContext): Promise<string | null> {
  const params = await resolveRouteParams(ctx)

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
  changed: boolean
}): BlockUpdateTransactionSuccess {
  return {
    ok: true,
    status: args.status,
    block: args.block,
    changed: args.changed,
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
  /** Null for a block that scopes to every location. */
  locationId: string | null
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
      route: 'app/api/v1/pro/calendar/blocked/[id]/route.ts',
    },
  })
}

function throwBlockedConflict(args: {
  professionalId: string
  locationId: string | null
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
  locationId: string | null
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

export async function GET(_req: Request, ctx: RouteContext) {
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
    console.error('GET /api/v1/pro/calendar/blocked/[id] error:', error)

    return jsonFail(500, 'Failed to load block.', {
      code: 'INTERNAL_ERROR',
    })
  }
}

export async function PATCH(req: Request, ctx: RouteContext) {
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

    const body = await readJsonRecord(req)

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

    // Re-scoping a block is opt-in per request: an ABSENT `locationId` means
    // "leave the scope alone", an explicit null means "make this block apply to
    // every location", and a blank string is refused (`parseBlockScopeInput`).
    // Without the absent/null distinction a plain time edit would silently widen
    // a location-scoped block to all locations.
    const hasLocationId = hasOwnField(body, 'locationId')
    const locationIdInput = parseBlockScopeInput(body.locationId)

    if (hasLocationId && !locationIdInput.ok) {
      return jsonFail(400, 'Invalid locationId.', {
        code: 'INVALID_LOCATION_ID',
      })
    }

    const requestedLocationId = locationIdInput.ok ? locationIdInput.value : null

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

        // A scope change counts as a change even when the window and note are
        // untouched — moving a block between locations moves occupancy.
        const scopeChanged =
          hasLocationId && requestedLocationId !== existing.locationId

        if (!hasStartsAt && !hasEndsAt && !noteInput.isSet && !scopeChanged) {
          return blockUpdateSuccess({
            status: 200,
            block: existing,
            changed: false,
          })
        }

        // The scope this block will have AFTER the patch. Every conflict check
        // below runs against THIS, not the stored one: widening a block to all
        // locations can collide with a block at another location that the old
        // scope never had to care about.
        const targetLocationId = hasLocationId
          ? requestedLocationId
          : existing.locationId

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

        // Which mode depends on WHO CHOSE the location, not on the fact that
        // this is a PATCH:
        //
        // - The pro is naming a NEW location, so authorize it exactly like a
        //   create — it must be one of their own bookable locations, and going
        //   unscoped still requires them to have at least one. Anything laxer
        //   would let an edit place a block somewhere a create could not.
        // - Nobody asked to move it, so never strand: the stored location may
        //   since have been archived (`isBookable: false`) or hard-deleted
        //   (`onDelete: SetNull` → `locationId: null`), and refusing on either is
        //   what left blocks permanently uneditable.
        const scope = await resolveBlockScope({
          tx,
          professionalId,
          locationId: targetLocationId,
          mode: scopeChanged ? 'create' : 'edit',
        })

        if (!scope.ok) {
          return scope.code === 'NO_BOOKABLE_LOCATION'
            ? blockUpdateFailure({
                status: 409,
                code: 'NO_BOOKABLE_LOCATION',
                error: 'Add a bookable location before blocking time.',
              })
            : blockUpdateFailure({
                status: 404,
                code: 'BLOCK_LOCATION_NOT_FOUND',
                error: 'Location not found.',
              })
        }

        try {
          await assertNoCalendarBlockConflict({
            tx,
            professionalId,
            // The TARGET scope, not the stored one. Null keeps the unscoped
            // block's own semantics: it conflicts with EVERY other block of this
            // pro's, at any location.
            locationId: targetLocationId,
            requestedStart: startsAt,
            requestedEnd: endsAt,
            excludeBlockId: existing.id,
          })
        } catch (error) {
          handleCalendarBlockConflictError({
            error,
            professionalId,
            locationId: targetLocationId,
            requestedStart: startsAt,
            requestedEnd: endsAt,
            blockId: existing.id,
          })
        }

        const defaultBufferMinutes = scope.defaultBufferMinutes

        const bookingConflict = await hasBookingConflict({
          tx,
          professionalId,
          requestedStart: startsAt,
          requestedEnd: endsAt,
        })

        if (bookingConflict) {
          logBlockUpdateConflict({
            professionalId,
            locationId: targetLocationId,
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
            locationId: targetLocationId,
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
            ...(scopeChanged ? { locationId: targetLocationId } : {}),
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
          changed: true,
        })
      },
    )

    if (!result.ok) {
      return jsonFail(result.status, result.error, {
        code: result.code,
      })
    }

    // A moved or resized block frees time at one end and occupies it at the
    // other, so cached availability is wrong in BOTH directions until this
    // lands. Bump AFTER commit — see the ordering note on `bumpScheduleVersion`
    // — and only when the transaction actually wrote (see `changed`).
    if (result.changed) {
      await bumpScheduleVersion(professionalId)
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

    console.error('PATCH /api/v1/pro/calendar/blocked/[id] error:', error)

    return jsonFail(500, 'Failed to update block.', {
      code: 'INTERNAL_ERROR',
    })
  }
}

export async function DELETE(_req: Request, ctx: RouteContext) {
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

    // Deleting a block RELEASES calendar time. Without this bump the freed
    // slots stay hidden until the day cache's TTL expires — silent capacity
    // loss rather than a dead end, but wrong just the same. Bump AFTER commit —
    // see the ordering note on `bumpScheduleVersion`.
    await bumpScheduleVersion(professionalId)

    return jsonOk(
      {
        id: result.id,
      },
      result.status,
    )
  } catch (error) {
    console.error('DELETE /api/v1/pro/calendar/blocked/[id] error:', error)

    return jsonFail(500, 'Failed to delete block.', {
      code: 'INTERNAL_ERROR',
    })
  }
}