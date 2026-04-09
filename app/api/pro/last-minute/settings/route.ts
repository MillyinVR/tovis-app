// app/api/pro/last-minute/settings/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import { LastMinuteVisibilityMode, Prisma } from '@prisma/client'
import { parseMoney } from '@/lib/money'

export const dynamic = 'force-dynamic'

const DAY_FLAGS = [
  'disableMon',
  'disableTue',
  'disableWed',
  'disableThu',
  'disableFri',
  'disableSat',
  'disableSun',
] as const

type DayFlag = (typeof DAY_FLAGS)[number]

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function hasOwn(obj: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key)
}

function readBool(obj: Record<string, unknown>, key: string): boolean | undefined {
  const v = obj[key]
  return typeof v === 'boolean' ? v : undefined
}

function readVisibilityMode(
  obj: Record<string, unknown>,
  key: string,
):
  | { ok: true; value: LastMinuteVisibilityMode }
  | { ok: false; error: string }
  | null {
  if (!hasOwn(obj, key)) return null

  const raw = obj[key]
  const s = typeof raw === 'string' ? raw.trim().toUpperCase() : ''

  if (s === LastMinuteVisibilityMode.TARGETED_ONLY) {
    return { ok: true, value: LastMinuteVisibilityMode.TARGETED_ONLY }
  }
  if (s === LastMinuteVisibilityMode.PUBLIC_AT_DISCOVERY) {
    return { ok: true, value: LastMinuteVisibilityMode.PUBLIC_AT_DISCOVERY }
  }
  if (s === LastMinuteVisibilityMode.PUBLIC_IMMEDIATE) {
    return { ok: true, value: LastMinuteVisibilityMode.PUBLIC_IMMEDIATE }
  }

  return { ok: false, error: 'defaultVisibilityMode must be TARGETED_ONLY, PUBLIC_AT_DISCOVERY, or PUBLIC_IMMEDIATE.' }
}

function readMinutesPatch(
  obj: Record<string, unknown>,
  key: 'tier2NightBeforeMinutes' | 'tier3DayOfMinutes',
): { ok: true; value: number } | { ok: false; error: string } | null {
  if (!hasOwn(obj, key)) return null

  const raw = obj[key]
  const n = typeof raw === 'number' || typeof raw === 'string' ? Number(raw) : NaN

  if (!Number.isFinite(n)) {
    return { ok: false, error: `${key} must be a whole number from 0 to 1439.` }
  }

  const value = Math.trunc(n)
  if (value < 0 || value > 1439) {
    return { ok: false, error: `${key} must be a whole number from 0 to 1439.` }
  }

  return { ok: true, value }
}

function readMoneyPatch(
  obj: Record<string, unknown>,
  key: 'minCollectedSubtotal',
): { ok: true; value: Prisma.Decimal | null } | { ok: false; error: string } | null {
  if (!hasOwn(obj, key)) return null

  const raw = obj[key]
  if (raw === null) {
    return { ok: true, value: null }
  }

  try {
    return { ok: true, value: parseMoney(raw) }
  } catch {
    return { ok: false, error: `${key} must be like 80 or 79.99 (or null).` }
  }
}

function setDayFlag(args: {
  key: DayFlag
  value: boolean
  updateData: Prisma.LastMinuteSettingsUpdateInput
  createData: Prisma.LastMinuteSettingsUncheckedCreateInput
}) {
  const { key, value, updateData, createData } = args

  switch (key) {
    case 'disableMon':
      updateData.disableMon = value
      createData.disableMon = value
      return
    case 'disableTue':
      updateData.disableTue = value
      createData.disableTue = value
      return
    case 'disableWed':
      updateData.disableWed = value
      createData.disableWed = value
      return
    case 'disableThu':
      updateData.disableThu = value
      createData.disableThu = value
      return
    case 'disableFri':
      updateData.disableFri = value
      createData.disableFri = value
      return
    case 'disableSat':
      updateData.disableSat = value
      createData.disableSat = value
      return
    case 'disableSun':
      updateData.disableSun = value
      createData.disableSun = value
      return
  }
}

export async function GET() {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const professionalId = auth.professionalId

    const settings = await prisma.lastMinuteSettings.upsert({
      where: { professionalId },
      create: { professionalId },
      update: {},
      include: {
        serviceRules: true,
        blocks: { orderBy: { startAt: 'asc' } },
      },
    })

    return jsonOk({ settings }, 200)
  } catch (e) {
    console.error('GET /api/pro/last-minute/settings error', e)
    return jsonFail(500, 'Failed to load settings.')
  }
}

export async function PATCH(req: Request) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const professionalId = auth.professionalId
    const rawBody: unknown = await req.json().catch(() => ({}))
    const body = isRecord(rawBody) ? rawBody : {}

    const updateData: Prisma.LastMinuteSettingsUpdateInput = {}
    const createData: Prisma.LastMinuteSettingsUncheckedCreateInput = { professionalId }

    const enabled = readBool(body, 'enabled')
    if (enabled !== undefined) {
      updateData.enabled = enabled
      createData.enabled = enabled
    }

    const visibilityModePatch = readVisibilityMode(body, 'defaultVisibilityMode')
    if (visibilityModePatch && !visibilityModePatch.ok) {
      return jsonFail(400, visibilityModePatch.error)
    }
    if (visibilityModePatch && visibilityModePatch.ok) {
      updateData.defaultVisibilityMode = visibilityModePatch.value
      createData.defaultVisibilityMode = visibilityModePatch.value
    }

    const minCollectedSubtotalPatch = readMoneyPatch(body, 'minCollectedSubtotal')
    if (minCollectedSubtotalPatch && !minCollectedSubtotalPatch.ok) {
      return jsonFail(400, minCollectedSubtotalPatch.error)
    }
    if (minCollectedSubtotalPatch && minCollectedSubtotalPatch.ok) {
      updateData.minCollectedSubtotal = minCollectedSubtotalPatch.value
      createData.minCollectedSubtotal = minCollectedSubtotalPatch.value
    }

    const tier2Patch = readMinutesPatch(body, 'tier2NightBeforeMinutes')
    if (tier2Patch && !tier2Patch.ok) {
      return jsonFail(400, tier2Patch.error)
    }
    if (tier2Patch && tier2Patch.ok) {
      updateData.tier2NightBeforeMinutes = tier2Patch.value
      createData.tier2NightBeforeMinutes = tier2Patch.value
    }

    const tier3Patch = readMinutesPatch(body, 'tier3DayOfMinutes')
    if (tier3Patch && !tier3Patch.ok) {
      return jsonFail(400, tier3Patch.error)
    }
    if (tier3Patch && tier3Patch.ok) {
      updateData.tier3DayOfMinutes = tier3Patch.value
      createData.tier3DayOfMinutes = tier3Patch.value
    }

    for (const key of DAY_FLAGS) {
      const value = readBool(body, key)
      if (value !== undefined) {
        setDayFlag({ key, value, updateData, createData })
      }
    }

    const settings = await prisma.lastMinuteSettings.upsert({
      where: { professionalId },
      create: createData,
      update: updateData,
      include: {
        serviceRules: true,
        blocks: { orderBy: { startAt: 'asc' } },
      },
    })

    return jsonOk({ settings }, 200)
  } catch (e) {
    console.error('PATCH /api/pro/last-minute/settings error', e)
    return jsonFail(500, 'Failed to update settings.')
  }
}