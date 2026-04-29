// app/pro/last-minute/page.tsx
import { Prisma } from '@prisma/client'
import { redirect } from 'next/navigation'

import LastMinuteWorkspaceClient, {
  type LastMinuteWorkspaceInitial,
} from './LastMinuteWorkspaceClient'

import { getCurrentUser } from '@/lib/currentUser'
import {
  moneyToFixed2String,
  moneyToString,
  type MoneyInput,
} from '@/lib/money'
import { prisma } from '@/lib/prisma'
import { sanitizeTimeZone } from '@/lib/timeZone'

export const dynamic = 'force-dynamic'

const lastMinuteSettingsInclude = {
  serviceRules: {
    orderBy: {
      serviceId: 'asc',
    },
  },
  blocks: {
    orderBy: {
      startAt: 'asc',
    },
  },
} satisfies Prisma.LastMinuteSettingsInclude

const activeOfferingSelect = {
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
} satisfies Prisma.ProfessionalServiceOfferingSelect

type LastMinuteSettingsRow = Prisma.LastMinuteSettingsGetPayload<{
  include: typeof lastMinuteSettingsInclude
}>

type ActiveOfferingRow = Prisma.ProfessionalServiceOfferingGetPayload<{
  select: typeof activeOfferingSelect
}>

type NullableMoney = MoneyInput | null | undefined

function normalizeNullableMoney(value: NullableMoney): string | null {
  return moneyToString(value)
}

function normalizeBasePrice(value: NullableMoney): string {
  return moneyToFixed2String(value) ?? '0.00'
}

function normalizeTimeZone(value: string | null | undefined): string | null {
  const raw = typeof value === 'string' ? value.trim() : ''

  if (!raw) {
    return null
  }

  return sanitizeTimeZone(raw, '') || null
}

function pickOfferingBasePrice(offering: ActiveOfferingRow): NullableMoney {
  return (
    offering.salonPriceStartingAt ??
    offering.mobilePriceStartingAt ??
    offering.service.minPrice ??
    null
  )
}

function offeringDisplayName(offering: ActiveOfferingRow): string {
  const title = offering.title?.trim()

  return title ? title : offering.service.name
}

function mapOfferingToPayload(
  offering: ActiveOfferingRow,
): LastMinuteWorkspaceInitial['offerings'][number] {
  return {
    id: offering.id,
    serviceId: offering.serviceId,
    name: offeringDisplayName(offering),
    basePrice: normalizeBasePrice(pickOfferingBasePrice(offering)),
  }
}

function mapServiceRuleToPayload(
  rule: LastMinuteSettingsRow['serviceRules'][number],
): LastMinuteWorkspaceInitial['settings']['serviceRules'][number] {
  return {
    serviceId: rule.serviceId,
    enabled: rule.enabled,
    minCollectedSubtotal: normalizeNullableMoney(rule.minCollectedSubtotal),
  }
}

function mapBlockToPayload(
  block: LastMinuteSettingsRow['blocks'][number],
): LastMinuteWorkspaceInitial['settings']['blocks'][number] {
  return {
    id: block.id,
    startAt: block.startAt.toISOString(),
    endAt: block.endAt.toISOString(),
    reason: block.reason ?? null,
  }
}

async function readLastMinuteSettings(
  professionalId: string,
): Promise<LastMinuteSettingsRow | null> {
  return prisma.lastMinuteSettings.findUnique({
    where: {
      professionalId,
    },
    include: lastMinuteSettingsInclude,
  })
}

async function createLastMinuteSettings(
  professionalId: string,
): Promise<LastMinuteSettingsRow> {
  return prisma.lastMinuteSettings.create({
    data: {
      professionalId,
    },
    include: lastMinuteSettingsInclude,
  })
}

async function loadOrCreateLastMinuteSettings(
  professionalId: string,
): Promise<LastMinuteSettingsRow> {
  const existingSettings = await readLastMinuteSettings(professionalId)

  if (existingSettings) {
    return existingSettings
  }

  try {
    return await createLastMinuteSettings(professionalId)
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      const racedSettings = await readLastMinuteSettings(professionalId)

      if (racedSettings) {
        return racedSettings
      }
    }

    throw error
  }
}

function buildInitialPayload(args: {
  timeZone: string | null
  settings: LastMinuteSettingsRow
  offerings: ActiveOfferingRow[]
}): LastMinuteWorkspaceInitial {
  const { timeZone, settings, offerings } = args

  return {
    timeZone,
    settings: {
      id: settings.id,
      enabled: settings.enabled,
      defaultVisibilityMode: settings.defaultVisibilityMode,
      minCollectedSubtotal: normalizeNullableMoney(
        settings.minCollectedSubtotal,
      ),
      tier2NightBeforeMinutes: settings.tier2NightBeforeMinutes,
      tier3DayOfMinutes: settings.tier3DayOfMinutes,
      disableMon: settings.disableMon,
      disableTue: settings.disableTue,
      disableWed: settings.disableWed,
      disableThu: settings.disableThu,
      disableFri: settings.disableFri,
      disableSat: settings.disableSat,
      disableSun: settings.disableSun,
      serviceRules: settings.serviceRules.map(mapServiceRuleToPayload),
      blocks: settings.blocks.map(mapBlockToPayload),
    },
    offerings: offerings.map(mapOfferingToPayload),
  }
}

export default async function ProLastMinutePage() {
  const user = await getCurrentUser().catch(() => null)

  if (!user || user.role !== 'PRO' || !user.professionalProfile) {
    redirect('/login?from=/pro/last-minute')
  }

  const professionalId = user.professionalProfile.id

  const [proProfile, settings, offerings] = await Promise.all([
    prisma.professionalProfile.findUnique({
      where: {
        id: professionalId,
      },
      select: {
        timeZone: true,
      },
    }),

    loadOrCreateLastMinuteSettings(professionalId),

    prisma.professionalServiceOffering.findMany({
      where: {
        professionalId,
        isActive: true,
      },
      orderBy: [
        {
          createdAt: 'asc',
        },
        {
          id: 'asc',
        },
      ],
      select: activeOfferingSelect,
    }),
  ])

  const initial = buildInitialPayload({
    timeZone: normalizeTimeZone(proProfile?.timeZone),
    settings,
    offerings,
  })

  return (
    <main className="lm-page-shell" aria-label="Last minute openings">
      <LastMinuteWorkspaceClient initial={initial} />
    </main>
  )
}