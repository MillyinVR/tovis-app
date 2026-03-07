// app/api/pro/calendar/blocked/[id]/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'
import { isRecord } from '@/lib/guards'
import {
  buildBlockConflictWhere,
  parseNoteInput,
  toBlockDto,
  toDateOrNull,
  validateBlockWindow,
} from '../_shared'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } | Promise<{ id: string }> }

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

    const conflict = await prisma.calendarBlock.findFirst({
      where: buildBlockConflictWhere({
        professionalId,
        startsAt,
        endsAt,
        locationId: existing.locationId ?? null,
        excludeBlockId: existing.id,
      }),
      select: { id: true },
    })

    if (conflict) {
      return jsonFail(409, 'That time overlaps an existing block.')
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