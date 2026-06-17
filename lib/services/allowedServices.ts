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

// Service IDs this pro is licensed for: every service with a matching ALLOW
// (profession + null/own-state) and no matching DENY. DENY overrides ALLOW so a
// baseline grant can be removed in a single state without per-state ALLOW rows.
async function resolveAllowedServiceIds(args: {
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
    select: { serviceId: true, mode: true },
    take: 10000,
  })

  const denied = new Set<string>()
  const allowed = new Set<string>()
  for (const row of matchingPerms) {
    if (row.mode === 'DENY') denied.add(row.serviceId)
  }
  for (const row of matchingPerms) {
    if (row.mode === 'ALLOW' && !denied.has(row.serviceId)) allowed.add(row.serviceId)
  }
  return allowed
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

  const allowed = await resolveAllowedServiceIds({
    professionType: proProfile.professionType,
    licenseState: proProfile.licenseState,
  })

  // Fail-closed: a service is offerable only if it's explicitly allowed for this
  // license + state. A service with no matching ALLOW is hidden, not open.
  return services.filter((svc) => allowed.has(svc.id)).map(toAllowedServiceDto)
}
