// lib/blocks/userBlocks.ts
//
// Shared read-path helpers for the person block (App Store guideline 1.2 — a
// UGC app must let a user block abusive users). The write path is
// POST /api/v1/blocks; the model is UserBlock.
//
// TWO PROPERTIES THIS MODULE EXISTS TO GUARANTEE
// ----------------------------------------------
//  1. SYMMETRY. A block is stored one-way (`blockerUserId` blocked
//     `blockedUserId`) so "who initiated" stays answerable, but it is READ
//     both ways: `loadBlockedUserIds` unions the people you blocked with the
//     people who blocked you. Enforcing one direction only would let the
//     blocked party keep watching and replying to the person who blocked them,
//     which is precisely the harassment the guideline is about.
//  2. ONE FILTER SHAPE. Every look-bearing read composes the SAME predicate
//     (`buildLookPostBlockFilter`), so a new feed cannot accidentally ship
//     without the block applied by inventing its own half-right clause. A block
//     the feed query does not honour is worse than none — it is a promise the
//     product does not keep.
//
// Deliberately free of `lib/looks` imports: the looks feeds import THIS module,
// never the other way round.

import type { Prisma } from '@prisma/client'

// Upper bound on the block list a single viewer contributes to a query, so a
// prolific blocker cannot blow up the `in` clause. Most recent blocks win.
// Far above any plausible real block list — LookHide's equivalent cap (500) is
// for a signal people emit dozens of times a day; blocking is rare and
// deliberate, so this ceiling should never be reached in practice.
export const BLOCKED_USER_IDS_CAP = 1000

/** Minimal db surface: just the model methods this module calls. */
type BlocksReaderDb = {
  userBlock: {
    findMany: (args: {
      where: {
        OR: Array<{ blockerUserId: string } | { blockedUserId: string }>
      }
      orderBy: { createdAt: 'desc' }
      take: number
      select: { blockerUserId: true; blockedUserId: true }
    }) => Promise<Array<{ blockerUserId: string; blockedUserId: string }>>
  }
}

/**
 * Every user id the viewer must not see, and who must not see the viewer —
 * both directions of the block, de-duplicated.
 *
 * Empty for a signed-out viewer (no userId): callers skip the query then, since
 * an anonymous viewer has no blocks and cannot be blocked.
 */
export async function loadBlockedUserIds(
  db: BlocksReaderDb,
  args: { userId: string },
): Promise<string[]> {
  const rows = await db.userBlock.findMany({
    where: {
      OR: [{ blockerUserId: args.userId }, { blockedUserId: args.userId }],
    },
    orderBy: { createdAt: 'desc' },
    take: BLOCKED_USER_IDS_CAP,
    select: { blockerUserId: true, blockedUserId: true },
  })

  // The viewer's own id is one end of every row and must never land in the
  // exclusion set — that would filter their own content out of their own feeds.
  const ids = new Set<string>()
  for (const row of rows) {
    ids.add(
      row.blockerUserId === args.userId ? row.blockedUserId : row.blockerUserId,
    )
  }
  ids.delete(args.userId)

  return [...ids]
}

/**
 * The `LookPost` predicate that removes blocked people's looks, or `null` when
 * there is nothing to filter (compose it only when non-null so an empty block
 * list costs no SQL). Returns a single self-contained `AND` key, so it is safe
 * to drop into any `AND` array without colliding with a caller's own `OR`.
 *
 * BOTH author columns are checked. `professionalId` is the ORIGIN pro even on a
 * client-authored look, so a look can carry two people: the pro whose work it
 * shows and the client who published it. Blocking either removes the look —
 * seeing a blocked pro's work because someone else posted it, or a blocked
 * client's post because it credits a pro you do not block, would both be the
 * blocked person still reaching the viewer.
 *
 * 🔴 EVERY NULL CASE IS SPELLED OUT, and that is not defensive noise — it is a
 * measured bug. `ClientProfile.userId` is nullable, and this filter was first
 * written as `NOT { OR [ …userId: { in } ] }` on the theory that negating a
 * positive match is null-safe. It is not: for a look whose client author has a
 * NULL `userId`, the inner condition is NULL, and `NOT NULL` is NULL, not true
 * — so the row is dropped. Against the dev database that silently removed 90
 * looks that had nothing to do with the blocked person (109 feed-visible → 11).
 * Unit tests on the predicate's SHAPE passed the whole time; only running it
 * against real rows found it.
 *
 * So: `professional.userId` is NOT NULL in the schema, so `notIn` is safe there.
 * The client-author side is an explicit three-way OR — no client author, a
 * client author with no user account, or a user who is not blocked — so no
 * branch ever evaluates to NULL.
 */
export function buildLookPostBlockFilter(
  blockedUserIds: string[],
): Prisma.LookPostWhereInput | null {
  if (blockedUserIds.length === 0) return null

  return {
    AND: [
      // ProfessionalProfile.userId is non-nullable — notIn cannot go NULL here.
      { professional: { is: { userId: { notIn: blockedUserIds } } } },
      {
        OR: [
          // Pro-authored: there is no client author to check.
          { clientAuthorId: null },
          // A client record no person has ever signed into — unblockable, so it
          // must stay in the feed rather than vanish.
          { clientAuthor: { is: { userId: null } } },
          { clientAuthor: { is: { userId: { notIn: blockedUserIds } } } },
        ],
      },
    ],
  }
}

/**
 * The `LookComment` predicate that removes blocked people's comments and
 * replies, or `null` when there is nothing to filter.
 *
 * `LookComment.userId` is non-nullable, so a plain `notIn` is safe here — the
 * NULL hazard that forces `buildLookPostBlockFilter` into a negated match does
 * not apply. Apply it to the COUNT as well as the rows: a header that says
 * twelve comments over a list showing ten reads as a bug, and re-counting is
 * the only way the two can agree.
 */
export function buildLookCommentBlockFilter(
  blockedUserIds: string[],
): Prisma.LookCommentWhereInput | null {
  if (blockedUserIds.length === 0) return null
  return { userId: { notIn: blockedUserIds } }
}
