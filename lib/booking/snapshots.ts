// lib/booking/snapshots.ts
import { Prisma } from '@prisma/client'
import { isRecord } from '@/lib/guards'
import { moneyToNumber } from '@/lib/money'

function pickString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/**
 * Legacy plaintext snapshot builder.
 *
 * Prefer encrypted address snapshot writes for new Booking / BookingHold writes.
 * This stays only for old callers/tests that still intentionally build a tiny
 * display snapshot.
 */
export function buildAddressSnapshot(
  formattedAddress: string | null | undefined,
): Prisma.InputJsonValue | undefined {
  const value = pickString(formattedAddress)
  if (!value) return undefined

  const snapshot: Prisma.InputJsonObject = {
    formattedAddress: value,
  }

  return snapshot
}

export function pickFormattedAddressFromSnapshot(snapshot: unknown): string | null {
  if (!isRecord(snapshot)) return null

  // Legacy shape:
  // { formattedAddress: "123 Main St" }
  const legacyValue = pickString(snapshot.formattedAddress)
  if (legacyValue) return legacyValue

  // Current encrypted-envelope/plaintext-dev shape from addressEncryption:
  // {
  //   v: 1,
  //   algorithm: "...",
  //   keyVersion: "...",
  //   address: { formattedAddress: "123 Main St", ... }
  // }
  const address = snapshot.address
  if (isRecord(address)) {
    return pickString(address.formattedAddress)
  }

  return null
}

/**
 * Prisma read JSON vs write JSON types are slightly different.
 * This is a narrow, local bridge for reusing an already-stored JSON snapshot verbatim.
 */
export function reuseJsonSnapshot(
  value: Prisma.JsonValue | null | undefined,
): Prisma.InputJsonValue | undefined {
  if (value == null) return undefined
  return value as Prisma.InputJsonValue
}

// `undefined`-returning variant kept for callers that distinguish "absent"
// (key omitted) from "present null". Delegates to the money.ts SSOT and maps
// its null sentinel back to undefined; 0 and other falsy-but-valid numbers are
// preserved (?? only catches null/undefined).
export function decimalToNumber(value: unknown): number | undefined {
  return moneyToNumber(value) ?? undefined
}

export function decimalToNullableNumber(value: unknown): number | null {
  return moneyToNumber(value)
}

export function decimalFromUnknown(value: unknown): Prisma.Decimal {
  if (value instanceof Prisma.Decimal) return value

  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Prisma.Decimal(String(value))
  }

  if (typeof value === 'string' && value.trim()) {
    return new Prisma.Decimal(value.trim())
  }

  if (value && typeof value === 'object') {
    const maybeToString = (value as { toString?: unknown }).toString
    if (typeof maybeToString === 'function') {
      return new Prisma.Decimal(String(maybeToString.call(value)))
    }
  }

  return new Prisma.Decimal('0')
}