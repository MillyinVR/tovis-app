// lib/licensing/licenseRequirement.test.ts

import { describe, expect, it } from 'vitest'

import {
  getLicenseRequirement,
  requiresLicense,
  supportsOnlineVerification,
} from './licenseRequirement'

describe('getLicenseRequirement', () => {
  it('treats the core BBC professions as LICENSED in every state', () => {
    for (const state of ['CA', 'AZ', 'NY', 'TX']) {
      expect(getLicenseRequirement('COSMETOLOGIST', state)).toBe('LICENSED')
      expect(getLicenseRequirement('ESTHETICIAN', state)).toBe('LICENSED')
      expect(getLicenseRequirement('ELECTROLOGIST', state)).toBe('LICENSED')
    }
  })

  it('treats makeup artists as EXEMPT everywhere', () => {
    expect(getLicenseRequirement('MAKEUP_ARTIST', 'CA')).toBe('EXEMPT')
    expect(getLicenseRequirement('MAKEUP_ARTIST', 'NY')).toBe('EXEMPT')
  })

  describe('lash technician', () => {
    it('is LICENSED in standalone-license states', () => {
      for (const state of ['AZ', 'CT', 'KY', 'MD', 'MN', 'OK', 'TN', 'TX', 'UT']) {
        expect(getLicenseRequirement('LASH_TECHNICIAN', state)).toBe('LICENSED')
      }
    })
    it('is EXEMPT where lash sits within esthetician scope', () => {
      for (const state of ['CA', 'NY', 'FL', 'GA']) {
        expect(getLicenseRequirement('LASH_TECHNICIAN', state)).toBe('EXEMPT')
      }
    })
  })

  describe('hair braider', () => {
    it('is LICENSED in states that still license braiding', () => {
      for (const state of ['LA', 'NV', 'NJ', 'NY', 'OH']) {
        expect(getLicenseRequirement('HAIR_BRAIDER', state)).toBe('LICENSED')
      }
    })
    it('is REGISTERED in MS/SC', () => {
      expect(getLicenseRequirement('HAIR_BRAIDER', 'MS')).toBe('REGISTERED')
      expect(getLicenseRequirement('HAIR_BRAIDER', 'SC')).toBe('REGISTERED')
    })
    it('is EXEMPT in deregulated states', () => {
      for (const state of ['TX', 'CA', 'PA', 'WA']) {
        expect(getLicenseRequirement('HAIR_BRAIDER', state)).toBe('EXEMPT')
      }
    })
  })

  it('licenses PMU only where the cosmetology board issues it', () => {
    expect(getLicenseRequirement('PERMANENT_MAKEUP_ARTIST', 'VA')).toBe('LICENSED')
    expect(getLicenseRequirement('PERMANENT_MAKEUP_ARTIST', 'AK')).toBe('LICENSED')
    expect(getLicenseRequirement('PERMANENT_MAKEUP_ARTIST', 'CA')).toBe('EXEMPT')
  })

  it('falls back to the baseline for an unknown/empty state', () => {
    expect(getLicenseRequirement('COSMETOLOGIST', null)).toBe('LICENSED')
    expect(getLicenseRequirement('LASH_TECHNICIAN', 'ZZ')).toBe('EXEMPT')
  })
})

describe('requiresLicense', () => {
  it('is true for LICENSED and REGISTERED, false for EXEMPT', () => {
    expect(requiresLicense('COSMETOLOGIST', 'CA')).toBe(true)
    expect(requiresLicense('HAIR_BRAIDER', 'SC')).toBe(true) // REGISTERED
    expect(requiresLicense('LASH_TECHNICIAN', 'CA')).toBe(false)
    expect(requiresLicense('MAKEUP_ARTIST', 'NY')).toBe(false)
  })
})

describe('supportsOnlineVerification', () => {
  it('only CA core BBC professions can auto-verify', () => {
    expect(supportsOnlineVerification('COSMETOLOGIST', 'CA')).toBe(true)
    expect(supportsOnlineVerification('COSMETOLOGIST', 'NY')).toBe(false)
    expect(supportsOnlineVerification('LASH_TECHNICIAN', 'CA')).toBe(false)
    expect(supportsOnlineVerification('MAKEUP_ARTIST', 'CA')).toBe(false)
  })
})
