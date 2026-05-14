// lib/json/inputJson.ts

import { Prisma } from '@prisma/client'

import { isRecord } from '@/lib/guards'

type JsonObjectPayload = {
  [key: string]: Prisma.InputJsonValue | null
}

export function normalizeInputJsonValue(
  value: unknown,
): Prisma.InputJsonValue | null {
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

  if (value instanceof Date) {
    return value.toISOString()
  }

  if (value instanceof Prisma.Decimal) {
    return value.toString()
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeInputJsonValue(item))
  }

  if (isRecord(value)) {
    const out: JsonObjectPayload = {}

    for (const key of Object.keys(value).sort()) {
      out[key] = normalizeInputJsonValue(value[key])
    }

    return out
  }

  return String(value)
}

export function normalizeInputJsonObject(
  value: unknown,
): Prisma.InputJsonObject {
  if (value === null || value === undefined) {
    return {}
  }

  if (!isRecord(value)) {
    return {
      value: normalizeInputJsonValue(value),
    }
  }

  const out: JsonObjectPayload = {}

  for (const key of Object.keys(value).sort()) {
    out[key] = normalizeInputJsonValue(value[key])
  }

  return out
}