import type { Prisma } from '@prisma/client'

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
