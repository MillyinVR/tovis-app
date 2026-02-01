// app/pro/last-minute/page.tsx
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import LastMinuteSettingsClient from './settingsClient'
import OpeningsClient from './OpeningsClient'
import { moneyToString } from '@/lib/money'
import { sanitizeTimeZone } from '@/lib/timeZone'

export const dynamic = 'force-dynamic'

export default async function ProLastMinutePage() {
  const user = await getCurrentUser().catch(() => null)
  if (!user || user.role !== 'PRO' || !user.professionalProfile) {
    redirect('/login?from=/pro/last-minute')
  }

  const proId = user.professionalProfile.id

  // ✅ Pro profile tz (ONLY used to interpret datetime-local inputs in this settings UI)
  // Strict: if invalid/missing => null (no LA fallback, no guessing)
  const proProfile = await prisma.professionalProfile.findUnique({
    where: { id: proId },
    select: { timeZone: true },
  })
  const proTz = proProfile?.timeZone ? sanitizeTimeZone(proProfile.timeZone, '') : ''
  const timeZone = proTz || null

  // ✅ Don’t write on every render. Create settings row only if missing.
  const existing = await prisma.lastMinuteSettings.findUnique({
    where: { professionalId: proId },
    include: { serviceRules: true, blocks: { orderBy: { startAt: 'asc' } } },
  })

  const settings =
    existing ??
    (await prisma.lastMinuteSettings.create({
      data: { professionalId: proId },
      include: { serviceRules: true, blocks: { orderBy: { startAt: 'asc' } } },
    }))

  const offerings = await prisma.professionalServiceOffering.findMany({
    where: { professionalId: proId, isActive: true },
    include: { service: true },
    orderBy: { createdAt: 'asc' },
  })

  const payload = {
    /**
     * ✅ SettingsClient uses this to interpret datetime-local inputs.
     * Keep it strict: null if missing/invalid so UI can block + prompt user to fix tz.
     */
    timeZone,

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
    <main className="mx-auto w-full max-w-[960px] px-4 pb-10 pt-6">
      <div className="tovis-glass rounded-card border border-white/10 bg-bgSecondary p-4">
        <h1 className="m-0 text-[18px] font-black text-textPrimary">Last Minute</h1>
        <p className="mt-2 text-[13px] font-semibold text-textSecondary">
          Configure same-day and within-24-hours booking rules without wrecking your brand.
        </p>

        {payload.timeZone ? null : (
          <div className="mt-3 rounded-card border border-white/10 bg-bgPrimary/25 p-3 text-[12px] font-semibold text-toneDanger">
            Your timezone isn’t set yet. Set a valid timezone on your profile before configuring last-minute rules.
          </div>
        )}
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
