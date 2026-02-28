// app/api/pro/last-minute/rules/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'
import { moneyToFixed2String } from '@/lib/money'

export const dynamic = 'force-dynamic'

function normalizeProId(auth: any): string | null {
  const id =
    (typeof auth?.professionalId === 'string' && auth.professionalId.trim()) ||
    (typeof auth?.proId === 'string' && auth.proId.trim()) ||
    null
  return id ? id.trim() : null
}

function moneyFixed2OrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'string' || typeof v === 'number') return moneyToFixed2String(v)
  return moneyToFixed2String(v as any)
}

export async function PATCH(req: Request) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const professionalId = normalizeProId(auth)
    if (!professionalId) return jsonFail(401, 'Unauthorized.')

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
        const fixed = moneyFixed2OrNull(body.minPrice)
        if (fixed == null) return jsonFail(400, 'minPrice must be like 80 or 79.99 (or null).')
        minPrice = fixed
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
