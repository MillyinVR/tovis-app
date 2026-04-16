import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ORIGINAL_ENV = { ...process.env }

async function loadSubject() {
  vi.resetModules()
  return await import('./smsCountryPolicy')
}

describe('lib/smsCountryPolicy', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
    vi.restoreAllMocks()
  })

  it('defaults allowed countries to US when env is not set', async () => {
    delete process.env.SMS_ALLOWED_COUNTRIES

    const { getSmsAllowedCountries } = await loadSubject()

    expect(getSmsAllowedCountries()).toEqual(['US'])
  })

  it('parses and normalizes a comma-separated allow-list from env', async () => {
    process.env.SMS_ALLOWED_COUNTRIES = 'us, ca , MX'

    const { getSmsAllowedCountries } = await loadSubject()

    expect(getSmsAllowedCountries()).toEqual(['US', 'CA', 'MX'])
  })

  it('allows a valid US number when US is in the allow-list', async () => {
    process.env.SMS_ALLOWED_COUNTRIES = 'US'

    const { validateSmsDestinationCountry } = await loadSubject()

    const result = validateSmsDestinationCountry('+12133734253')

    expect(result).toEqual({
      ok: true,
      phone: '+12133734253',
      countryCode: 'US',
    })
  })

  it('allows a valid CA number when CA is in the allow-list', async () => {
    process.env.SMS_ALLOWED_COUNTRIES = 'US,CA'

    const { validateSmsDestinationCountry } = await loadSubject()

    const result = validateSmsDestinationCountry('+14165550123')

    expect(result).toEqual({
      ok: true,
      phone: '+14165550123',
      countryCode: 'CA',
    })
  })

  it('returns SMS_COUNTRY_UNSUPPORTED for a valid number outside the allow-list', async () => {
    process.env.SMS_ALLOWED_COUNTRIES = 'US'

    const { validateSmsDestinationCountry } = await loadSubject()

    const result = validateSmsDestinationCountry('+442079460123')

    expect(result).toEqual({
      ok: false,
      code: 'SMS_COUNTRY_UNSUPPORTED',
      message: 'SMS verification is not available for this country yet.',
      countryCode: 'GB',
    })
  })

  it('returns INVALID_PHONE_FORMAT for an invalid phone number', async () => {
    process.env.SMS_ALLOWED_COUNTRIES = 'US,CA'

    const { validateSmsDestinationCountry } = await loadSubject()

    const result = validateSmsDestinationCountry('not-a-phone')

    expect(result).toEqual({
      ok: false,
      code: 'INVALID_PHONE_FORMAT',
      message: 'Enter a valid phone number.',
      countryCode: null,
    })
  })

  it('returns INVALID_PHONE_FORMAT for an empty phone value', async () => {
    process.env.SMS_ALLOWED_COUNTRIES = 'US'

    const { validateSmsDestinationCountry } = await loadSubject()

    const result = validateSmsDestinationCountry('')

    expect(result).toEqual({
      ok: false,
      code: 'INVALID_PHONE_FORMAT',
      message: 'Enter a valid phone number.',
      countryCode: null,
    })
  })
})