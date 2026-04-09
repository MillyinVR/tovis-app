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

  const professionalId = user.professionalProfile.id

  const [proProfile, existingSettings, offerings] = await Promise.all([
    prisma.professionalProfile.findUnique({
      where: { id: professionalId },
      select: { timeZone: true },
    }),

    prisma.lastMinuteSettings.findUnique({
      where: { professionalId },
      include: {
        serviceRules: {
          orderBy: { serviceId: 'asc' },
        },
        blocks: {
          orderBy: { startAt: 'asc' },
        },
      },
    }),

    prisma.professionalServiceOffering.findMany({
      where: { professionalId, isActive: true },
      include: { service: true },
      orderBy: { createdAt: 'asc' },
    }),
  ])

  const settings =
    existingSettings ??
    (await prisma.lastMinuteSettings.create({
      data: { professionalId },
      include: {
        serviceRules: {
          orderBy: { serviceId: 'asc' },
        },
        blocks: {
          orderBy: { startAt: 'asc' },
        },
      },
    }))

  const rawTimeZone = typeof proProfile?.timeZone === 'string' ? proProfile.timeZone.trim() : ''
  const timeZone = rawTimeZone ? sanitizeTimeZone(rawTimeZone, '') || null : null

  const offeringsPayload = offerings.map((offering) => {
    const base =
      offering.salonPriceStartingAt ??
      offering.mobilePriceStartingAt ??
      offering.service.minPrice ??
      null

    return {
      id: offering.id,
      serviceId: offering.serviceId,
      name: offering.title || offering.service.name,
      basePrice: base ? moneyToString(base) : '0.00',
    }
  })

  const settingsInitial = {
    timeZone,
    settings: {
      id: settings.id,
      enabled: settings.enabled,
      defaultVisibilityMode: settings.defaultVisibilityMode,
      minCollectedSubtotal: settings.minCollectedSubtotal
        ? moneyToString(settings.minCollectedSubtotal)
        : null,
      tier2NightBeforeMinutes: settings.tier2NightBeforeMinutes,
      tier3DayOfMinutes: settings.tier3DayOfMinutes,
      disableMon: settings.disableMon,
      disableTue: settings.disableTue,
      disableWed: settings.disableWed,
      disableThu: settings.disableThu,
      disableFri: settings.disableFri,
      disableSat: settings.disableSat,
      disableSun: settings.disableSun,
      serviceRules: settings.serviceRules.map((rule) => ({
        serviceId: rule.serviceId,
        enabled: rule.enabled,
        minCollectedSubtotal: rule.minCollectedSubtotal
          ? moneyToString(rule.minCollectedSubtotal)
          : null,
      })),
      blocks: settings.blocks.map((block) => ({
        id: block.id,
        startAt: block.startAt.toISOString(),
        endAt: block.endAt.toISOString(),
        reason: block.reason ?? null,
      })),
    },
    offerings: offeringsPayload,
  }

  return (
    <main className="mx-auto w-full max-w-[960px] px-4 pb-10 pt-6">
      <div className="tovis-glass rounded-card border border-white/10 bg-bgSecondary p-4">
        <h1 className="m-0 text-[18px] font-black text-textPrimary">Last Minute</h1>
        <p className="mt-2 text-[13px] font-semibold text-textSecondary">
          Configure your rollout defaults, protect your floor, and create structured last-minute openings without relying
          on legacy discount logic.
        </p>

        {timeZone ? null : (
          <div className="mt-3 rounded-card border border-white/10 bg-bgPrimary/25 p-3 text-[12px] font-semibold text-toneDanger">
            Your timezone is not set yet. Add a valid timezone on your profile before relying on last-minute scheduling.
          </div>
        )}
      </div>

      <div className="mt-4">
        <LastMinuteSettingsClient initial={settingsInitial} />
      </div>

      <div className="mt-4">
        <OpeningsClient offerings={offeringsPayload} />
      </div>
    </main>
  )
}