// lib/migration/licensePermissionsImport.ts
//
// Resolves the license-scope tables (lib/migration/licenseScope.ts) against the
// live Service catalog and produces a deterministic plan of ServicePermission
// rows to create. Pure planning logic — the DB side lives in
// scripts/importLicensePermissions.ts so this stays unit-testable with a plain
// in-memory catalog + existing-rows list.

import type { ProfessionType } from '@prisma/client'

import { expandLicenseScope, type PermissionSpec } from './licenseScope'

export type CatalogEntry = { id: string; name: string }

export type ExistingPermission = {
  serviceId: string
  professionType: ProfessionType
  stateCode: string | null
}

export type ResolvedPermission = {
  serviceId: string
  serviceName: string
  professionType: ProfessionType
  stateCode: string | null
}

export type LicensePermissionsPlan = {
  // Rows to create (not already present).
  toCreate: ResolvedPermission[]
  // Rows the scope wants that already exist — counted, not recreated.
  alreadyPresent: number
  // Scope service names with no matching catalog Service. Reported, never
  // silently dropped — a missing service is a catalog gap to fix, not a no-op.
  unmatchedServiceNames: string[]
  // Professions in the scope tables whose service names all failed to resolve.
  professionsWithNoServices: ProfessionType[]
  // Total specs the scope expanded to (for reporting).
  totalSpecs: number
}

function permKey(serviceId: string, professionType: ProfessionType, stateCode: string | null): string {
  return `${serviceId}|${professionType}|${stateCode ?? '*'}`
}

// Catalog names are canonical; match case-insensitively on trimmed name so a
// stray case/whitespace difference in the scope tables doesn't silently drop a
// grant.
function normalizeName(name: string): string {
  return name.trim().toLowerCase()
}

export function planLicensePermissionsImport(args: {
  catalog: CatalogEntry[]
  existing: ExistingPermission[]
  specs?: PermissionSpec[]
}): LicensePermissionsPlan {
  const specs = args.specs ?? expandLicenseScope()

  const catalogByName = new Map<string, CatalogEntry>()
  for (const entry of args.catalog) catalogByName.set(normalizeName(entry.name), entry)

  const existingKeys = new Set<string>()
  for (const row of args.existing) {
    existingKeys.add(permKey(row.serviceId, row.professionType, row.stateCode))
  }

  const toCreate: ResolvedPermission[] = []
  const createdKeys = new Set<string>()
  const unmatched = new Set<string>()
  let alreadyPresent = 0

  // Track which professions resolved at least one service.
  const professionsSeen = new Set<ProfessionType>()
  const professionsResolved = new Set<ProfessionType>()

  for (const spec of specs) {
    professionsSeen.add(spec.professionType)
    const entry = catalogByName.get(normalizeName(spec.serviceName))
    if (!entry) {
      unmatched.add(spec.serviceName)
      continue
    }
    professionsResolved.add(spec.professionType)

    const key = permKey(entry.id, spec.professionType, spec.stateCode)
    if (existingKeys.has(key)) {
      alreadyPresent += 1
      continue
    }
    if (createdKeys.has(key)) continue
    createdKeys.add(key)
    toCreate.push({
      serviceId: entry.id,
      serviceName: entry.name,
      professionType: spec.professionType,
      stateCode: spec.stateCode,
    })
  }

  const professionsWithNoServices = [...professionsSeen]
    .filter((p) => !professionsResolved.has(p))
    .sort()

  return {
    toCreate,
    alreadyPresent,
    unmatchedServiceNames: [...unmatched].sort(),
    professionsWithNoServices,
    totalSpecs: specs.length,
  }
}
