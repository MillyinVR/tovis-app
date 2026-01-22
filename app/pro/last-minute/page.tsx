import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import LastMinuteSettingsClient from './settingsClient'
import { moneyToString } from '@/lib/money'
import OpeningsClient from './OpeningsClient'

export const dynamic = 'force-dynamic'

export default async function ProLastMinutePage() {
  const user = await getCurrentUser().catch(() => null)
  if (!user || user.role !== 'PRO' || !user.professionalProfile) {
    redirect('/login?from=/pro/last-minute')
  }

  const proId = user.professionalProfile.id

  // Pull the pro timezone (single source of truth: schedule owner)
  // If your schema uses a different field name, adjust here.
  const proProfile = await prisma.professionalProfile.findUnique({
    where: { id: proId },
    select: { timeZone: true },
  })

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
    // ✅ required by settingsClient: interpret datetime-local in THIS TZ
    timeZone: proProfile?.timeZone ?? null,

    settings: {
      ...settings,
      minPrice: settings.minPrice ? moneyToString(settings.minPrice) : null,
      serviceRules: settings.serviceRules.map((r) => ({
        ...r,
        minPrice: r.minPrice ? moneyToString(r.minPrice) : null,
      })),
      blocks: settings.blocks.map((b) => ({
        id: b.id,
        startAt: new Date(b.startAt).toISOString(),
        endAt: new Date(b.endAt).toISOString(),
        reason: b.reason ?? null,
      })),
    },

    offerings: offerings.map((o) => {
      const base = o.salonPriceStartingAt ?? o.mobilePriceStartingAt ?? o.service.minPrice ?? null

      return {
        id: o.id,
        serviceId: o.serviceId,
        name: o.title || o.service.name,
        basePrice: base ? moneyToString(base) : '0.00',

        // Optional extras (fine to keep)
        offersInSalon: o.offersInSalon,
        offersMobile: o.offersMobile,
        salonPriceStartingAt: o.salonPriceStartingAt ? moneyToString(o.salonPriceStartingAt) : null,
        mobilePriceStartingAt: o.mobilePriceStartingAt ? moneyToString(o.mobilePriceStartingAt) : null,
        salonDurationMinutes: o.salonDurationMinutes ?? null,
        mobileDurationMinutes: o.mobileDurationMinutes ?? null,
      }
    }),
  }

  return (
    <main className="mx-auto w-full max-w-960px px-4 pb-10 pt-6">
      <div className="tovis-glass rounded-card border border-white/10 bg-bgSecondary p-4">
        <h1 className="text-[18px] font-black text-textPrimary m-0">Last Minute</h1>
        <p className="mt-2 text-[13px] font-semibold text-textSecondary">
          Configure same-day and within-24-hours booking rules without wrecking your brand.
        </p>
      </div>

      <div className="mt-4">
        <LastMinuteSettingsClient initial={payload as any} />
      </div>

      <div className="mt-4">
        <OpeningsClient offerings={payload.offerings as any} />
      </div>
    </main>
  )
}
