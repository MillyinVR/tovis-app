// lib/moneyDecimal.ts
//
// The half of lib/money.ts that needs the Prisma.Decimal CLASS, not just a
// Decimal-shaped value. Server-only, and it is the only reason this split
// exists.
//
// `new Prisma.Decimal(...)` is a value import of '@prisma/client'. A value
// import cannot be erased, so any client-reachable module holding one ships that
// package's browser build — 121.6 KB of ScalarFieldEnum maps naming every column
// of every model. lib/money.ts used to hold this function and paid that on 22
// routes; everything else in that file only ever READS a Decimal, which
// `isDecimalLike` does without the class.
//
// Nothing client-reachable calls parseMoney: all its callers are API routes and
// server libs, and its result is written to the database. Keeping it here means
// it keeps the real class and the real `instanceof` — this module is a MOVE of
// the function, character for character, not a reimplementation of it.
//
// If you are adding something here, check first that it truly needs the class.
// Reading a Decimal (`.toString()`, `.toNumber()`, formatting) belongs in
// lib/money.ts, where it costs the browser nothing.
import { Prisma } from '@prisma/client'

import { normalizeMoney2 } from '@/lib/money'

/**
 * Parse a money input into Prisma.Decimal.
 *
 * Accepts valid dollar values like:
 * - "49.99"
 * - "49"
 * - 49.99
 */
export function parseMoney(input: unknown): Prisma.Decimal {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new Error('Invalid money amount.')
    return new Prisma.Decimal(input.toFixed(2))
  }

  if (typeof input === 'string') {
    const normalized = normalizeMoney2(input)
    if (!normalized) throw new Error('Invalid money amount.')
    return new Prisma.Decimal(normalized)
  }

  if (input instanceof Prisma.Decimal) {
    return input
  }

  throw new Error('Invalid money amount.')
}
