// lib/booking/snapshots.ts
import { Prisma } from '@prisma/client'
import { isRecord } from '@/lib/guards'

export function buildAddressSnapshot(
  formattedAddress: string | null | undefined,
): Prisma.InputJsonValue | undefined {
  const value = typeof formattedAddress === 'string' ? formattedAddress.trim() : ''
  if (!value) return undefined

  const snapshot: Prisma.InputJsonObject = {
    formattedAddress: value,
  }

  return snapshot
}

export function pickFormattedAddressFromSnapshot(snapshot: unknown): string | null {
  if (!isRecord(snapshot)) return null

  const value = snapshot.formattedAddress
  return typeof value === 'string' && value.trim() ? value.trim() : null
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

export function decimalToNumber(value: unknown): number | undefined {
  if (value == null) return undefined

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined
  }

  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }

  if (typeof value === 'object' && value !== null) {
    const maybeToNumber = (value as { toNumber?: unknown }).toNumber
    if (typeof maybeToNumber === 'function') {
      const parsed = maybeToNumber.call(value) as number
      return Number.isFinite(parsed) ? parsed : undefined
    }

    const maybeToString = (value as { toString?: unknown }).toString
    if (typeof maybeToString === 'function') {
      const parsed = Number(String(maybeToString.call(value)))
      return Number.isFinite(parsed) ? parsed : undefined
    }
  }

  return undefined
}

export function decimalToNullableNumber(value: unknown): number | null {
  return decimalToNumber(value) ?? null
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