// lib/licensing/caDcaLicense.test.ts
import { describe, expect, it } from 'vitest'

import {
  canonicalLicenseNumber,
  dcaLicenseQueryNumber,
  isCurrentStatusCode,
  licenseNumbersMatch,
  parseDcaLicenseRecord,
} from './caDcaLicense'

describe('dcaLicenseQueryNumber', () => {
  it('sends only the numeric portion for a printed "<prefix><digits>" license', () => {
    // BBC: "the license number will not include the letter(s) in your license".
    expect(dcaLicenseQueryNumber('C123456')).toBe('123456')
    expect(dcaLicenseQueryNumber('KK123456')).toBe('123456')
    expect(dcaLicenseQueryNumber('z 123456')).toBe('123456')
    expect(dcaLicenseQueryNumber('C-123 456')).toBe('123456')
  })

  it('keeps leading zeros — a zero may be part of the real number', () => {
    expect(dcaLicenseQueryNumber('C0123456')).toBe('0123456')
    expect(dcaLicenseQueryNumber('0123456')).toBe('0123456')
  })

  it('leaves an unrecognised shape alone rather than mangling it', () => {
    expect(dcaLicenseQueryNumber('AB12CD34')).toBe('AB12CD34')
    expect(dcaLicenseQueryNumber('')).toBe('')
  })
})

describe('canonicalLicenseNumber / licenseNumbersMatch', () => {
  it('treats prefix, punctuation, spacing and leading zeros as the same license', () => {
    const forms = ['C123456', '123456', '0123456', 'c-123 456', 'C 0123456']
    for (const form of forms) {
      expect(canonicalLicenseNumber(form)).toBe('123456')
    }

    expect(licenseNumbersMatch('C-123456', '123456')).toBe(true)
    expect(licenseNumbersMatch('0123456', 'C123456')).toBe(true)
    expect(licenseNumbersMatch('z 123456', 'Z123456')).toBe(true)
  })

  it('does not collapse genuinely different numbers', () => {
    expect(licenseNumbersMatch('Z123456', '999999')).toBe(false)
    expect(licenseNumbersMatch('C123456', 'C1234567')).toBe(false)
  })

  it('never matches when either side is empty', () => {
    expect(licenseNumbersMatch('', '')).toBe(false)
    expect(licenseNumbersMatch('C123456', '')).toBe(false)
    expect(licenseNumbersMatch('', '123456')).toBe(false)
    // An all-zero number reduces to "0", not to the empty string.
    expect(canonicalLicenseNumber('000')).toBe('0')
  })
})

describe('parseDcaLicenseRecord', () => {
  const wellFormed = {
    licenseDetails: [
      {
        getFullLicenseDetail: [
          {
            getLicenseDetails: [
              {
                licNumber: 'z123456',
                primaryStatusCode: 'CURRENT',
                expDate: '2027-01-01',
                issueDate: '2019-05-05',
              },
            ],
          },
        ],
      },
    ],
  }

  it('reads a well-formed record', () => {
    expect(parseDcaLicenseRecord(wellFormed)).toEqual({
      licNumber: 'Z123456',
      statusCode: 'CURRENT',
      expDate: '2027-01-01',
      issueDate: '2019-05-05',
    })
  })

  it('returns null for anything that is not a readable license record', () => {
    // Each of these is a 200 body in practice — none is evidence about a license.
    expect(parseDcaLicenseRecord({})).toBeNull()
    expect(parseDcaLicenseRecord(null)).toBeNull()
    expect(parseDcaLicenseRecord('<html>502 Bad Gateway</html>')).toBeNull()
    expect(parseDcaLicenseRecord({ message: 'Service unavailable' })).toBeNull()
    expect(parseDcaLicenseRecord({ licenseDetails: [] })).toBeNull()
    expect(parseDcaLicenseRecord({ licenseDetails: [{}] })).toBeNull()
    expect(
      parseDcaLicenseRecord({
        licenseDetails: [{ getFullLicenseDetail: [{ getLicenseDetails: [] }] }],
      }),
    ).toBeNull()
  })

  it('returns null when the record carries no status code to judge', () => {
    expect(
      parseDcaLicenseRecord({
        licenseDetails: [
          {
            getFullLicenseDetail: [
              { getLicenseDetails: [{ licNumber: 'Z123456' }] },
            ],
          },
        ],
      }),
    ).toBeNull()

    expect(
      parseDcaLicenseRecord({
        licenseDetails: [
          {
            getFullLicenseDetail: [
              {
                getLicenseDetails: [
                  { licNumber: 'Z123456', primaryStatusCode: '   ' },
                ],
              },
            ],
          },
        ],
      }),
    ).toBeNull()
  })

  it('keeps a record whose number is missing — the status is still readable', () => {
    const parsed = parseDcaLicenseRecord({
      licenseDetails: [
        {
          getFullLicenseDetail: [
            { getLicenseDetails: [{ primaryStatusCode: 'CURRENT' }] },
          ],
        },
      ],
    })

    expect(parsed).toEqual({
      licNumber: null,
      statusCode: 'CURRENT',
      expDate: null,
      issueDate: null,
    })
  })
})

describe('isCurrentStatusCode', () => {
  it('accepts the CURRENT variants and rejects the rest', () => {
    expect(isCurrentStatusCode('CURRENT')).toBe(true)
    expect(isCurrentStatusCode('current')).toBe(true)
    expect(isCurrentStatusCode('CURRENT - ACTIVE')).toBe(true)
    expect(isCurrentStatusCode('EXPIRED')).toBe(false)
    expect(isCurrentStatusCode('REVOKED')).toBe(false)
    expect(isCurrentStatusCode('SUSPENDED')).toBe(false)
  })
})
