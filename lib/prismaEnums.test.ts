import { describe, expect, it } from 'vitest'
import * as prisma from '@prisma/client'

import * as clientSafe from '@/lib/prismaEnums'

/**
 * lib/prismaEnums.ts is generated from prisma/schema.prisma, and
 * `check:client-safe-enums` proves it still matches that FILE.
 *
 * This proves the other leg: that it matches the CLIENT Prisma actually
 * generates. The static guard and `prisma generate` read the same schema, so the
 * two should never disagree — but "should never" is the assumption that put a
 * 121.5 KB chunk on 53 routes in the first place. A hand-rolled parser can drift
 * from Prisma's real one (a member spelled differently, an enum the regex fails
 * to see, a naming transform applied to one and not the other), and every such
 * drift is invisible to typecheck because both sides are only strings.
 *
 * Importing '@prisma/client' here is fine and is the whole point: a test is
 * never bundled, so this is the one place both definitions can be held up
 * against each other.
 */
describe('lib/prismaEnums', () => {
  // Every runtime export of the module is one of the generated const objects —
  // the same-named types are erased and have no runtime presence.
  const copies: Record<string, unknown> = clientSafe
  const generated: Record<string, unknown> = prisma

  const names = Object.keys(copies).sort()

  it('exports something (a vacuous pass here would hide a deleted file)', () => {
    expect(names.length).toBeGreaterThan(0)
  })

  it.each(names)('%s matches the generated Prisma enum', (name) => {
    const copy = copies[name]
    const real = generated[name]

    expect(
      real,
      `${name} is exported by lib/prismaEnums but not by @prisma/client — it was ` +
        'renamed or removed from the schema. Drop it from CLIENT_SAFE_ENUMS and ' +
        'from every importer rather than leaving a phantom enum behind.',
    ).toBeDefined()

    // Same members, same values, same order.
    expect(copy).toStrictEqual(real)
    expect(Object.keys(Object(copy))).toEqual(Object.keys(Object(real)))

    // Each key maps to itself, the way Prisma's own generated enums do.
    for (const [key, value] of Object.entries(Object(copy))) {
      expect(value).toBe(key)
    }
  })
})
