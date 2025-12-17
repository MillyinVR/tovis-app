import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

export const dynamic = 'force-dynamic'

export async function PATCH(req: Request) {
  const user = await getCurrentUser().catch(() => null)
  if (!user || user.role !== 'PRO' || !user.professionalProfile) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const proId = user.professionalProfile.id
  const body = await req.json().catch(() => ({}))

  const serviceId = typeof body.serviceId === 'string' ? body.serviceId : null
  if (!serviceId) return NextResponse.json({ error: 'Missing serviceId' }, { status: 400 })

  const settings = await prisma.lastMinuteSettings.upsert({
    where: { professionalId: proId },
    create: { professionalId: proId },
    update: {},
    select: { id: true },
  })

  const enabled = typeof body.enabled === 'boolean' ? body.enabled : undefined
  const minPrice = body.minPrice === null ? null : body.minPrice

  const rule = await prisma.lastMinuteServiceRule.upsert({
    where: { settingsId_serviceId: { settingsId: settings.id, serviceId } },
    create: {
      settingsId: settings.id,
      serviceId,
      enabled: enabled ?? true,
      minPrice: minPrice ?? null,
    },
    update: {
      ...(enabled === undefined ? {} : { enabled }),
      ...(body.hasOwnProperty('minPrice') ? { minPrice } : {}),
    },
  })

  return NextResponse.json({ rule })
}
