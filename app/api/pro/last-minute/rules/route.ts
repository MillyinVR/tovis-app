// app/api/pro/last-minute/rules/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'

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

export async function PATCH(req: Request) {
  try {
    const auth = await requirePro()
    if (auth.res) return auth.res
    const professionalId = auth.professionalId

    const body = (await req.json().catch(() => ({}))) as any

    const serviceId = pickString(body?.serviceId)
    if (!serviceId) return jsonFail(400, 'Missing serviceId.')

    const settings = await prisma.lastMinuteSettings.upsert({
      where: { professionalId },
      create: { professionalId },
      update: {},
      select: { id: true },
    })

    const enabled = typeof body?.enabled === 'boolean' ? body.enabled : undefined

    let minPrice: string | null | undefined = undefined
    if (Object.prototype.hasOwnProperty.call(body, 'minPrice')) {
      if (body.minPrice === null) {
        minPrice = null
      } else {
        const dec = toDecimalString(body.minPrice)
        if (dec == null) return jsonFail(400, 'minPrice must be like 80 or 79.99 (or null).')
        minPrice = dec
      }
    }

    const rule = await prisma.lastMinuteServiceRule.upsert({
      where: { settingsId_serviceId: { settingsId: settings.id, serviceId } },
      create: {
        settingsId: settings.id,
        serviceId,
        enabled: enabled ?? true,
        minPrice: minPrice ?? null,
      } as any,
      update: {
        ...(enabled === undefined ? {} : { enabled }),
        ...(minPrice === undefined ? {} : { minPrice }),
      } as any,
    })

    return jsonOk({ rule }, 200)
  } catch (e) {
    console.error('PATCH /api/pro/last-minute/rules error', e)
    return jsonFail(500, 'Failed to update rule.')
  }
}
