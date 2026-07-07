// lib/boards/slug.ts
//
// URL-safe slugs for public (SHARED) boards — the /u/[handle]/boards/[slug]
// address (social-first D3). Kept in lock-step with the backfill regexp in
// prisma/migrations/20260707010000_add_public_boards/migration.sql: lowercase,
// collapse any non-alphanumeric run to a single hyphen, trim edge hyphens,
// fall back to "board" when nothing survives.
import { Prisma, PrismaClient } from '@prisma/client'

import { normalizeRequiredId } from '@/lib/guards'

type BoardsDb = PrismaClient | Prisma.TransactionClient

export function slugifyBoardName(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return base || 'board'
}

/**
 * Given a base slug and the set of slugs already taken by the same client,
 * returns the base if free, else the first `base-N` (N≥2) that isn't taken.
 * Pure so the disambiguation is unit-testable without a DB.
 */
export function pickAvailableBoardSlug(
  base: string,
  takenSlugs: Iterable<string>,
): string {
  const taken = new Set(takenSlugs)
  if (!taken.has(base)) return base

  let n = 2
  while (taken.has(`${base}-${n}`)) n += 1
  return `${base}-${n}`
}

/**
 * Resolves a unique slug for a board within its owning client. Slugs only have
 * to be unique per client (`@@unique([clientId, slug])`), so we scan that
 * client's existing slugs sharing the base prefix and disambiguate in-app.
 * `excludeBoardId` lets a rename keep its own slug family without colliding
 * with itself.
 */
export async function resolveAvailableBoardSlug(
  db: BoardsDb,
  args: {
    clientId: string
    name: string
    excludeBoardId?: string | null
  },
): Promise<string> {
  const clientId = normalizeRequiredId('clientId', args.clientId)
  const base = slugifyBoardName(args.name)

  const existing = await db.board.findMany({
    where: {
      clientId,
      slug: { startsWith: base },
      ...(args.excludeBoardId
        ? { NOT: { id: args.excludeBoardId } }
        : {}),
    },
    select: { slug: true },
  })

  return pickAvailableBoardSlug(
    base,
    existing.map((row) => row.slug),
  )
}
