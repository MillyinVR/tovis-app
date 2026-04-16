// lib/smsCountryPolicy.ts
import { parsePhoneNumberFromString } from 'libphonenumber-js'

export type SmsCountryValidationResult =
  | { ok: true; phone: string; countryCode: string | null }
  | {
      ok: false
      code: 'INVALID_PHONE_FORMAT' | 'SMS_COUNTRY_UNSUPPORTED'
      message: string
      countryCode: string | null
    }

export function getSmsAllowedCountries(): string[] {
  const raw = process.env.SMS_ALLOWED_COUNTRIES?.trim() || 'US'

  return raw
    .split(',')
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean)
}

export function validateSmsDestinationCountry(
  phone: string,
): SmsCountryValidationResult {
  const parsed = parsePhoneNumberFromString(phone)

  if (!parsed || !parsed.isValid()) {
    return {
      ok: false,
      code: 'INVALID_PHONE_FORMAT',
      message: 'Enter a valid phone number.',
      countryCode: null,
    }
  }

  const countryCode = parsed.country ?? null
  const allowedCountries = getSmsAllowedCountries()

  if (!countryCode || !allowedCountries.includes(countryCode)) {
    return {
      ok: false,
      code: 'SMS_COUNTRY_UNSUPPORTED',
      message: 'SMS verification is not available for this country yet.',
      countryCode,
    }
  }

  return {
    ok: true,
    phone: parsed.number,
    countryCode,
  }
}