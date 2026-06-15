// app/api/_utils/jsonPayload.ts
//
// Single source of truth for coercing arbitrary values into Prisma-safe input
// JSON. Bookings/consultation routes persist audit/result blobs and previously
// each carried an identical copy of this normalizer pair.
//
// `normalizeNestedJsonValue` recursively converts a value into something
// assignable to a Prisma JSON column: primitives pass through, Date -> ISO
// string, Decimal -> string, boxed primitives are unwrapped, arrays/objects
// recurse (object keys sorted for stable output), and anything else falls back
// to String(value). `normalizeJsonObjectPayload` guarantees an object shape.

import { Prisma } from '@prisma/client'

import { isRecord } from '@/lib/guards'

export type NestedInputJsonValue = Prisma.InputJsonValue | null

export type JsonObjectPayload = {
  [key: string]: NestedInputJsonValue
}

export function normalizeNestedJsonValue(value: unknown): NestedInputJsonValue {
  if (value === null || value === undefined) {
    return null
  }

  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value
  }

  if (
    value instanceof String ||
    value instanceof Number ||
    value instanceof Boolean
  ) {
    return value.valueOf()
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  if (value instanceof Prisma.Decimal) {
    return value.toString()
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeNestedJsonValue(item))
  }

  if (isRecord(value)) {
    const out: JsonObjectPayload = {}
    for (const key of Object.keys(value).sort()) {
      out[key] = normalizeNestedJsonValue(value[key])
    }
    return out
  }

  return String(value)
}

export function normalizeJsonObjectPayload(value: unknown): JsonObjectPayload {
  if (value === null || value === undefined) {
    return {}
  }

  if (!isRecord(value)) {
    return { value: normalizeNestedJsonValue(value) }
  }

  const out: JsonObjectPayload = {}
  for (const key of Object.keys(value).sort()) {
    out[key] = normalizeNestedJsonValue(value[key])
  }
  return out
}

// null collapses to undefined — for callers that conditionally attach a JSON
// field to a response/record only when a value is present.
export function normalizeJsonValue(
  value: unknown,
): Prisma.InputJsonValue | undefined {
  const normalized = normalizeNestedJsonValue(value)
  return normalized === null ? undefined : normalized
}
