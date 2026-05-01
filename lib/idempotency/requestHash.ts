import crypto from 'node:crypto'

type JsonLike =
  | null
  | boolean
  | number
  | string
  | JsonLike[]
  | { [key: string]: JsonLike }

function normalizeForHash(value: unknown): JsonLike {
  if (value === null || value === undefined) return null

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

  if (Array.isArray(value)) {
    return value.map(normalizeForHash)
  }

  if (typeof value === 'object') {
    const input = value as Record<string, unknown>
    const out: Record<string, JsonLike> = {}

    for (const key of Object.keys(input).sort()) {
      out[key] = normalizeForHash(input[key])
    }

    return out
  }

  return String(value)
}

export function buildRequestHash(value: unknown): string {
  const normalized = normalizeForHash(value)

  return crypto
    .createHash('sha256')
    .update(JSON.stringify(normalized))
    .digest('hex')
}
