// lib/security/contactNormalization.ts

/**
 * Canonical contact normalization helpers.
 *
 * These functions are intentionally strict and boring:
 * - return `null` for missing/invalid values
 * - return normalized strings for values safe to hash, compare, or store as lookup keys
 * - do not throw for user input
 *
 * Keep all email/phone normalization in this file. Do not add route-local
 * email/phone normalization helpers elsewhere. Domain-specific helpers may
 * exist only as thin delegates to this module.
 */

const MAX_EMAIL_LENGTH = 254
const MAX_PHONE_DIGITS = 15
const MIN_INTERNATIONAL_PHONE_DIGITS = 8
const NANP_DIGIT_LENGTH = 10
const NANP_COUNTRY_CODE = '1'

const CONTROL_CHARS_PATTERN = /[\x00-\x1F\x7F]/u
const WHITESPACE_PATTERN = /\s/u
const EMAIL_AT_PATTERN = /@/gu

/**
 * We intentionally reject phone strings with letters instead of stripping them.
 * Silently turning "555-FLOWERS" into digits would require keypad mapping and
 * would make lookup hashes less predictable.
 */
const PHONE_ALPHA_PATTERN = /[A-Za-z]/u

/**
 * Common extension markers. If a user submits an extension, the base phone
 * number may still be valid, but storing/hash-normalizing the extension-less
 * number from this raw string would be surprising. Require callers to provide
 * the base number separately.
 */
const PHONE_EXTENSION_PATTERN =
  /(?:^|[\s,;])(?:ext\.?|extension|x)\s*\d+\s*$/iu

export type NormalizedContactInput = {
  email: string | null
  phone: string | null
}

export type ContactLookupKind = 'EMAIL' | 'PHONE'

/**
 * Normalizes user-supplied email for lookup/hash usage.
 *
 * Policy:
 * - trims leading/trailing whitespace, including common Unicode whitespace
 * - lowercases
 * - rejects empty values
 * - rejects values longer than 254 chars
 * - requires exactly one `@`
 * - requires non-empty local and domain parts
 * - requires at least one dot in the domain
 * - rejects obvious whitespace/control characters inside the address
 * - rejects leading/trailing dots and repeated dots in local/domain parts
 *
 * This is not intended to prove an email is deliverable. It is intended to
 * produce one stable lookup representation or `null`.
 */
export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null

  const normalized = value.trim().toLowerCase()

  if (normalized.length === 0) return null
  if (normalized.length > MAX_EMAIL_LENGTH) return null
  if (CONTROL_CHARS_PATTERN.test(normalized)) return null
  if (WHITESPACE_PATTERN.test(normalized)) return null

  const atMatches = normalized.match(EMAIL_AT_PATTERN)
  if (!atMatches || atMatches.length !== 1) return null

  const [localPart, domainPart] = normalized.split('@')

  if (!isValidEmailPart(localPart)) return null
  if (!isValidEmailDomain(domainPart)) return null

  return normalized
}

/**
 * Delegate for observability/auth event hashing.
 *
 * Auth telemetry must use the same canonical contact value as auth lookup
 * hashes, otherwise event correlation and privacy review drift.
 */
export function normalizePhoneForHash(value: unknown): string | null {
  return normalizePhone(value)
}
/**
 * Normalizes user-supplied phone values for lookup/hash usage.
 *
 * Policy:
 * - rejects alphabetic input and extension-bearing strings
 * - strips non-digit separators from otherwise numeric-looking values
 * - accepts 10-digit NANP numbers and prefixes +1
 * - accepts 11-digit NANP numbers starting with 1 and prefixes +
 * - accepts other international-looking numbers between 8 and 15 digits
 * - rejects too-short, too-long, or all-zero values
 *
 * Returned value is always E.164-like: `+<digits>`.
 *
 * Note: this is intentionally dependency-free. If the app later adopts
 * libphonenumber-js, keep this wrapper as the canonical boundary and delegate
 * internally rather than changing callers.
 */
export function normalizePhone(value: unknown): string | null {
  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  if (PHONE_ALPHA_PATTERN.test(trimmed)) return null
  if (PHONE_EXTENSION_PATTERN.test(trimmed)) return null

  const digits = trimmed.replace(/\D/gu, '')

  if (!isUsablePhoneDigits(digits)) return null

  if (digits.length === NANP_DIGIT_LENGTH) {
    return `+${NANP_COUNTRY_CODE}${digits}`
  }

  if (
    digits.length === NANP_DIGIT_LENGTH + 1 &&
    digits.startsWith(NANP_COUNTRY_CODE)
  ) {
    return `+${digits}`
  }

  if (
    digits.length >= MIN_INTERNATIONAL_PHONE_DIGITS &&
    digits.length <= MAX_PHONE_DIGITS
  ) {
    return `+${digits}`
  }

  return null
}

/**
 * Normalizes contact fields from an object boundary.
 *
 * Use this when callers receive a larger args/body object and need both email
 * and phone normalized with one canonical contract.
 */
export function normalizeContactInput(args: {
  email?: unknown
  phone?: unknown
}): NormalizedContactInput {
  return {
    email: normalizeEmail(args.email),
    phone: normalizePhone(args.phone),
  }
}

/**
 * Normalizes a contact value by lookup kind.
 */
export function normalizeContactForLookup(
  kind: ContactLookupKind,
  value: unknown,
): string | null {
  switch (kind) {
    case 'EMAIL':
      return normalizeEmail(value)
    case 'PHONE':
      return normalizePhone(value)
  }
}

/**
 * Legacy/domain delegate for lookup hashing.
 *
 * Keep this here so older call sites can migrate without keeping their own
 * normalization implementation in hashLookup.ts.
 */
export function normalizeEmailForLookup(value: unknown): string | null {
  return normalizeEmail(value)
}

/**
 * Legacy/domain delegate for lookup hashing.
 *
 * Keep this here so older call sites can migrate without keeping their own
 * normalization implementation in hashLookup.ts.
 */
export function normalizePhoneForLookup(value: unknown): string | null {
  return normalizePhone(value)
}

/**
 * Delegate for observability/auth event hashing.
 *
 * Auth telemetry must use the same canonical contact value as auth lookup
 * hashes, otherwise event correlation and privacy review drift.
 */
export function normalizeEmailForHash(value: unknown): string | null {
  return normalizeEmail(value)
}

/**
 * Delegate for phone verification flows.
 *
 * Verification, login, settings, and lookup hashing must agree on exactly one
 * canonical phone representation.
 */
export function normalizePhoneForVerification(value: unknown): string | null {
  return normalizePhone(value)
}

/**
 * Returns true when the normalized value is a usable email lookup key.
 */
export function isNormalizedEmail(value: unknown): value is string {
  return typeof value === 'string' && normalizeEmail(value) === value
}

/**
 * Returns true when the normalized value is a usable phone lookup key.
 */
export function isNormalizedPhone(value: unknown): value is string {
  return typeof value === 'string' && normalizePhone(value) === value
}

function isValidEmailPart(value: string | undefined): value is string {
  if (!value) return false
  if (value.startsWith('.') || value.endsWith('.')) return false
  if (value.includes('..')) return false

  return true
}

function isValidEmailDomain(value: string | undefined): value is string {
  if (!isValidEmailPart(value)) return false
  if (!value.includes('.')) return false

  return true
}

function isUsablePhoneDigits(digits: string): boolean {
  if (digits.length === 0) return false
  if (digits.length > MAX_PHONE_DIGITS) return false
  if (/^0+$/u.test(digits)) return false

  return true
}