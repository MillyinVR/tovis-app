// app/api/pro/allowed-services/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { moneyToString } from '@/lib/money'
import { requirePro } from '@/app/api/_utils'
import { Prisma, type ProfessionType } from '@prisma/client'

export const dynamic = 'force-dynamic'

type ServiceWithCategory = Prisma.ServiceGetPayload<{
  include: { category: true }
}>

function toDto(svc: ServiceWithCategory) {
  return {
    id: svc.id,
    name: svc.name,
    description: svc.description,
    categoryName: svc.category?.name ?? null,
    categoryDescription: svc.category?.description ?? null,
    defaultDurationMinutes: svc.defaultDurationMinutes,
    minPrice: moneyToString(svc.minPrice),
    allowMobile: svc.allowMobile,
  }
}

function isServicePermissionFilterEnabled(): boolean {
  const raw = process.env.ENABLE_SERVICE_PERMISSION_FILTER
  if (typeof raw !== 'string') return false
  const v = raw.trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}

/**
 * Returns the set of Service IDs that have at least one matching
 * ServicePermission row for the given (professionType, stateCode) — i.e. the
 * services this pro is explicitly licensed to offer.
 *
 * Caller still needs to union this with the open-access set (services with
 * zero ServicePermission rows) to get the full allowed list.
 */
async function resolveExplicitlyAllowedServiceIds(args: {
  professionType: ProfessionType
  licenseState: string | null
}): Promise<Set<string>> {
  const matchingPerms = await prisma.servicePermission.findMany({
    where: {
      professionType: args.professionType,
      OR: [
        { stateCode: null },
        ...(args.licenseState ? [{ stateCode: args.licenseState }] : []),
      ],
    },
    select: { serviceId: true },
    distinct: ['serviceId'],
    take: 5000,
  })

  return new Set(matchingPerms.map((row) => row.serviceId))
}

export async function GET() {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const services = await prisma.service.findMany({
      where: { isActive: true },
      include: { category: true },
      orderBy: { name: 'asc' },
      take: 2000,
    })

    if (!isServicePermissionFilterEnabled()) {
      return NextResponse.json(services.map(toDto), { status: 200 })
    }

    const proProfile = await prisma.professionalProfile.findUnique({
      where: { id: auth.professionalId },
      select: { professionType: true, licenseState: true },
    })

    if (!proProfile?.professionType) {
      // Pro hasn't set their profession yet — fall back to current behavior so
      // we never lock pros out of the catalog mid-onboarding.
      return NextResponse.json(services.map(toDto), { status: 200 })
    }

    const explicitlyAllowed = await resolveExplicitlyAllowedServiceIds({
      professionType: proProfile.professionType,
      licenseState: proProfile.licenseState,
    })

    // Services with zero ServicePermission rows are open to everyone. Build
    // that set so we can union it with the explicitly-licensed set.
    const restrictedRows = await prisma.servicePermission.findMany({
      select: { serviceId: true },
      distinct: ['serviceId'],
      take: 5000,
    })
    const restrictedSet = new Set(restrictedRows.map((r) => r.serviceId))

    const filtered = services.filter((svc) => {
      const isRestricted = restrictedSet.has(svc.id)
      if (!isRestricted) return true
      return explicitlyAllowed.has(svc.id)
    })

    return NextResponse.json(filtered.map(toDto), { status: 200 })
  } catch (error) {
    console.error('Allowed services error', error)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}