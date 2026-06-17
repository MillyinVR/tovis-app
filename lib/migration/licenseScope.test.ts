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

  it('emits no duplicate (service, profession, state) specs', () => {
    const keys = specs.map((s) => `${s.serviceName}|${s.professionType}|${s.stateCode ?? '*'}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('grants the baseline as null-state (all-jurisdiction) rows', () => {
    const balayage = specs.filter((s) => s.serviceName === 'Balayage')
    expect(balayage).toContainEqual({
      serviceName: 'Balayage',
      professionType: 'COSMETOLOGIST',
      stateCode: null,
    })
    // Hairstylist keeps hair; cosmetologist keeps hair — both nationwide.
    expect(balayage).toContainEqual({
      serviceName: 'Balayage',
      professionType: 'HAIRSTYLIST',
      stateCode: null,
    })
  })

  it('gives LASH_TECHNICIAN lash nationwide (null row)', () => {
    for (const name of LASH_SERVICES) {
      expect(specs).toContainEqual({
        serviceName: name,
        professionType: 'LASH_TECHNICIAN',
        stateCode: null,
      })
    }
  })

  describe('lash carve-out (AZ only)', () => {
    for (const profession of ['COSMETOLOGIST', 'ESTHETICIAN'] as const) {
      it(`grants ${profession} lash in every jurisdiction except AZ — and never a null row`, () => {
        for (const name of LASH_SERVICES) {
          const rows = specs.filter(
            (s) => s.serviceName === name && s.professionType === profession,
          )
          // No nationwide (null) row — it's state-expanded.
          expect(rows.some((r) => r.stateCode === null)).toBe(false)
          // No AZ row.
          expect(rows.some((r) => r.stateCode === 'AZ')).toBe(false)
          // One row per allowed jurisdiction (50 states + DC, minus AZ).
          const states = rows.map((r) => r.stateCode).sort()
          const expected = US_JURISDICTIONS.filter((j) => j !== 'AZ').sort()
          expect(states).toEqual([...expected])
        }
      })
    }

    it('keeps lash within cosmo/esth scope in MD/MN/TN/TX/UT (NOT excluded)', () => {
      for (const state of ['MD', 'MN', 'TN', 'TX', 'UT']) {
        expect(specs).toContainEqual({
          serviceName: 'Lash Lift',
          professionType: 'COSMETOLOGIST',
          stateCode: state,
        })
      }
    })
  })

  it('grants AZ barbers the broader skin scope (facial + wax) as AZ-only rows', () => {
    expect(specs).toContainEqual({
      serviceName: 'Classic Facial',
      professionType: 'BARBER',
      stateCode: 'AZ',
    })
    expect(specs).toContainEqual({
      serviceName: 'Brazilian Wax',
      professionType: 'BARBER',
      stateCode: 'AZ',
    })
    // Barbers do NOT get facials anywhere else.
    const barberFacial = specs.filter(
      (s) => s.serviceName === 'Classic Facial' && s.professionType === 'BARBER',
    )
    expect(barberFacial).toHaveLength(1)
  })

  it('gates the new specialty services to their license types', () => {
    expect(specs).toContainEqual({
      serviceName: 'Microblading',
      professionType: 'PERMANENT_MAKEUP_ARTIST',
      stateCode: null,
    })
    expect(specs).toContainEqual({
      serviceName: 'Box Braids',
      professionType: 'HAIR_BRAIDER',
      stateCode: null,
    })
    expect(specs).toContainEqual({
      serviceName: 'Electrolysis',
      professionType: 'ELECTROLOGIST',
      stateCode: null,
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
