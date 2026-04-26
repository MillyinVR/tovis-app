// app/pro/last-minute/page.tsx
import { redirect } from 'next/navigation'

import LastMinuteSettingsClient from './settingsClient'
import OpeningsClient from './OpeningsClient'

import { getCurrentUser } from '@/lib/currentUser'
import { moneyToFixed2String, moneyToString } from '@/lib/money'
import { prisma } from '@/lib/prisma'
import { sanitizeTimeZone } from '@/lib/timeZone'

export const dynamic = 'force-dynamic'

type LastMinuteOfferingPayload = {
  id: string
  serviceId: string
  name: string
  basePrice: string
}

function normalizeNullableMoney(value: Parameters<typeof moneyToString>[0]) {
  return moneyToString(value)
}

function normalizeBasePrice(value: Parameters<typeof moneyToFixed2String>[0]) {
  return moneyToFixed2String(value) ?? '0.00'
}

function normalizeTimeZone(value: string | null | undefined) {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return null

  return sanitizeTimeZone(raw, '') || null
}

function pickOfferingBasePrice(offering: {
  salonPriceStartingAt: Parameters<typeof moneyToFixed2String>[0]
  mobilePriceStartingAt: Parameters<typeof moneyToFixed2String>[0]
  service: {
    minPrice: Parameters<typeof moneyToFixed2String>[0]
  }
}) {
  return (
    offering.salonPriceStartingAt ??
    offering.mobilePriceStartingAt ??
    offering.service.minPrice ??
    null
  )
}

function mapOfferingToPayload(offering: {
  id: string
  serviceId: string
  title: string | null
  salonPriceStartingAt: Parameters<typeof moneyToFixed2String>[0]
  mobilePriceStartingAt: Parameters<typeof moneyToFixed2String>[0]
  service: {
    name: string
    minPrice: Parameters<typeof moneyToFixed2String>[0]
  }
}): LastMinuteOfferingPayload {
  const basePrice = pickOfferingBasePrice(offering)

  return {
    id: offering.id,
    serviceId: offering.serviceId,
    name: offering.title?.trim() || offering.service.name,
    basePrice: normalizeBasePrice(basePrice),
  }
}

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
      where: {
        professionalId,
        isActive: true,
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        serviceId: true,
        title: true,
        salonPriceStartingAt: true,
        mobilePriceStartingAt: true,
        service: {
          select: {
            name: true,
            minPrice: true,
          },
        },
      },
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

  const timeZone = normalizeTimeZone(proProfile?.timeZone)
  const offeringsPayload = offerings.map(mapOfferingToPayload)

  const settingsInitial = {
    timeZone,
    settings: {
      id: settings.id,
      enabled: settings.enabled,
      defaultVisibilityMode: settings.defaultVisibilityMode,
      minCollectedSubtotal: normalizeNullableMoney(settings.minCollectedSubtotal),
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
        minCollectedSubtotal: normalizeNullableMoney(
          rule.minCollectedSubtotal,
        ),
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
        <h1 className="m-0 text-[18px] font-black text-textPrimary">
          Last Minute
        </h1>

        <p className="mt-2 text-[13px] font-semibold text-textSecondary">
          Configure your rollout defaults, protect your floor, and create
          structured last-minute openings without relying on legacy discount
          logic.
        </p>

        {timeZone ? null : (
          <div className="mt-3 rounded-card border border-white/10 bg-bgPrimary/25 p-3 text-[12px] font-semibold text-toneDanger">
            Your timezone is not set yet. Add a valid timezone on your profile
            before relying on last-minute scheduling.
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