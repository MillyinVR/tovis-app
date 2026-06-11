// lib/phoneInputFormat.ts
//
// Display-side phone formatting for signup/login inputs. Formats NANP
// numbers as the user types — "(619) 555-1234" / "+1 (619) 555-1234" — and
// leaves international (+ prefix, non-NANP) input as plain digits. The
// canonical parser stays lib/security/contactNormalization.normalizePhone;
// this module only shapes what the user sees, and everything it produces
// normalizes cleanly there.

const MAX_INTERNATIONAL_DIGITS = 15
const NANP_DIGITS = 10

function digitsOnly(value: string): string {
  return value.replace(/\D/gu, '')
}

export function formatPhoneInputValue(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''

  const startsWithPlus = trimmed.startsWith('+')
  const digits = digitsOnly(trimmed)

  if (startsWithPlus && !digits.startsWith('1')) {
    // International: no grouping rules we can safely guess.
    return digits ? `+${digits.slice(0, MAX_INTERNATIONAL_DIGITS)}` : '+'
  }

  let prefix = ''
  let national = digits

  if (startsWithPlus || (digits.length > NANP_DIGITS && digits.startsWith('1'))) {
    prefix = '+1 '
    national = digits.replace(/^1/, '')
  }

  national = national.slice(0, NANP_DIGITS)

  if (!national) return prefix.trimEnd()
  if (national.length < 4) return `${prefix}(${national}`
  if (national.length < 7) {
    return `${prefix}(${national.slice(0, 3)}) ${national.slice(3)}`
  }
  return `${prefix}(${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`
}

/**
 * Collapses a display-formatted phone value into the compact form the
 * signup/login APIs receive — digits with an optional leading `+`. The
 * canonical parse still happens server-side via normalizePhone.
 */
export function compactPhoneInputForSubmit(value: string): string {
  const compact = digitsOnly(value)
  if (!compact) return ''
  return value.trim().startsWith('+') ? `+${compact}` : compact
}

/**
 * Light client-side plausibility check so forms can flag obviously short
 * numbers inline before submit. The server remains authoritative.
 */
export function isLikelyValidPhoneInput(raw: string): boolean {
  const trimmed = raw.trim()
  if (!trimmed) return false

  const digits = digitsOnly(trimmed)

  if (trimmed.startsWith('+') && !digits.startsWith('1')) {
    return digits.length >= 8 && digits.length <= MAX_INTERNATIONAL_DIGITS
  }

  const national = digits.replace(/^1/, '')
  return national.length === NANP_DIGITS
}
