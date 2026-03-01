// app/api/pro/offerings/[id]/add-ons/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk } from '@/app/api/_utils'
import { requirePro } from '@/app/api/_utils/auth/requirePro'
import { ServiceLocationType } from '@prisma/client'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

function asTrimmedString(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null
}

function parseLocationType(v: unknown): ServiceLocationType | null {
  if (v === ServiceLocationType.SALON) return ServiceLocationType.SALON
  if (v === ServiceLocationType.MOBILE) return ServiceLocationType.MOBILE
  // Accept string literals too (in case payload uses "SALON"/"MOBILE")
  if (v === 'SALON') return ServiceLocationType.SALON
  if (v === 'MOBILE') return ServiceLocationType.MOBILE
  return null
}

function parseIntSafe(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : fallback
}

function parseBool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback
}

/**
 * Price overrides are stored as Prisma Decimal (or compatible), but come from client as string/number.
 * Keep as string in this route to preserve existing behavior; Prisma will coerce if schema supports it.
 */
function parsePriceOverride(v: unknown): string | null {
  if (v == null) return null
  const s = String(v).trim()
  return s ? s : null
}

async function requireOfferingForPro(args: {
  offeringId: string
  professionalId: string
}): Promise<
  | { ok: true; base: { id: string; serviceId: string } }
  | { ok: false; res: Response }
> {
  const base = await prisma.professionalServiceOffering.findFirst({
    where: { id: args.offeringId, professionalId: args.professionalId, isActive: true },
    select: { id: true, serviceId: true },
  })
  if (!base) return { ok: false, res: jsonFail(404, 'Offering not found.') }
  return { ok: true, base }
}

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params
    const offeringId = asTrimmedString(id)
    if (!offeringId) return jsonFail(400, 'Missing offering id.')

    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const baseRes = await requireOfferingForPro({ offeringId, professionalId: auth.professionalId })
    if (!baseRes.ok) return baseRes.res
    const base = baseRes.base

    // ✅ Eligible add-ons = services marked add-on eligible (and active)
    // IMPORTANT: exclude the base service itself.
    const eligible = await prisma.service.findMany({
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
    })

    // ✅ Attached add-ons for this offering
    const attached = await prisma.offeringAddOn.findMany({
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
    })

    return jsonOk({
      eligible: eligible.map((s) => ({
        id: s.id,
        name: s.name,
        group: s.addOnGroup ?? null,
        minPrice: String(s.minPrice),
        defaultDurationMinutes: s.defaultDurationMinutes ?? 0,
      })),
      attached: attached.map((a) => ({
        id: a.id,
        addOnServiceId: a.addOnServiceId,
        title: a.addOnService?.name ?? 'Add-on',
        group: a.addOnService?.addOnGroup ?? null,
        isActive: Boolean(a.isActive),
        isRecommended: Boolean(a.isRecommended),
        sortOrder: a.sortOrder ?? 0,
        locationType: a.locationType ?? null,
        priceOverride: a.priceOverride == null ? null : String(a.priceOverride),
        durationOverrideMinutes: a.durationOverrideMinutes ?? null,
        defaults: {
          minPrice: String(a.addOnService?.minPrice ?? '0'),
          defaultDurationMinutes: a.addOnService?.defaultDurationMinutes ?? 0,
        },
      })),
    })
  } catch (err: unknown) {
    console.error('GET /api/pro/offerings/[id]/add-ons error', err)
    const message = err instanceof Error ? err.message : 'Internal server error'
    return jsonFail(500, message)
  }
}

export async function PUT(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params
    const offeringId = asTrimmedString(id)
    if (!offeringId) return jsonFail(400, 'Missing offering id.')

    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const baseRes = await requireOfferingForPro({ offeringId, professionalId: auth.professionalId })
    if (!baseRes.ok) return baseRes.res
    const base = baseRes.base

    const ct = req.headers.get('content-type') ?? ''
    if (ct && !ct.includes('application/json')) {
      return jsonFail(415, 'Content-Type must be application/json.')
    }

    let body: unknown
    try {
      body = await req.json()
    } catch {
      body = null
    }

    const itemsRaw =
      isRecord(body) && Array.isArray(body.items) ? (body.items as unknown[]) : null
    if (!itemsRaw) return jsonFail(400, 'Invalid payload: expected { items: [] }')

    // sanitize + exclude base service from add-ons
    const cleaned = itemsRaw
      .map((x): {
        addOnServiceId: string
        isActive: boolean
        isRecommended: boolean
        sortOrder: number
        locationType: ServiceLocationType | null
        priceOverride: string | null
        durationOverrideMinutes: number | null
      } => {
        const rec = isRecord(x) ? x : {}
        const addOnServiceId = asTrimmedString(rec.addOnServiceId)

        const durationRaw = rec.durationOverrideMinutes
        const durationOverrideMinutes =
          durationRaw == null ? null : parseIntSafe(durationRaw, 0)

        return {
          addOnServiceId,
          isActive: parseBool(rec.isActive, true),
          isRecommended: parseBool(rec.isRecommended, false),
          sortOrder: parseIntSafe(rec.sortOrder, 0),
          locationType: parseLocationType(rec.locationType),
          priceOverride: parsePriceOverride(rec.priceOverride),
          durationOverrideMinutes:
            durationRaw == null ? null : (Number.isFinite(durationOverrideMinutes) ? durationOverrideMinutes : null),
        }
      })
      .filter((x) => x.addOnServiceId && x.addOnServiceId !== base.serviceId)

    await prisma.$transaction(async (tx) => {
      // Replace semantics: delete then recreate
      await tx.offeringAddOn.deleteMany({ where: { offeringId: base.id } })

      if (!cleaned.length) return

      // Validate chosen services are actually eligible + active
      const eligibleRows = await tx.service.findMany({
        where: {
          id: { in: cleaned.map((x) => x.addOnServiceId) },
          isActive: true,
          isAddOnEligible: true,
        },
        select: { id: true },
        take: 5000,
      })

      const okSet = new Set(eligibleRows.map((x) => x.id))
      const final = cleaned.filter((x) => okSet.has(x.addOnServiceId))

      if (!final.length) return

      await tx.offeringAddOn.createMany({
        data: final.map((x) => ({
          offeringId: base.id,
          addOnServiceId: x.addOnServiceId,
          isActive: x.isActive,
          isRecommended: x.isRecommended,
          sortOrder: x.sortOrder,
          locationType: x.locationType,
          priceOverride: x.priceOverride,
          durationOverrideMinutes: x.durationOverrideMinutes,
        })),
        skipDuplicates: true,
      })
    })

    return jsonOk({ saved: true })
  } catch (err: unknown) {
    console.error('PUT /api/pro/offerings/[id]/add-ons error', err)
    const message = err instanceof Error ? err.message : 'Internal server error'
    return jsonFail(500, message)
  }
}