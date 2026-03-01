// app/api/pro/last-minute/rules/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'
import { isMoneyString, parseMoney } from '@/lib/money'
import type { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

async function readJsonObject(req: Request): Promise<Record<string, unknown>> {
  const raw: unknown = await req.json().catch(() => ({}))
  return isRecord(raw) ? raw : {}
}

function hasOwn(obj: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(obj, key)
}

function readBool(obj: Record<string, unknown>, key: string): boolean | undefined {
  const v = obj[key]
  return typeof v === 'boolean' ? v : undefined
}

function readMinPricePatch(obj: Record<string, unknown>): { ok: true; value: Prisma.Decimal | null } | { ok: false; error: string } | null {
  if (!hasOwn(obj, 'minPrice')) return null

  const v = obj.minPrice
  if (v === null) return { ok: true, value: null }

  if (typeof v === 'string') {
    const s = v.trim()
    if (!s || !isMoneyString(s)) return { ok: false, error: 'minPrice must be like 80 or 79.99 (or null).' }
    return { ok: true, value: parseMoney(s) }
  }

  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return { ok: false, error: 'minPrice must be like 80 or 79.99 (or null).' }
    return { ok: true, value: parseMoney(v) }
  }

  return { ok: false, error: 'minPrice must be like 80 or 79.99 (or null).' }
}

export async function PATCH(req: Request) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const professionalId = auth.professionalId

    const body = await readJsonObject(req)

    const serviceId = pickString(body.serviceId)
    if (!serviceId) return jsonFail(400, 'Missing serviceId.')

    const settings = await prisma.lastMinuteSettings.upsert({
      where: { professionalId },
      create: { professionalId },
      update: {},
      select: { id: true },
    })

    const enabled = readBool(body, 'enabled')
    const minPricePatch = readMinPricePatch(body)
    if (minPricePatch && !minPricePatch.ok) return jsonFail(400, minPricePatch.error)

    const createData: Prisma.LastMinuteServiceRuleCreateInput = {
      settings: { connect: { id: settings.id } },
      service: { connect: { id: serviceId } },
      enabled: enabled ?? true,
      minPrice: minPricePatch ? minPricePatch.value : null,
    }

    const updateData: Prisma.LastMinuteServiceRuleUpdateInput = {}
    if (enabled !== undefined) updateData.enabled = enabled
    if (minPricePatch) updateData.minPrice = minPricePatch.value

    const rule = await prisma.lastMinuteServiceRule.upsert({
      where: { settingsId_serviceId: { settingsId: settings.id, serviceId } },
      create: createData,
      update: updateData,
    })

    return jsonOk({ rule }, 200)
  } catch (e) {
    console.error('PATCH /api/pro/last-minute/rules error', e)
    return jsonFail(500, 'Failed to update rule.')
  }
}