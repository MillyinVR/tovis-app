// app/api/pro/calendar/blocked/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import { isRecord } from '@/lib/guards'
import { clampInt } from '@/lib/pick'
import { getTimeRangeConflict } from '@/lib/booking/conflictQueries'
import { logBookingConflict } from '@/lib/booking/conflictLogging'
import { MAX_BUFFER_MINUTES } from '@/lib/booking/constants'
import {
  buildBlockConflictWhere,
  clampRange,
  parseLocationIdInput,
  parseNoteInput,
  toBlockDto,
  toDateOrNull,
  validateBlockWindow,
} from './_shared'

export const dynamic = 'force-dynamic'

function normalizeLocationBufferMinutes(value: unknown): number {
  return clampInt(value, 0, 0, MAX_BUFFER_MINUTES)
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
  } catch (e) {
    console.error('GET /api/pro/calendar/blocked error:', e)
    return jsonFail(500, 'Failed to load blocked time.')
  }
}

export async function POST(req: Request) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const professionalId = auth.professionalId

    const rawBody: unknown = await req.json().catch(() => ({}))
    const body = isRecord(rawBody) ? rawBody : {}

    const startsAt = toDateOrNull(body.startsAt)
    const endsAt = toDateOrNull(body.endsAt)

    if (!startsAt || !endsAt) {
      return jsonFail(400, 'Missing startsAt/endsAt.')
    }

    const windowError = validateBlockWindow(startsAt, endsAt)
    if (windowError) {
      return jsonFail(400, windowError)
    }

    const noteInput = parseNoteInput(body.note, 'post')
    if (!noteInput.ok) {
      return jsonFail(400, 'Invalid note.')
    }

    const locationIdInput = parseLocationIdInput(body.locationId)
    if (!locationIdInput.ok) {
      return jsonFail(400, 'Invalid locationId.')
    }

    const locationId = locationIdInput.value
    if (!locationId) {
      return jsonFail(400, 'Blocked time requires a locationId.')
    }

    const location = await prisma.professionalLocation.findFirst({
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
      return jsonFail(404, 'Location not found.')
    }

    const blockConflict = await prisma.calendarBlock.findFirst({
      where: buildBlockConflictWhere({
        professionalId,
        startsAt,
        endsAt,
        locationId,
      }),
      select: { id: true },
    })

    if (blockConflict) {
      logBookingConflict({
        action: 'BLOCK_CREATE',
        professionalId,
        locationId,
        requestedStart: startsAt,
        requestedEnd: endsAt,
        conflictType: 'BLOCKED',
        blockId: blockConflict.id,
      })

      return jsonFail(409, 'That time overlaps an existing block.')
    }

    const timeRangeConflict = await getTimeRangeConflict({
      professionalId,
      locationId,
      requestedStart: startsAt,
      requestedEnd: endsAt,
      defaultBufferMinutes: normalizeLocationBufferMinutes(location.bufferMinutes),
    })

    if (timeRangeConflict === 'BOOKING') {
      logBookingConflict({
        action: 'BLOCK_CREATE',
        professionalId,
        locationId,
        requestedStart: startsAt,
        requestedEnd: endsAt,
        conflictType: 'BOOKING',
      })

      return jsonFail(409, 'That time overlaps an existing booking.')
    }

    if (timeRangeConflict === 'HOLD') {
      logBookingConflict({
        action: 'BLOCK_CREATE',
        professionalId,
        locationId,
        requestedStart: startsAt,
        requestedEnd: endsAt,
        conflictType: 'HOLD',
      })

      return jsonFail(409, 'That time is temporarily held for booking.')
    }

    if (timeRangeConflict === 'BLOCKED') {
      logBookingConflict({
        action: 'BLOCK_CREATE',
        professionalId,
        locationId,
        requestedStart: startsAt,
        requestedEnd: endsAt,
        conflictType: 'BLOCKED',
      })

      return jsonFail(409, 'That time overlaps an existing block.')
    }

    const created = await prisma.calendarBlock.create({
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

    return jsonOk({ block: toBlockDto(created) }, 201)
  } catch (e) {
    console.error('POST /api/pro/calendar/blocked error:', e)
    return jsonFail(500, 'Failed to create blocked time.')
  }
}