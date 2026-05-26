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
 * normalizeEmail/normalizePhone helpers elsewhere.
 */

const MAX_EMAIL_LENGTH = 254
const MAX_PHONE_DIGITS = 15
const NANP_DIGIT_LENGTH = 10
const NANP_COUNTRY_CODE = '1'

export type NormalizedContactInput = {
  email: string | null
  phone: string | null
}

/**
 * Normalizes user-supplied email for lookup/hash usage.
 *
 * Policy:
 * - trims leading/trailing whitespace, including common unicode whitespace
 * - lowercases
 * - rejects empty values
 * - rejects values longer than 254 chars
 * - requires exactly one `@`
 * - requires non-empty local and domain parts
 * - requires at least one dot in the domain
 * - rejects obvious whitespace/control characters inside the address
 *
 * This is not intended to prove an email is deliverable. It is intended to
 * produce one stable lookup representation or `null`.
 */
export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null

  const normalized = value.trim().toLowerCase()

  if (normalized.length === 0) return null
  if (normalized.length > MAX_EMAIL_LENGTH) return null
  if (/[\s\x00-\x1F\x7F]/u.test(normalized)) return null

  const atMatches = normalized.match(/@/gu)
  if (!atMatches || atMatches.length !== 1) return null

  const [localPart, domainPart] = normalized.split('@')

  if (!localPart || !domainPart) return null
  if (localPart.startsWith('.') || localPart.endsWith('.')) return null
  if (localPart.includes('..')) return null
  if (domainPart.startsWith('.') || domainPart.endsWith('.')) return null
  if (domainPart.includes('..')) return null
  if (!domainPart.includes('.')) return null

  return normalized
}

/**
 * Normalizes user-supplied phone values for lookup/hash usage.
 *
 * Policy:
 * - strips all non-digits
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

  const digits = value.replace(/\D/gu, '')

  if (digits.length === 0) return null
  if (digits.length > MAX_PHONE_DIGITS) return null
  if (/^0+$/u.test(digits)) return null

  if (digits.length === NANP_DIGIT_LENGTH) {
    return `+${NANP_COUNTRY_CODE}${digits}`
  }

  if (
    digits.length === NANP_DIGIT_LENGTH + 1 &&
    digits.startsWith(NANP_COUNTRY_CODE)
  ) {
    return `+${digits}`
  }

  // Conservative international fallback. E.164 allows up to 15 digits; we use
  // 8 as a pragmatic lower bound to avoid hashing tiny local fragments.
  if (digits.length >= 8 && digits.length <= MAX_PHONE_DIGITS) {
    return `+${digits}`
  }

  return null
}

/**
 * Normalizes contact fields from an object boundary.
 *
 * Use this when callers receive a larger args/body object and need both email
 * and phone normalized without reading plaintext contact fields in route,
 * client, booking, or other non-security modules.
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
 * Normalize a contact value by type.
 */
export function normalizeContactForLookup(
  kind: 'EMAIL' | 'PHONE',
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