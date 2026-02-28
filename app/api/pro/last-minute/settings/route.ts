// app/api/pro/last-minute/settings/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import { moneyToFixed2String } from '@/lib/money'

export const dynamic = 'force-dynamic'

function normalizeProId(auth: any): string | null {
  const id =
    (typeof auth?.professionalId === 'string' && auth.professionalId.trim()) ||
    (typeof auth?.proId === 'string' && auth.proId.trim()) ||
    null
  return id ? id.trim() : null
}

function clampPct(v: unknown) {
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  const x = Math.trunc(n)
  return Math.min(50, Math.max(0, x))
}

function moneyFixed2OrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'string' || typeof v === 'number') return moneyToFixed2String(v)
  // Prisma.Decimal could be here on server; moneyToFixed2String supports it (MoneyInput includes Prisma.Decimal)
  // but we can't type-narrow without importing Prisma here, so just attempt via "any".
  return moneyToFixed2String(v as any)
}

export async function GET() {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const professionalId = normalizeProId(auth)
    if (!professionalId) return jsonFail(401, 'Unauthorized.')

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

    const professionalId = normalizeProId(auth)
    if (!professionalId) return jsonFail(401, 'Unauthorized.')

    const body = (await req.json().catch(() => ({}))) as any
    const patch: Record<string, any> = {}

    if (typeof body.enabled === 'boolean') patch.enabled = body.enabled
    if (typeof body.discountsEnabled === 'boolean') patch.discountsEnabled = body.discountsEnabled

    const sameDay = clampPct(body.windowSameDayPct)
    if (sameDay != null) patch.windowSameDayPct = sameDay

    const h24 = clampPct(body.window24hPct)
    if (h24 != null) patch.window24hPct = h24

    // ✅ Money parsing lives in lib/money.ts
    if (Object.prototype.hasOwnProperty.call(body, 'minPrice')) {
      if (body.minPrice === null) {
        patch.minPrice = null
      } else {
        const fixed = moneyFixed2OrNull(body.minPrice)
        if (fixed == null) return jsonFail(400, 'minPrice must be like 80 or 79.99 (or null).')
        patch.minPrice = fixed
      }
    }

    const dayFlags = [
      'disableMon',
      'disableTue',
      'disableWed',
      'disableThu',
      'disableFri',
      'disableSat',
      'disableSun',
    ] as const

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
