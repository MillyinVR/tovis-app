// Shared loader for the pro "last minute" workspace — the single source of truth
// for BOTH the server-rendered page (app/pro/last-minute/page.tsx) and the native
// read API (GET /api/v1/pro/last-minute). Loads (or lazily creates) the
// LastMinuteSettings row with its service rules + blocks, plus the active
// offerings, and shapes them into the workspace payload the client expects.
import { Prisma } from '@prisma/client'

import type { LastMinuteWorkspaceInitial } from '@/app/pro/last-minute/LastMinuteWorkspaceClient'
import {
  moneyToFixed2String,
  moneyToString,
  type MoneyInput,
} from '@/lib/money'
import { prisma } from '@/lib/prisma'
import { sanitizeTimeZone } from '@/lib/timeZone'

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
      priorityOfferEnabled: settings.priorityOfferEnabled,
      priorityOfferMinutes: settings.priorityOfferMinutes,
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

export async function loadLastMinuteWorkspace(args: {
  professionalId: string
  professionalTimeZone?: string | null
}): Promise<LastMinuteWorkspaceInitial> {
  const { professionalId, professionalTimeZone } = args

  const [settings, offerings] = await Promise.all([
    loadOrCreateLastMinuteSettings(professionalId),
    prisma.professionalServiceOffering.findMany({
      where: {
        professionalId,
        isActive: true,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: activeOfferingSelect,
    }),
  ])

  return buildInitialPayload({
    timeZone: normalizeTimeZone(professionalTimeZone),
    settings,
    offerings,
  })
}
