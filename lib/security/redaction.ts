// lib/security/redaction.ts

const DEFAULT_VISIBLE_PREFIX = 1
const DEFAULT_VISIBLE_SUFFIX = 4
const MAX_REDACTION_INPUT_LENGTH = 10_000

const REDACTED = '[redacted]'
const REDACTED_EMAIL = '[redacted-email]'
const REDACTED_PHONE = '[redacted-phone]'
const REDACTED_TOKEN = '[redacted-token]'
const REDACTED_SIGNED_URL = '[redacted-signed-url]'
const REDACTED_ADDRESS = '[redacted-address]'
const REDACTED_NOTES = '[redacted-notes]'

type RedactionOptions = {
  visiblePrefix?: number
  visibleSuffix?: number
}

function toSafeString(value: unknown): string | null {
  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  if (!trimmed) return null

  return trimmed.slice(0, MAX_REDACTION_INPUT_LENGTH)
}

function clampVisibleCount(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(0, Math.min(32, Math.trunc(value)))
}

function maskString(value: string, options: RedactionOptions = {}): string {
  const visiblePrefix = clampVisibleCount(
    options.visiblePrefix,
    DEFAULT_VISIBLE_PREFIX,
  )
  const visibleSuffix = clampVisibleCount(
    options.visibleSuffix,
    DEFAULT_VISIBLE_SUFFIX,
  )

  if (!value) return REDACTED

  const totalVisible = visiblePrefix + visibleSuffix

  if (value.length <= totalVisible) {
    return REDACTED
  }

  const prefix = visiblePrefix > 0 ? value.slice(0, visiblePrefix) : ''
  const suffix = visibleSuffix > 0 ? value.slice(-visibleSuffix) : ''

  return `${prefix}***${suffix}`
}

/**
 * Redacts an email address while preserving enough shape for debugging.
 *
 * Example:
 *   "tori@example.com" -> "t***@example.com"
 *
 * If the value is malformed, returns "[redacted-email]".
 */
export function redactEmail(value: unknown): string {
  try {
    const input = toSafeString(value)
    if (!input) return REDACTED_EMAIL

    const normalized = input.toLowerCase()
    const atIndex = normalized.indexOf('@')

    if (atIndex <= 0 || atIndex !== normalized.lastIndexOf('@')) {
      return REDACTED_EMAIL
    }

    const localPart = normalized.slice(0, atIndex)
    const domainPart = normalized.slice(atIndex + 1)

    if (!localPart || !domainPart || /\s/.test(normalized)) {
      return REDACTED_EMAIL
    }

    return `${maskString(localPart, {
      visiblePrefix: 1,
      visibleSuffix: 0,
    })}@${domainPart}`
  } catch {
    return REDACTED_EMAIL
  }
}

/**
 * Redacts a phone number while preserving the final digits.
 *
 * Example:
 *   "(555) 123-4567" -> "***4567"
 *
 * If the value has fewer than 4 digits, returns "[redacted-phone]".
 */
export function redactPhone(value: unknown): string {
  try {
    const input = toSafeString(value)
    if (!input) return REDACTED_PHONE

    const digits = input.replace(/\D/g, '')

    if (digits.length < 4) return REDACTED_PHONE

    return `***${digits.slice(-4)}`
  } catch {
    return REDACTED_PHONE
  }
}

/**
 * Redacts tokens, API keys, verification codes, idempotency keys, and other
 * reusable secrets.
 *
 * By default this reveals no token characters because even prefixes/suffixes can
 * be useful to attackers when logs leak.
 */
export function redactToken(
  value: unknown,
  options: RedactionOptions = {},
): string {
  try {
    const input = toSafeString(value)
    if (!input) return REDACTED_TOKEN

    const visiblePrefix = clampVisibleCount(options.visiblePrefix, 0)
    const visibleSuffix = clampVisibleCount(options.visibleSuffix, 0)

    if (visiblePrefix === 0 && visibleSuffix === 0) {
      return REDACTED_TOKEN
    }

    return maskString(input, { visiblePrefix, visibleSuffix })
  } catch {
    return REDACTED_TOKEN
  }
}

/**
 * Redacts signed URLs and sensitive URLs.
 *
 * Preserves origin + pathname where safe, but removes query/hash because signed
 * URL secrets usually live there.
 *
 * Example:
 *   https://x.supabase.co/storage/v1/object/sign/media-private/a.jpg?token=...
 *   -> https://x.supabase.co/storage/v1/object/sign/media-private/a.jpg?[redacted-signed-url]
 */
export function redactSignedUrl(value: unknown): string {
  try {
    const input = toSafeString(value)
    if (!input) return REDACTED_SIGNED_URL

    try {
      const url = new URL(input)

      return `${url.origin}${url.pathname}${
        url.search || url.hash ? `?${REDACTED_SIGNED_URL}` : ''
      }`
    } catch {
      return REDACTED_SIGNED_URL
    }
  } catch {
    return REDACTED_SIGNED_URL
  }
}

/**
 * Redacts addresses. This intentionally does not try to parse an address because
 * partial addresses can still be identifying when combined with booking context.
 */
export function redactAddress(value: unknown): string {
  try {
    const input = toSafeString(value)
    return input ? REDACTED_ADDRESS : REDACTED_ADDRESS
  } catch {
    return REDACTED_ADDRESS
  }
}

/**
 * Redacts free-text notes, consultation notes, aftercare text, message bodies,
 * admin notes, and other user-generated text.
 */
export function redactNotes(value: unknown): string {
  try {
    const input = toSafeString(value)
    return input ? REDACTED_NOTES : REDACTED_NOTES
  } catch {
    return REDACTED_NOTES
  }
}

/**
 * General-purpose fallback redaction helper.
 */
export function redactValue(value: unknown): string {
  try {
    const input = toSafeString(value)
    return input ? REDACTED : REDACTED
  } catch {
    return REDACTED
  }
}

export const redactionLabels = {
  redacted: REDACTED,
  email: REDACTED_EMAIL,
  phone: REDACTED_PHONE,
  token: REDACTED_TOKEN,
  signedUrl: REDACTED_SIGNED_URL,
  address: REDACTED_ADDRESS,
  notes: REDACTED_NOTES,
} as const