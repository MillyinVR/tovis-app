import { Prisma } from '@prisma/client'

/**
 * Runtime-validated boundary between app data and Prisma JSON columns.
 *
 * Prisma's `InputJsonValue` is structurally incompatible with most app
 * object types even when they are plainly JSON-safe, which historically
 * forced `as unknown as Prisma.InputJsonValue` casts at write sites. This
 * helper replaces those casts: it walks the value and proves at runtime
 * that it is JSON-serializable plain data before asserting the type once.
 *
 * Rejected: functions, symbols, bigints, undefined, non-finite numbers,
 * class instances (anything with a prototype other than Object/null),
 * circular references, and top-level null (Prisma represents JSON null
 * with `Prisma.JsonNull` / `Prisma.DbNull`, not `null`).
 */
export function toPrismaJson(value: unknown): Prisma.InputJsonValue {
  if (value === null) {
    throw new TypeError(
      'toPrismaJson: top-level null is not an InputJsonValue; use Prisma.JsonNull or Prisma.DbNull',
    )
  }

  assertJsonValue(value, 'value', new Set())

  return value as Prisma.InputJsonValue
}

/**
 * Write an OPTIONAL Prisma JSON column from a value already in Prisma's *input*
 * shape. Three states, three different Prisma meanings:
 *   `undefined` -> omit the field entirely (leave whatever is stored alone);
 *   `null`      -> `Prisma.JsonNull` (Prisma represents JSON null with a sentinel,
 *                  never with a bare `null`);
 *   otherwise   -> the value, unchanged.
 *
 * This existed as five separate private copies (booking write boundary, closeout
 * audit, aftercare access delivery, consultation confirmation proof, client action
 * tokens) under two different signatures — see
 * `toNullableJsonCreateInputFromJsonValue` below for the other one.
 */
export function toNullableJsonCreateInput(
  value: Prisma.InputJsonValue | null | undefined,
): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined {
  if (value === undefined) return undefined
  if (value === null) return Prisma.JsonNull

  return value
}

/**
 * Rebuild a value that came OUT of Prisma (`Prisma.JsonValue`, the read type)
 * into the input shape, dropping `undefined` object members. Distinct from
 * `toPrismaJson` above, which VALIDATES arbitrary app data and throws on anything
 * not JSON-safe: this one takes data Prisma already vouched for and only needs the
 * read type converted to the write type, so it never throws (a non-object,
 * non-primitive lands as `{}`).
 *
 * Keep the two apart deliberately — a caller reaching for the wrong one either
 * loses the runtime validation it wanted or gains a throw it cannot handle.
 */
export function jsonValueToInputJson(value: Prisma.JsonValue): Prisma.InputJsonValue {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value
  }

  if (Array.isArray(value)) {
    return value.map((item) => (item === null ? null : jsonValueToInputJson(item)))
  }

  if (value === null || typeof value !== 'object') {
    return {}
  }

  const out: Record<string, Prisma.InputJsonValue | null> = {}

  for (const key of Object.keys(value)) {
    const child = value[key]
    if (child === undefined) continue

    out[key] = child === null ? null : jsonValueToInputJson(child)
  }

  return out
}

/**
 * `toNullableJsonCreateInput` for a value that came OUT of Prisma: same
 * undefined/null/value contract, but the payload is rebuilt through
 * `jsonValueToInputJson` because `Prisma.JsonValue` is not assignable to
 * `Prisma.InputJsonValue`.
 */
export function toNullableJsonCreateInputFromJsonValue(
  value: Prisma.JsonValue | null | undefined,
): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined {
  if (value === undefined) return undefined
  if (value === null) return Prisma.JsonNull

  return jsonValueToInputJson(value)
}

function assertJsonValue(value: unknown, path: string, seen: Set<object>): void {
  if (value === null) return

  const kind = typeof value

  if (kind === 'string' || kind === 'boolean') return

  if (kind === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(`toPrismaJson: ${path} is a non-finite number`)
    }
    return
  }

  if (kind !== 'object') {
    throw new TypeError(`toPrismaJson: ${path} is not JSON-serializable (${kind})`)
  }

  const obj = value as object

  if (seen.has(obj)) {
    throw new TypeError(`toPrismaJson: ${path} contains a circular reference`)
  }
  seen.add(obj)

  if (Array.isArray(obj)) {
    obj.forEach((item, index) => assertJsonValue(item, `${path}[${index}]`, seen))
    seen.delete(obj)
    return
  }

  const proto = Object.getPrototypeOf(obj)
  if (proto !== Object.prototype && proto !== null) {
    throw new TypeError(
      `toPrismaJson: ${path} is not a plain object (class instances, Dates, Maps, etc. are not JSON-safe as-is)`,
    )
  }

  for (const [key, item] of Object.entries(obj)) {
    assertJsonValue(item, `${path}.${key}`, seen)
  }
  seen.delete(obj)
}
