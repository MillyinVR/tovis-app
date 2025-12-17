import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

export const dynamic = 'force-dynamic'

function bad(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status })
}

export async function POST(req: Request) {
  const user = await getCurrentUser().catch(() => null)
  if (!user || user.role !== 'PRO' || !user.professionalProfile) return bad('Unauthorized', 401)

  const body = await req.json().catch(() => ({}))

  const startAt = body?.startAt ? new Date(body.startAt) : null
  const endAt = body?.endAt ? new Date(body.endAt) : null
  const reason = typeof body?.reason === 'string' ? body.reason.trim() || null : null

  if (!startAt || !endAt || isNaN(+startAt) || isNaN(+endAt)) return bad('Invalid start/end')
  if (startAt >= endAt) return bad('Block end must be after start.')

  const proId = user.professionalProfile.id

  const settings = await prisma.lastMinuteSettings.upsert({
    where: { professionalId: proId },
    update: {},
    create: { professionalId: proId },
    select: { id: true },
  })

  // Prevent overlaps: [startAt, endAt) overlaps existing block if:
  // existing.startAt < endAt AND existing.endAt > startAt
  const overlap = await prisma.lastMinuteBlock.findFirst({
    where: {
      settingsId: settings.id,
      startAt: { lt: endAt },
      endAt: { gt: startAt },
    },
    select: { id: true, startAt: true, endAt: true },
  })

  if (overlap) {
    return bad('That block overlaps an existing block. Remove the overlap first.', 409)
  }

  const block = await prisma.lastMinuteBlock.create({
    data: {
      settingsId: settings.id,
      startAt,
      endAt,
      reason,
    },
    select: { id: true, startAt: true, endAt: true, reason: true },
  })

  return NextResponse.json({
    block: {
      id: block.id,
      startAt: block.startAt.toISOString(),
      endAt: block.endAt.toISOString(),
      reason: block.reason,
    },
  })
}

export async function DELETE(req: Request) {
  const user = await getCurrentUser().catch(() => null)
  if (!user || user.role !== 'PRO' || !user.professionalProfile) return bad('Unauthorized', 401)

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return bad('Missing id')

  const proId = user.professionalProfile.id

  const settings = await prisma.lastMinuteSettings.findUnique({
    where: { professionalId: proId },
    select: { id: true },
  })
  if (!settings) return bad('No settings', 404)

  const del = await prisma.lastMinuteBlock.deleteMany({
    where: { id, settingsId: settings.id },
  })

  return NextResponse.json({ ok: true, deleted: del.count })
}
