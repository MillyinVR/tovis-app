// lib/migration/licenseScope.test.ts

import { describe, expect, it } from 'vitest'

import {
  expandLicenseScope,
  referencedServiceNames,
  US_JURISDICTIONS,
} from './licenseScope'

const LASH_SERVICES = [
  'Classic Lash Full Set',
  'Volume Lash Full Set',
  'Lash Fill',
  'Lash Lift',
]

describe('expandLicenseScope', () => {
  const specs = expandLicenseScope()

  it('emits no duplicate (service, profession, state, mode) specs', () => {
    const keys = specs.map(
      (s) => `${s.serviceName}|${s.professionType}|${s.stateCode ?? '*'}|${s.mode}`,
    )
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('grants the baseline as nationwide ALLOW (null-state) rows', () => {
    expect(specs).toContainEqual({
      serviceName: 'Balayage',
      professionType: 'COSMETOLOGIST',
      stateCode: null,
      mode: 'ALLOW',
    })
    expect(specs).toContainEqual({
      serviceName: 'Balayage',
      professionType: 'HAIRSTYLIST',
      stateCode: null,
      mode: 'ALLOW',
    })
  })

  it('gives LASH_TECHNICIAN lash nationwide (ALLOW, null)', () => {
    for (const name of LASH_SERVICES) {
      expect(specs).toContainEqual({
        serviceName: name,
        professionType: 'LASH_TECHNICIAN',
        stateCode: null,
        mode: 'ALLOW',
      })
    }
  })

  describe('lash carve-out (AZ only) via baseline + DENY', () => {
    for (const profession of ['COSMETOLOGIST', 'ESTHETICIAN'] as const) {
      it(`${profession}: lash is one nationwide ALLOW + one AZ DENY (no per-state explosion)`, () => {
        for (const name of LASH_SERVICES) {
          const rows = specs.filter(
            (s) => s.serviceName === name && s.professionType === profession,
          )
          // Exactly two rows: the baseline grant and the AZ removal.
          expect(rows).toHaveLength(2)
          expect(rows).toContainEqual({
            serviceName: name,
            professionType: profession,
            stateCode: null,
            mode: 'ALLOW',
          })
          expect(rows).toContainEqual({
            serviceName: name,
            professionType: profession,
            stateCode: 'AZ',
            mode: 'DENY',
          })
        }
      })
    }

    it('does NOT deny lash in MD/MN/TN/TX/UT (kept within cosmo/esth scope)', () => {
      const denies = specs.filter((s) => s.mode === 'DENY' && s.stateCode !== 'AZ')
      expect(denies).toEqual([])
    })

    it('never expands a rule across all jurisdictions', () => {
      // The whole point of DENY: no (profession, service) pair fans out to one
      // row per state. The widest case is lash = ALLOW(null) + DENY(AZ) = 2.
      const perPair = new Map<string, number>()
      for (const s of specs) {
        const k = `${s.professionType}|${s.serviceName}`
        perPair.set(k, (perPair.get(k) ?? 0) + 1)
      }
      const widest = Math.max(...perPair.values())
      expect(widest).toBeLessThanOrEqual(2)
      // Sanity: far below a per-state expansion of any single rule.
      expect(specs.length).toBeLessThan(US_JURISDICTIONS.length * 2)
    })
  })

  it('grants AZ barbers the broader skin scope (facial + wax) as AZ-only ALLOW rows', () => {
    expect(specs).toContainEqual({
      serviceName: 'Classic Facial',
      professionType: 'BARBER',
      stateCode: 'AZ',
      mode: 'ALLOW',
    })
    expect(specs).toContainEqual({
      serviceName: 'Brazilian Wax',
      professionType: 'BARBER',
      stateCode: 'AZ',
      mode: 'ALLOW',
    })
  })

  it('gates the new specialty services to their license types', () => {
    expect(specs).toContainEqual({
      serviceName: 'Microblading',
      professionType: 'PERMANENT_MAKEUP_ARTIST',
      stateCode: null,
      mode: 'ALLOW',
    })
    expect(specs).toContainEqual({
      serviceName: 'Box Braids',
      professionType: 'HAIR_BRAIDER',
      stateCode: null,
      mode: 'ALLOW',
    })
    expect(specs).toContainEqual({
      serviceName: 'Electrolysis',
      professionType: 'ELECTROLOGIST',
      stateCode: null,
      mode: 'ALLOW',
    })
  })
})

describe('referencedServiceNames', () => {
  it('includes the Phase 2 additions', () => {
    const names = referencedServiceNames()
    expect(names).toContain('Microblading')
    expect(names).toContain('Box Braids')
    expect(names).toContain('Electrolysis')
  })
})
