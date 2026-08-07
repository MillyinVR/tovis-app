// lib/licensing/currentlyLicensed.test.ts

import { describe, expect, it } from 'vitest'
import { VerificationStatus } from '@prisma/client'

import {
  getProLicenseStatus,
  isProCurrentlyLicensed,
  type LicenseStatusInput,
} from './currentlyLicensed'

const NOW = new Date('2026-08-06T12:00:00.000Z')

function makePro(overrides?: Partial<LicenseStatusInput>): LicenseStatusInput {
  return {
    professionType: 'COSMETOLOGIST',
    licenseState: 'CA',
    verificationStatus: VerificationStatus.APPROVED,
    licenseVerified: true,
    licenseExpiry: new Date('2027-01-01T00:00:00.000Z'),
    ...(overrides ?? {}),
  }
}

describe('getProLicenseStatus', () => {
  it('is CURRENT for an approved, verified pro whose license has not expired', () => {
    expect(getProLicenseStatus(makePro(), NOW)).toBe('CURRENT')
    expect(isProCurrentlyLicensed(makePro(), NOW)).toBe(true)
  })

  it('is CURRENT (not EXPIRED) when licenseExpiry is null — legacy rows with no expiry on file', () => {
    const pro = makePro({ licenseExpiry: null })
    expect(getProLicenseStatus(pro, NOW)).toBe('CURRENT')
    expect(isProCurrentlyLicensed(pro, NOW)).toBe(true)
  })

  it('is EXPIRED once licenseExpiry has passed', () => {
    const pro = makePro({ licenseExpiry: new Date('2026-08-01T00:00:00.000Z') })
    expect(getProLicenseStatus(pro, NOW)).toBe('EXPIRED')
    expect(isProCurrentlyLicensed(pro, NOW)).toBe(false)
  })

  it('is EXPIRED at the exact expiry instant (boundary is inclusive)', () => {
    const pro = makePro({ licenseExpiry: NOW })
    expect(getProLicenseStatus(pro, NOW)).toBe('EXPIRED')
  })

  it('is CURRENT one millisecond before expiry', () => {
    const pro = makePro({ licenseExpiry: new Date(NOW.getTime() + 1) })
    expect(getProLicenseStatus(pro, NOW)).toBe('CURRENT')
  })

  it('is UNVERIFIED when verificationStatus is not APPROVED, even if licenseVerified is true', () => {
    const pro = makePro({ verificationStatus: VerificationStatus.PENDING })
    expect(getProLicenseStatus(pro, NOW)).toBe('UNVERIFIED')
    expect(isProCurrentlyLicensed(pro, NOW)).toBe(false)
  })

  it('is UNVERIFIED when licenseVerified is false, even if APPROVED', () => {
    const pro = makePro({ licenseVerified: false })
    expect(getProLicenseStatus(pro, NOW)).toBe('UNVERIFIED')
  })

  it('is NOT_REQUIRED for an exempt profession, regardless of verification state', () => {
    const pro = makePro({
      professionType: 'MAKEUP_ARTIST',
      licenseState: 'CA',
      verificationStatus: VerificationStatus.APPROVED,
      licenseVerified: true,
      licenseExpiry: new Date('2020-01-01T00:00:00.000Z'), // long expired — still irrelevant
    })
    expect(getProLicenseStatus(pro, NOW)).toBe('NOT_REQUIRED')
    expect(isProCurrentlyLicensed(pro, NOW)).toBe(false)
  })

  it('is NOT_REQUIRED when professionType is null', () => {
    const pro = makePro({ professionType: null })
    expect(getProLicenseStatus(pro, NOW)).toBe('NOT_REQUIRED')
  })

  it('renewal: a later expiry date makes an EXPIRED pro CURRENT again on the very next read', () => {
    const expired = makePro({ licenseExpiry: new Date('2026-08-01T00:00:00.000Z') })
    expect(getProLicenseStatus(expired, NOW)).toBe('EXPIRED')

    const renewed = { ...expired, licenseExpiry: new Date('2028-01-01T00:00:00.000Z') }
    expect(getProLicenseStatus(renewed, NOW)).toBe('CURRENT')
  })
})
