// app/api/pro/last-minute/blocks/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'

export const dynamic = 'force-dynamic'

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function toDateOrNull(v: unknown) {
  const s = pickString(v)
  if (!s) return null
  const d = new Date(s)
  return Number.isFinite(d.getTime()) ? d : null
}

export async function POST(req: Request) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const professionalId = auth.professionalId

    const raw = (await req.json().catch(() => null)) as unknown
    const body = isRecord(raw) ? raw : {}

    const startAt = toDateOrNull(body.startAt)
    const endAt = toDateOrNull(body.endAt)
    const reason = pickString(body.reason)

    if (!startAt || !endAt) return jsonFail(400, 'Invalid start/end.')
    if (startAt >= endAt) return jsonFail(400, 'Block end must be after start.')

    const settings = await prisma.lastMinuteSettings.upsert({
      where: { professionalId },
      update: {},
      create: { professionalId },
      select: { id: true },
    })

    const overlap = await prisma.lastMinuteBlock.findFirst({
      where: {
        settingsId: settings.id,
        startAt: { lt: endAt },
        endAt: { gt: startAt },
      },
      select: { id: true },
    })

    if (overlap) {
      return jsonFail(409, 'That block overlaps an existing block. Remove the overlap first.')
    }

    const block = await prisma.lastMinuteBlock.create({
      data: { settingsId: settings.id, startAt, endAt, reason: reason ?? null },
      select: { id: true, startAt: true, endAt: true, reason: true },
    })

    return jsonOk(
      {
        block: {
          id: block.id,
          startAt: block.startAt.toISOString(),
          endAt: block.endAt.toISOString(),
          reason: block.reason ?? null,
        },
      },
      201,
    )
  } catch (e) {
    console.error('POST /api/pro/last-minute/blocks error', e)
    return jsonFail(500, 'Failed to create block.')
  }
}

export async function DELETE(req: Request) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const professionalId = auth.professionalId

    const { searchParams } = new URL(req.url)
    const id = pickString(searchParams.get('id'))
    if (!id) return jsonFail(400, 'Missing id.')

    const settings = await prisma.lastMinuteSettings.findUnique({
      where: { professionalId },
      select: { id: true },
    })
    if (!settings) return jsonFail(404, 'No settings.')

    const del = await prisma.lastMinuteBlock.deleteMany({
      where: { id, settingsId: settings.id },
    })

    return jsonOk({ ok: true, deleted: del.count }, 200)
  } catch (e) {
    console.error('DELETE /api/pro/last-minute/blocks error', e)
    return jsonFail(500, 'Failed to delete block.')
  }
}