// lib/security/crypto/hashLookup.ts
import { createHash } from 'crypto'

/**
 * Normalizes an email address for lookup hashing.
 *
 * Intentional behavior:
 * - trims surrounding whitespace
 * - lowercases the whole email
 * - requires exactly one "@"
 * - requires non-empty local and domain parts
 * - rejects obvious malformed emails
 *
 * Non-goals:
 * - provider-specific normalization, such as Gmail dot removal
 * - Unicode/domain punycode normalization
 * - full RFC 5322 email validation
 *
 * Provider-specific normalization can merge accounts unexpectedly, so do not add
 * it unless product/security explicitly decides that behavior is correct.
 */
export function normalizeEmailForLookup(
  value: string | null | undefined,
): string | null {
  if (typeof value !== 'string') return null

  const normalized = value.trim().toLowerCase()
  if (!normalized) return null

  const atIndex = normalized.indexOf('@')
  const lastAtIndex = normalized.lastIndexOf('@')

  if (atIndex <= 0 || atIndex !== lastAtIndex) return null

  const localPart = normalized.slice(0, atIndex)
  const domainPart = normalized.slice(atIndex + 1)

  if (!localPart || !domainPart) return null
  if (domainPart.startsWith('.') || domainPart.endsWith('.')) return null
  if (!domainPart.includes('.')) return null
  if (/\s/.test(normalized)) return null

  return normalized
}

/**
 * Normalizes a phone number for lookup hashing.
 *
 * Intentional behavior:
 * - accepts common formatted phone values
 * - strips spaces, parentheses, dashes, dots, and other non-digits
 * - preserves a leading "+"
 * - returns an E.164-ish value when possible
 * - defaults 10-digit NANP numbers to "+1"
 *
 * Notes:
 * - This is intentionally conservative and dependency-free.
 * - If later you add libphonenumber-js, replace this implementation with
 *   region-aware parsing while keeping this function contract stable.
 */
export function normalizePhoneForLookup(
  value: string | null | undefined,
): string | null {
  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  if (!trimmed) return null

  const hasLeadingPlus = trimmed.startsWith('+')
  const digits = trimmed.replace(/\D/g, '')

  if (!digits) return null

  /**
   * Basic E.164 maximum is 15 digits. We also reject very short numbers because
   * values like "123" are usually test junk, extensions, or malformed input.
   */
  if (digits.length < 7 || digits.length > 15) return null

  if (hasLeadingPlus) {
    return `+${digits}`
  }

  /**
   * Product currently appears US/CA-centered in several flows. For plain
   * 10-digit numbers, normalize to NANP +1. For 11 digits already starting
   * with 1, normalize to +<digits>.
   */
  if (digits.length === 10) {
    return `+1${digits}`
  }

  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`
  }

  /**
   * For other international-looking numbers without "+", normalize to "+digits"
   * rather than storing multiple variants. This avoids raw phone lookup drift.
   */
  return `+${digits}`
}

/**
 * Returns a lowercase SHA-256 hex digest.
 *
 * This helper intentionally accepts only strings. Callers should normalize
 * emails/phones/tokens before hashing so hashes are stable and comparable.
 */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

/**
 * Convenience helper for email lookup hashes.
 */
export function emailLookupHash(
  value: string | null | undefined,
): string | null {
  const normalized = normalizeEmailForLookup(value)
  return normalized ? sha256Hex(normalized) : null
}

/**
 * Convenience helper for phone lookup hashes.
 */
export function phoneLookupHash(
  value: string | null | undefined,
): string | null {
  const normalized = normalizePhoneForLookup(value)
  return normalized ? sha256Hex(normalized) : null
}