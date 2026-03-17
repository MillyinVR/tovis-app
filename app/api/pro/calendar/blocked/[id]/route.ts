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
  parseNoteInput,
  toBlockDto,
  toDateOrNull,
  validateBlockWindow,
} from '../_shared'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } | Promise<{ id: string }> }

function normalizeLocationBufferMinutes(value: unknown): number {
  return clampInt(value, 0, MAX_BUFFER_MINUTES)
}

async function getBlockId(ctx: Ctx): Promise<string | null> {
  const params = await Promise.resolve(ctx.params)
  return pickString(params?.id)
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
      return jsonFail(400, 'Missing block id.')
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
      return jsonFail(404, 'Block not found.')
    }

    return jsonOk({ block: toBlockDto(block) }, 200)
  } catch (error) {
    console.error('GET /api/pro/calendar/blocked/[id] error:', error)
    return jsonFail(500, 'Failed to load block.')
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const professionalId = auth.professionalId
    const blockId = await getBlockId(ctx)

    if (!blockId) {
      return jsonFail(400, 'Missing block id.')
    }

    const rawBody: unknown = await req.json().catch(() => ({}))
    const body = isRecord(rawBody) ? rawBody : {}

    const hasStartsAt = Object.prototype.hasOwnProperty.call(body, 'startsAt')
    const hasEndsAt = Object.prototype.hasOwnProperty.call(body, 'endsAt')

    const startsAtInput = hasStartsAt ? toDateOrNull(body.startsAt) : null
    const endsAtInput = hasEndsAt ? toDateOrNull(body.endsAt) : null

    if (hasStartsAt && !startsAtInput) {
      return jsonFail(400, 'Invalid startsAt.')
    }

    if (hasEndsAt && !endsAtInput) {
      return jsonFail(400, 'Invalid endsAt.')
    }

    const noteInput = parseNoteInput(body.note, 'patch')
    if (!noteInput.ok) {
      return jsonFail(400, 'Invalid note.')
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
            status: 404,
            error: 'Not found.',
          }
        }

        if (!existing.locationId) {
          return {
            ok: false as const,
            status: 400,
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
            status: 400,
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
            status: 404,
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
            if (error.message === 'BLOCKED') {
              logBlockUpdateConflict({
                professionalId,
                locationId: existing.locationId,
                requestedStart: startsAt,
                requestedEnd: endsAt,
                conflictType: 'BLOCKED',
                blockId: existing.id,
              })

              return {
                ok: false as const,
                status: 409,
                error: 'That time overlaps an existing block.',
              }
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

              return {
                ok: false as const,
                status: 409,
                error: 'That time overlaps an existing block.',
              }
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

          return {
            ok: false as const,
            status: 409,
            error: 'That time overlaps an existing booking.',
          }
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

          return {
            ok: false as const,
            status: 409,
            error: 'That time is temporarily held for booking.',
          }
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
      return jsonFail(result.status, result.error)
    }

    return jsonOk({ block: toBlockDto(result.block) }, result.status)
  } catch (error) {
    console.error('PATCH /api/pro/calendar/blocked/[id] error:', error)
    return jsonFail(500, 'Failed to update block.')
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const professionalId = auth.professionalId
    const blockId = await getBlockId(ctx)

    if (!blockId) {
      return jsonFail(400, 'Missing block id.')
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
      return jsonFail(result.status, result.error)
    }

    return jsonOk({ ok: true, id: result.id }, result.status)
  } catch (error) {
    console.error('DELETE /api/pro/calendar/blocked/[id] error:', error)
    return jsonFail(500, 'Failed to delete block.')
  }
}