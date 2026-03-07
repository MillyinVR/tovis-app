// app/api/pro/offerings/[id]/add-ons/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk } from '@/app/api/_utils'
import { requirePro } from '@/app/api/_utils/auth/requirePro'
import { isRecord } from '@/lib/guards'
import { normalizeLocationType } from '@/lib/booking/locationContext'
import { MAX_SLOT_DURATION_MINUTES } from '@/lib/booking/constants'
import { Prisma, ServiceLocationType } from '@prisma/client'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

type ParsedItem = {
  addOnServiceId: string
  isActive: boolean
  isRecommended: boolean
  sortOrder: number
  locationType: ServiceLocationType | null
  priceOverride: string | null
  durationOverrideMinutes: number | null
}

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function parseBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function parseSortOrder(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(0, Math.trunc(n))
}

function parseLocationTypeInput(value: unknown): {
  ok: true
  value: ServiceLocationType | null
} | {
  ok: false
} {
  if (value == null || value === '') {
    return { ok: true, value: null }
  }

  const parsed = normalizeLocationType(value)
  if (!parsed) {
    return { ok: false }
  }

  return { ok: true, value: parsed }
}

function parseDurationOverride(value: unknown): {
  ok: true
  value: number | null
} | {
  ok: false
} {
  if (value == null || value === '') {
    return { ok: true, value: null }
  }

  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) {
    return { ok: false }
  }

  const whole = Math.trunc(n)
  if (whole < 1 || whole > MAX_SLOT_DURATION_MINUTES) {
    return { ok: false }
  }

  return { ok: true, value: whole }
}

function parsePriceOverride(value: unknown): {
  ok: true
  value: string | null
} | {
  ok: false
} {
  if (value == null || value === '') {
    return { ok: true, value: null }
  }

  const raw = String(value).trim()
  if (!raw) {
    return { ok: true, value: null }
  }

  try {
    const decimal = new Prisma.Decimal(raw)
    if (decimal.isNegative()) {
      return { ok: false }
    }
    return { ok: true, value: decimal.toString() }
  } catch {
    return { ok: false }
  }
}

async function requireOfferingForPro(args: {
  offeringId: string
  professionalId: string
}): Promise<
  | { ok: true; base: { id: string; serviceId: string } }
  | { ok: false; res: Response }
> {
  const base = await prisma.professionalServiceOffering.findFirst({
    where: {
      id: args.offeringId,
      professionalId: args.professionalId,
      isActive: true,
    },
    select: {
      id: true,
      serviceId: true,
    },
  })

  if (!base) {
    return { ok: false, res: jsonFail(404, 'Offering not found.') }
  }

  return { ok: true, base }
}

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params
    const offeringId = asTrimmedString(id)
    if (!offeringId) {
      return jsonFail(400, 'Missing offering id.')
    }

    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const baseRes = await requireOfferingForPro({
      offeringId,
      professionalId: auth.professionalId,
    })
    if (!baseRes.ok) return baseRes.res

    const base = baseRes.base

    const [eligible, attached] = await Promise.all([
      prisma.service.findMany({
        where: {
          isActive: true,
          isAddOnEligible: true,
          id: { not: base.serviceId },
        },
        select: {
          id: true,
          name: true,
          addOnGroup: true,
          minPrice: true,
          defaultDurationMinutes: true,
        },
        orderBy: [{ addOnGroup: 'asc' }, { name: 'asc' }],
        take: 2000,
      }),
      prisma.offeringAddOn.findMany({
        where: { offeringId: base.id },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          addOnServiceId: true,
          isActive: true,
          isRecommended: true,
          sortOrder: true,
          locationType: true,
          priceOverride: true,
          durationOverrideMinutes: true,
          addOnService: {
            select: {
              name: true,
              addOnGroup: true,
              minPrice: true,
              defaultDurationMinutes: true,
            },
          },
        },
        take: 500,
      }),
    ])

    return jsonOk({
      eligible: eligible.map((service) => ({
        id: service.id,
        name: service.name,
        group: service.addOnGroup ?? null,
        minPrice: String(service.minPrice),
        defaultDurationMinutes: service.defaultDurationMinutes ?? 0,
      })),
      attached: attached.map((item) => ({
        id: item.id,
        addOnServiceId: item.addOnServiceId,
        title: item.addOnService?.name ?? 'Add-on',
        group: item.addOnService?.addOnGroup ?? null,
        isActive: Boolean(item.isActive),
        isRecommended: Boolean(item.isRecommended),
        sortOrder: item.sortOrder ?? 0,
        locationType: item.locationType ?? null,
        priceOverride: item.priceOverride == null ? null : String(item.priceOverride),
        durationOverrideMinutes: item.durationOverrideMinutes ?? null,
        defaults: {
          minPrice: String(item.addOnService?.minPrice ?? '0'),
          defaultDurationMinutes: item.addOnService?.defaultDurationMinutes ?? 0,
        },
      })),
    })
  } catch (err: unknown) {
    console.error('GET /api/pro/offerings/[id]/add-ons error', err)
    return jsonFail(500, 'Internal server error.')
  }
}

export async function PUT(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params
    const offeringId = asTrimmedString(id)
    if (!offeringId) {
      return jsonFail(400, 'Missing offering id.')
    }

    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const baseRes = await requireOfferingForPro({
      offeringId,
      professionalId: auth.professionalId,
    })
    if (!baseRes.ok) return baseRes.res

    const base = baseRes.base

    const contentType = req.headers.get('content-type') ?? ''
    if (contentType && !contentType.includes('application/json')) {
      return jsonFail(415, 'Content-Type must be application/json.')
    }

    let body: unknown
    try {
      body = await req.json()
    } catch {
      body = null
    }

    const itemsRaw =
      isRecord(body) && Array.isArray(body.items) ? body.items : null

    if (!itemsRaw) {
      return jsonFail(400, 'Invalid payload: expected { items: [] }.')
    }

    const cleaned: ParsedItem[] = []

    for (let index = 0; index < itemsRaw.length; index += 1) {
      const entry = itemsRaw[index]
      if (!isRecord(entry)) {
        return jsonFail(400, 'Invalid service items.')
      }

      const addOnServiceId = asTrimmedString(entry.addOnServiceId)
      if (!addOnServiceId) {
        return jsonFail(400, 'Invalid service items.')
      }

      if (addOnServiceId === base.serviceId) {
        return jsonFail(400, 'Base service cannot be attached as its own add-on.')
      }

      const locationTypeResult = parseLocationTypeInput(entry.locationType)
      if (!locationTypeResult.ok) {
        return jsonFail(400, 'Invalid locationType in one or more add-ons.')
      }

      const durationResult = parseDurationOverride(entry.durationOverrideMinutes)
      if (!durationResult.ok) {
        return jsonFail(400, 'Invalid durationOverrideMinutes in one or more add-ons.')
      }

      const priceResult = parsePriceOverride(entry.priceOverride)
      if (!priceResult.ok) {
        return jsonFail(400, 'Invalid priceOverride in one or more add-ons.')
      }

      cleaned.push({
        addOnServiceId,
        isActive: parseBool(entry.isActive, true),
        isRecommended: parseBool(entry.isRecommended, false),
        sortOrder: parseSortOrder(entry.sortOrder, index),
        locationType: locationTypeResult.value,
        priceOverride: priceResult.value,
        durationOverrideMinutes: durationResult.value,
      })
    }

    const duplicateKey = new Set<string>()
    for (const item of cleaned) {
      const key = `${item.addOnServiceId}::${item.locationType ?? 'ALL'}`
      if (duplicateKey.has(key)) {
        return jsonFail(
          400,
          'Duplicate add-ons are not allowed for the same service/locationType.',
        )
      }
      duplicateKey.add(key)
    }

    const uniqueServiceIds = Array.from(
      new Set(cleaned.map((item) => item.addOnServiceId)),
    )

    const eligibleRows = uniqueServiceIds.length
      ? await prisma.service.findMany({
          where: {
            id: { in: uniqueServiceIds },
            isActive: true,
            isAddOnEligible: true,
          },
          select: { id: true },
          take: 5000,
        })
      : []

    const eligibleSet = new Set(eligibleRows.map((row) => row.id))
    if (eligibleSet.size !== uniqueServiceIds.length) {
      return jsonFail(
        400,
        'One or more selected add-on services are invalid or not add-on eligible.',
      )
    }

    await prisma.$transaction(async (tx) => {
      await tx.offeringAddOn.deleteMany({
        where: { offeringId: base.id },
      })

      if (!cleaned.length) return

      await tx.offeringAddOn.createMany({
        data: cleaned.map((item) => ({
          offeringId: base.id,
          addOnServiceId: item.addOnServiceId,
          isActive: item.isActive,
          isRecommended: item.isRecommended,
          sortOrder: item.sortOrder,
          locationType: item.locationType,
          priceOverride: item.priceOverride,
          durationOverrideMinutes: item.durationOverrideMinutes,
        })),
      })
    })

    return jsonOk({ saved: true })
  } catch (err: unknown) {
    console.error('PUT /api/pro/offerings/[id]/add-ons error', err)
    return jsonFail(500, 'Internal server error.')
  }
}