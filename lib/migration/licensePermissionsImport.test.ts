// lib/migration/licensePermissionsImport.test.ts

import { describe, expect, it } from 'vitest'

import {
  planLicensePermissionsImport,
  type CatalogEntry,
} from './licensePermissionsImport'
import { referencedServiceNames } from './licenseScope'

// A catalog covering every name the scope references — the happy path.
function fullCatalog(): CatalogEntry[] {
  return referencedServiceNames().map((name, i) => ({ id: `svc_${i}`, name }))
}

describe('planLicensePermissionsImport', () => {
  it('plans a create for every expanded spec when nothing exists yet', () => {
    const plan = planLicensePermissionsImport({ catalog: fullCatalog(), existing: [] })
    expect(plan.unmatchedServiceNames).toEqual([])
    expect(plan.professionsWithNoServices).toEqual([])
    expect(plan.alreadyPresent).toBe(0)
    expect(plan.toCreate.length).toBe(plan.totalSpecs)
  })

  it('does not recreate rows that already exist', () => {
    const catalog = fullCatalog()
    const plan = planLicensePermissionsImport({ catalog, existing: [] })
    const half = plan.toCreate.slice(0, 10).map((r) => ({
      serviceId: r.serviceId,
      professionType: r.professionType,
      stateCode: r.stateCode,
      mode: r.mode,
    }))

    const replan = planLicensePermissionsImport({ catalog, existing: half })
    expect(replan.alreadyPresent).toBe(10)
    expect(replan.toCreate.length).toBe(plan.toCreate.length - 10)
  })

  it('is fully idempotent — re-running against its own output yields nothing to create', () => {
    const catalog = fullCatalog()
    const first = planLicensePermissionsImport({ catalog, existing: [] })
    const existing = first.toCreate.map((r) => ({
      serviceId: r.serviceId,
      professionType: r.professionType,
      stateCode: r.stateCode,
      mode: r.mode,
    }))
    const second = planLicensePermissionsImport({ catalog, existing })
    expect(second.toCreate).toEqual([])
    expect(second.alreadyPresent).toBe(first.toCreate.length)
  })

  it('reports unmatched service names instead of silently dropping them', () => {
    // Drop Microblading from the catalog.
    const catalog = fullCatalog().filter((e) => e.name !== 'Microblading')
    const plan = planLicensePermissionsImport({ catalog, existing: [] })
    expect(plan.unmatchedServiceNames).toContain('Microblading')
    // PMU artist's only service is Microblading → it resolves to nothing.
    expect(plan.professionsWithNoServices).toContain('PERMANENT_MAKEUP_ARTIST')
    // No row was created for the missing service.
    expect(plan.toCreate.some((r) => r.serviceName === 'Microblading')).toBe(false)
  })

  it('matches catalog names case- and whitespace-insensitively', () => {
    const catalog = referencedServiceNames().map((name, i) => ({
      id: `svc_${i}`,
      name: `  ${name.toUpperCase()}  `,
    }))
    const plan = planLicensePermissionsImport({ catalog, existing: [] })
    expect(plan.unmatchedServiceNames).toEqual([])
  })
})
