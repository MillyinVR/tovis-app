// lib/notifications/notificationFields.ts
//
// Shared field normalizers for notification inbox rows. Used by the pro and
// client notification modules and the dispatch enqueue path so they coerce
// inbound title/body/href/payload values identically.

import { Prisma } from '@prisma/client'

/** Trim, coerce non-strings to '', and clip to `max` characters. */
export function normRequiredString(value: unknown, max: number): string {
  const s = typeof value === 'string' ? value.trim() : ''
  return s.slice(0, max)
}

/** Same coercion as normRequiredString (kept distinct for caller intent). */
export function normDefaultString(value: unknown, max: number): string {
  return normRequiredString(value, max)
}

/** Trim/clip; returns null when the result is empty. */
export function normNullableString(value: unknown, max: number): string | null {
  const clipped = normRequiredString(value, max)
  return clipped.length > 0 ? clipped : null
}

/**
 * Only allow internal app paths. Prevents accidentally storing external or
 * protocol-relative links in notification href values.
 */
export function normInternalHref(value: unknown, max: number): string {
  const s = typeof value === 'string' ? value.trim().slice(0, max) : ''
  if (!s) return ''
  if (!s.startsWith('/')) return ''
  if (s.startsWith('//')) return ''
  return s
}

/** Map a JSON field to Prisma's JsonNull, leaving undefined as a no-op. */
export function normalizeJsonField(
  value: Prisma.InputJsonValue | null | undefined,
) {
  if (value === undefined) return undefined
  return value === null ? Prisma.JsonNull : value
}
