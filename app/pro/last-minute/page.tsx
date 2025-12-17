// app/pro/last-minute/page.tsx
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import LastMinuteSettingsClient from './settingsClient'
import { moneyToString } from '@/lib/money'

export const dynamic = 'force-dynamic'

export default async function ProLastMinutePage() {
  const user = await getCurrentUser().catch(() => null)
  if (!user || user.role !== 'PRO' || !user.professionalProfile) redirect('/login?from=/pro/last-minute')

  const proId = user.professionalProfile.id

  const settings = await prisma.lastMinuteSettings.upsert({
    where: { professionalId: proId },
    create: { professionalId: proId },
    update: {},
    include: { serviceRules: true, blocks: { orderBy: { startAt: 'asc' } } },
  })

  const offerings = await prisma.professionalServiceOffering.findMany({
    where: { professionalId: proId, isActive: true },
    include: { service: true },
    orderBy: { createdAt: 'asc' },
  })

  const payload = {
    settings: {
      ...settings,
      minPrice: settings.minPrice ? moneyToString(settings.minPrice) : null,
      serviceRules: settings.serviceRules.map((r) => ({
        ...r,
        minPrice: r.minPrice ? moneyToString(r.minPrice) : null,
      })),
    },
    offerings: offerings.map((o) => ({
      id: o.id,
      serviceId: o.serviceId,
      name: o.title || o.service.name,
      basePrice: moneyToString(o.price) ?? '0.00',
    })),
  }

  return (
    <main style={{ padding: '18px 0', fontFamily: 'system-ui' }}>
      <h1 style={{ fontSize: 18, margin: 0 }}>Last Minute</h1>
      <p style={{ marginTop: 6, fontSize: 13, color: '#6b7280' }}>
        Configure same-day (20%) and within-24-hours (10%) booking rules without wrecking your brand.
      </p>

      <div style={{ marginTop: 14 }}>
        <LastMinuteSettingsClient initial={payload as any} />
      </div>
    </main>
  )
}
