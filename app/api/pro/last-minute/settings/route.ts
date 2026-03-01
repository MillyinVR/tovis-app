// app/api/pro/last-minute/settings/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import { Prisma } from '@prisma/client'
import { parseMoney } from '@/lib/money'

export const dynamic = 'force-dynamic'

function clampPct(v: unknown): number | null {
  const n = typeof v === 'number' || typeof v === 'string' ? Number(v) : NaN
  if (!Number.isFinite(n)) return null
  const x = Math.trunc(n)
  return Math.min(50, Math.max(0, x))
}

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
    const body: unknown = await req.json().catch(() => ({}))

    // ✅ Separate objects so Prisma UpdateInput unions never leak into CreateInput.
    const updateData: Prisma.LastMinuteSettingsUpdateInput = {}
    const createData: Prisma.LastMinuteSettingsUncheckedCreateInput = { professionalId }

    if (typeof (body as { enabled?: unknown }).enabled === 'boolean') {
      const enabled = (body as { enabled: boolean }).enabled
      updateData.enabled = enabled
      createData.enabled = enabled
    }

    if (typeof (body as { discountsEnabled?: unknown }).discountsEnabled === 'boolean') {
      const discountsEnabled = (body as { discountsEnabled: boolean }).discountsEnabled
      updateData.discountsEnabled = discountsEnabled
      createData.discountsEnabled = discountsEnabled
    }

    const sameDayPct = clampPct((body as { windowSameDayPct?: unknown }).windowSameDayPct)
    if (sameDayPct != null) {
      updateData.windowSameDayPct = sameDayPct
      createData.windowSameDayPct = sameDayPct
    }

    const within24Pct = clampPct((body as { window24hPct?: unknown }).window24hPct)
    if (within24Pct != null) {
      updateData.window24hPct = within24Pct
      createData.window24hPct = within24Pct
    }

    // ✅ minPrice: accept null or money-ish; store as Prisma.Decimal
    if (Object.prototype.hasOwnProperty.call(body, 'minPrice')) {
      const raw = (body as { minPrice?: unknown }).minPrice
      if (raw === null) {
        updateData.minPrice = null
        createData.minPrice = null
      } else {
        try {
          const dec: Prisma.Decimal = parseMoney(raw)
          updateData.minPrice = dec
          createData.minPrice = dec
        } catch {
          return jsonFail(400, 'minPrice must be like 80 or 79.99 (or null).')
        }
      }
    }

    for (const k of DAY_FLAGS) {
      const v = (body as Record<DayFlag, unknown>)[k]
      if (typeof v === 'boolean') {
        updateData[k] = v
        createData[k] = v
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