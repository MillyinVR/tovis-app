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
  } catch (e) {
    console.error('GET /api/pro/calendar/blocked/[id] error:', e)
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

    const existing = await prisma.calendarBlock.findFirst({
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
      return jsonFail(404, 'Not found.')
    }

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

    if (!hasStartsAt && !hasEndsAt && !noteInput.isSet) {
      return jsonOk({ block: toBlockDto(existing) }, 200)
    }

    const startsAt = startsAtInput ?? existing.startsAt
    const endsAt = endsAtInput ?? existing.endsAt

    const windowError = validateBlockWindow(startsAt, endsAt)
    if (windowError) {
      return jsonFail(400, windowError)
    }

    const location = existing.locationId
      ? await prisma.professionalLocation.findFirst({
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
      : null

    if (existing.locationId && !location) {
      return jsonFail(404, 'Location not found.')
    }

    try {
      await assertNoCalendarBlockConflict({
        professionalId,
        locationId: existing.locationId ?? null,
        requestedStart: startsAt,
        requestedEnd: endsAt,
        excludeBlockId: existing.id,
      })
    } catch (error: unknown) {
      if (error instanceof Error && error.message === 'BLOCKED') {
        logBookingConflict({
          action: 'BLOCK_UPDATE',
          professionalId,
          locationId: existing.locationId ?? null,
          requestedStart: startsAt,
          requestedEnd: endsAt,
          conflictType: 'BLOCKED',
          blockId: existing.id,
          meta: {
            route: 'app/api/pro/calendar/blocked/[id]/route.ts',
          },
        })

        return jsonFail(409, 'That time overlaps an existing block.')
      }

      throw error
    }

    const defaultBufferMinutes = normalizeLocationBufferMinutes(
      location?.bufferMinutes ?? 0,
    )

    const bookingConflict = await hasBookingConflict({
      professionalId,
      requestedStart: startsAt,
      requestedEnd: endsAt,
    })

    if (bookingConflict) {
      logBookingConflict({
        action: 'BLOCK_UPDATE',
        professionalId,
        locationId: existing.locationId ?? null,
        requestedStart: startsAt,
        requestedEnd: endsAt,
        conflictType: 'BOOKING',
        blockId: existing.id,
        meta: {
          route: 'app/api/pro/calendar/blocked/[id]/route.ts',
        },
      })

      return jsonFail(409, 'That time overlaps an existing booking.')
    }

    const holdConflict = await hasHoldConflict({
      professionalId,
      requestedStart: startsAt,
      requestedEnd: endsAt,
      defaultBufferMinutes,
    })

    if (holdConflict) {
      logBookingConflict({
        action: 'BLOCK_UPDATE',
        professionalId,
        locationId: existing.locationId ?? null,
        requestedStart: startsAt,
        requestedEnd: endsAt,
        conflictType: 'HOLD',
        blockId: existing.id,
        meta: {
          route: 'app/api/pro/calendar/blocked/[id]/route.ts',
        },
      })

      return jsonFail(409, 'That time is temporarily held for booking.')
    }

    const updated = await prisma.calendarBlock.update({
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

    return jsonOk({ block: toBlockDto(updated) }, 200)
  } catch (e) {
    console.error('PATCH /api/pro/calendar/blocked/[id] error:', e)
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

    const existing = await prisma.calendarBlock.findFirst({
      where: { id: blockId, professionalId },
      select: { id: true },
    })

    if (!existing) {
      return jsonFail(404, 'Not found.')
    }

    await prisma.calendarBlock.delete({
      where: { id: existing.id },
    })

    return jsonOk({ ok: true, id: existing.id }, 200)
  } catch (e) {
    console.error('DELETE /api/pro/calendar/blocked/[id] error:', e)
    return jsonFail(500, 'Failed to delete block.')
  }
}