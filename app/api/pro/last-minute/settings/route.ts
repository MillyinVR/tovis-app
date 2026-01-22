// app/api/pro/last-minute/settings/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'

export const dynamic = 'force-dynamic'

function toDecimalString(v: unknown): string | null {
  if (v === null) return null
  if (v === undefined) return null

  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v < 0) return null
    return v.toFixed(2)
  }

  if (typeof v === 'string') {
    const s = v.trim()
    if (!s) return null
    if (!/^\d+(\.\d{1,2})?$/.test(s)) return null
    const n = Number(s)
    if (!Number.isFinite(n) || n < 0) return null
    return n.toFixed(2)
  }

  const s = (v as any)?.toString?.()
  if (typeof s === 'string') return toDecimalString(s)
  return null
}

function clampPct(v: unknown) {
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  const x = Math.trunc(n)
  return Math.min(50, Math.max(0, x))
}

export async function GET() {
  try {
    const auth = await requirePro()
    if (auth.res) return auth.res
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
    if (auth.res) return auth.res
    const professionalId = auth.professionalId

    const body = (await req.json().catch(() => ({}))) as any
    const patch: Record<string, any> = {}

    if (typeof body.enabled === 'boolean') patch.enabled = body.enabled
    if (typeof body.discountsEnabled === 'boolean') patch.discountsEnabled = body.discountsEnabled

    const sameDay = clampPct(body.windowSameDayPct)
    if (sameDay != null) patch.windowSameDayPct = sameDay

    const h24 = clampPct(body.window24hPct)
    if (h24 != null) patch.window24hPct = h24

    if (Object.prototype.hasOwnProperty.call(body, 'minPrice')) {
      if (body.minPrice === null) {
        patch.minPrice = null
      } else {
        const dec = toDecimalString(body.minPrice)
        if (dec == null) return jsonFail(400, 'minPrice must be like 80 or 79.99 (or null).')
        patch.minPrice = dec
      }
    }

    const dayFlags = ['disableMon', 'disableTue', 'disableWed', 'disableThu', 'disableFri', 'disableSat', 'disableSun'] as const
    for (const k of dayFlags) {
      if (typeof body[k] === 'boolean') patch[k] = body[k]
    }

    const settings = await prisma.lastMinuteSettings.upsert({
      where: { professionalId },
      create: { professionalId, ...patch },
      update: patch,
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
