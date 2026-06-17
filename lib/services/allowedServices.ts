// lib/services/allowedServices.ts
//
// Single source for "which catalog services may this pro offer" — active
// services, optionally filtered by the pro's profession/license when the
// service-permission feature flag is on. Used by GET /api/pro/allowed-services
// and by the migration service-menu import.

import { Prisma, type ProfessionType } from '@prisma/client'

import { moneyToString } from '@/lib/money'
import { prisma } from '@/lib/prisma'

export type AllowedServiceDto = {
  id: string
  name: string
  description: string | null
  categoryName: string | null
  categoryDescription: string | null
  defaultDurationMinutes: number
  minPrice: string | null
  allowMobile: boolean
}

type ServiceWithCategory = Prisma.ServiceGetPayload<{ include: { category: true } }>

function toAllowedServiceDto(svc: ServiceWithCategory): AllowedServiceDto {
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

// Service IDs with at least one matching ServicePermission for this
// (professionType, state) — the services the pro is explicitly licensed for.
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

export async function loadAllowedServices(
  professionalId: string,
): Promise<AllowedServiceDto[]> {
  const services = await prisma.service.findMany({
    where: { isActive: true },
    include: { category: true },
    orderBy: { name: 'asc' },
    take: 2000,
  })

  if (!isServicePermissionFilterEnabled()) {
    return services.map(toAllowedServiceDto)
  }

  const proProfile = await prisma.professionalProfile.findUnique({
    where: { id: professionalId },
    select: { professionType: true, licenseState: true },
  })

  // Pro hasn't set their profession yet — don't lock them out mid-onboarding.
  if (!proProfile?.professionType) {
    return services.map(toAllowedServiceDto)
  }

  const explicitlyAllowed = await resolveExplicitlyAllowedServiceIds({
    professionType: proProfile.professionType,
    licenseState: proProfile.licenseState,
  })

  // Services with zero ServicePermission rows are open to everyone.
  const restrictedRows = await prisma.servicePermission.findMany({
    select: { serviceId: true },
    distinct: ['serviceId'],
    take: 5000,
  })
  const restrictedSet = new Set(restrictedRows.map((r) => r.serviceId))

  return services
    .filter((svc) => !restrictedSet.has(svc.id) || explicitlyAllowed.has(svc.id))
    .map(toAllowedServiceDto)
}
