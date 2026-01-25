// app/api/pro/offerings/[id]/add-ons/route.ts
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

function jsonOk(data: any, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status })
}
function jsonFail(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status })
}

function asString(v: unknown) {
  return typeof v === 'string' ? v.trim() : ''
}

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params
  const offeringId = asString(id)
  if (!offeringId) return jsonFail('Missing offering id.', 400)

  const user = await getCurrentUser().catch(() => null)
  const profId = user?.role === 'PRO' ? user.professionalProfile?.id : null
  if (!profId) return jsonFail('Unauthorized.', 401)

  // Ensure offering belongs to this pro
  const base = await prisma.professionalServiceOffering.findFirst({
    where: { id: offeringId, professionalId: profId, isActive: true },
    select: { id: true, serviceId: true },
  })
  if (!base) return jsonFail('Offering not found.', 404)

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
}

export async function PUT(req: Request, ctx: Ctx) {
  const { id } = await ctx.params
  const offeringId = asString(id)
  if (!offeringId) return jsonFail('Missing offering id.', 400)

  const user = await getCurrentUser().catch(() => null)
  const profId = user?.role === 'PRO' ? user.professionalProfile?.id : null
  if (!profId) return jsonFail('Unauthorized.', 401)

  const base = await prisma.professionalServiceOffering.findFirst({
    where: { id: offeringId, professionalId: profId, isActive: true },
    select: { id: true, serviceId: true },
  })
  if (!base) return jsonFail('Offering not found.', 404)

  const body = await req.json().catch(() => null)
  const items = Array.isArray(body?.items) ? body.items : null
  if (!items) return jsonFail('Invalid payload: expected { items: [] }', 400)

  // sanitize + exclude base service from add-ons
  const cleaned = items
    .map((x: any) => ({
      addOnServiceId: asString(x?.addOnServiceId),
      isActive: typeof x?.isActive === 'boolean' ? x.isActive : true,
      isRecommended: typeof x?.isRecommended === 'boolean' ? x.isRecommended : false,
      sortOrder: Number.isFinite(Number(x?.sortOrder)) ? Math.trunc(Number(x.sortOrder)) : 0,
      locationType: x?.locationType === 'SALON' || x?.locationType === 'MOBILE' ? x.locationType : null,
      priceOverride: x?.priceOverride == null ? null : String(x.priceOverride),
      durationOverrideMinutes:
        x?.durationOverrideMinutes == null ? null : Math.trunc(Number(x.durationOverrideMinutes)),
    }))
    .filter((x: any) => x.addOnServiceId && x.addOnServiceId !== base.serviceId)

  await prisma.$transaction(async (tx) => {
    // Replace semantics: delete then recreate
    await tx.offeringAddOn.deleteMany({ where: { offeringId: base.id } })

    if (!cleaned.length) return

    // Validate chosen services are actually eligible + active
    const eligibleRows = await tx.service.findMany({
      where: {
        id: { in: cleaned.map((x: any) => x.addOnServiceId) },
        isActive: true,
        isAddOnEligible: true,
      },
      select: { id: true },
      take: 5000,
    })

    const okSet = new Set(eligibleRows.map((x) => x.id))
    const final = cleaned.filter((x: any) => okSet.has(x.addOnServiceId))

    if (!final.length) return

    await tx.offeringAddOn.createMany({
      data: final.map((x: any) => ({
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
}
