// lib/services/viralBaseServiceLinks.ts
//
// The write side of "this trending name is really that work".
//
// ── What this is for ───────────────────────────────────────────────────────
//
// Tori, 2026-09-15, describing the whole feature in one sentence: *"a wolf cut
// is a viral name for a layered cut, so if a client books a wolf cut — even
// though we've added that service name — that service is still a haircut."*
//
// The client recognises "Wolf Cut". The stylist calls it a layered haircut. The
// platform has to know both, and `ViralServiceBaseService` is where it knows the
// second. That link is what lets a Wolf Cut booking behave like the haircut it
// is — for the consult's diagnostics, and for slice 5's keep-or-remove prompt
// when a pro drops haircuts from their menu.
//
// ── Three rules, none of which the schema can express ───────────────────────
//
//  1. **At least one base service.** Tori: *"a viral service should always be
//     connected to at least one if not more other services."* A composite-key
//     join table has no way to require a row, so emptying the set is refused
//     here. A look that should stop being a trending name is a different act.
//  2. **Never itself.** A service cannot be the work underneath its own name.
//  3. **No chains.** A base service must not itself be a viral name. Tori
//     described exactly two levels — the trending name, and the real service —
//     and a chain would make "removing any linked base service" (slice 5)
//     depend on how far you follow it. Nobody has decided that, so it is
//     refused rather than guessed. Deliberately conservative and reversible.
//
// 🔴 The link is **admin-set and never inferred** — not from the name, not from
// the category, not by a matcher. Nothing in this module guesses.
//
// Mirrors `categoryLinks.ts` on purpose: same absent-is-not-empty parse, same
// add/remove diff inside the caller's transaction, same "throw before writing"
// shape. Two link surfaces behaving differently is how one of them ends up with
// a rule the other quietly lacks.

import type { Prisma } from '@prisma/client'

import { parseFormIdSet } from './formIdSet'

/** The form field the admin review surface posts; repeated, or comma-joined. */
export const VIRAL_BASE_SERVICE_IDS_FIELD = 'baseServiceIds'

/**
 * `null` when the field is ABSENT — the caller leaves the links untouched, so a
 * form that does not know about them cannot wipe them by saving. An empty value
 * parses to `[]`, which `replaceViralBaseServiceLinks` then REFUSES (rule 1) —
 * the difference between "don't touch this" and "clear it" stays visible all the
 * way to the write.
 */
export function parseViralBaseServiceIds(form: FormData): string[] | null {
  return parseFormIdSet(form, VIRAL_BASE_SERVICE_IDS_FIELD)
}

/** Rule 1: a viral name with nothing underneath it names no work at all. */
export class ViralBaseServiceEmptyError extends Error {
  constructor() {
    super('A viral service must be linked to at least one real service.')
    this.name = 'ViralBaseServiceEmptyError'
  }
}

/** Rule 2. */
export class ViralBaseServiceSelfLinkError extends Error {
  constructor() {
    super('A viral service cannot be its own base service.')
    this.name = 'ViralBaseServiceSelfLinkError'
  }
}

/** Rule 3, with the offending ids named so the admin can fix the selection. */
export class ViralBaseServiceChainError extends Error {
  constructor(readonly chainedServiceIds: readonly string[]) {
    super(
      'A base service cannot itself be a viral service name: ' +
        chainedServiceIds.join(', '),
    )
    this.name = 'ViralBaseServiceChainError'
  }
}

/**
 * What the write SHOULD do, decided without touching a database.
 *
 * Split out from `replaceViralBaseServiceLinks` so the three rules and the
 * add/remove diff are unit-testable. They are the whole substance of this
 * module, and wiring them straight into Prisma calls would leave them coverable
 * only by an integration test against a live Postgres — which is exactly the
 * kind of check that gets skipped, and exactly the kind of rule that is silently
 * wrong when it is.
 *
 * Throws before returning anything, so the caller cannot write a partial set.
 */
export function planViralBaseServiceLinks(args: {
  viralServiceId: string
  /** The set the admin asked for. */
  baseServiceIds: readonly string[]
  /** What is linked today. */
  existingBaseServiceIds: readonly string[]
  /**
   * Of the requested ids, those that are THEMSELVES viral names (rule 3). The
   * caller reads this, because only it can; passing it in keeps this function
   * pure.
   */
  chainedBaseServiceIds: readonly string[]
}): { toAdd: string[]; toRemove: string[] } {
  const wanted = new Set(args.baseServiceIds)

  if (wanted.size === 0) throw new ViralBaseServiceEmptyError()
  if (wanted.has(args.viralServiceId)) throw new ViralBaseServiceSelfLinkError()

  // Only the ones actually being asked for — a chained service that is already
  // linked but is NOT in this request is being removed anyway, and refusing the
  // write would make a bad set impossible to fix.
  const chained = args.chainedBaseServiceIds.filter((id) => wanted.has(id))
  if (chained.length > 0) throw new ViralBaseServiceChainError(chained)

  const have = new Set(args.existingBaseServiceIds)

  return {
    toAdd: [...wanted].filter((id) => !have.has(id)),
    toRemove: [...have].filter((id) => !wanted.has(id)),
  }
}

/**
 * Make the viral service's base services exactly `baseServiceIds`: links not in
 * the set are removed, missing ones created, the rest left alone.
 *
 * Throws — before writing anything — on an empty set, on a self-link, or on a
 * base service that is itself a viral name (see `planViralBaseServiceLinks`,
 * which owns those rules). A base service id that does not exist fails the
 * insert's foreign key, and the caller's transaction rolls the whole change back.
 *
 * Runs inside the caller's transaction so a half-applied set is not reachable:
 * between the delete and the create, this service briefly has fewer base
 * services than rule 1 requires.
 */
export async function replaceViralBaseServiceLinks(
  tx: Prisma.TransactionClient,
  args: { viralServiceId: string; baseServiceIds: readonly string[] },
): Promise<{ added: number; removed: number }> {
  const requested = [...new Set(args.baseServiceIds)]

  // Both reads before any write, and one query each rather than one per id.
  const [chained, existing] = await Promise.all([
    requested.length === 0
      ? Promise.resolve([])
      : tx.viralServiceBaseService.findMany({
          where: { viralServiceId: { in: requested } },
          select: { viralServiceId: true },
          distinct: ['viralServiceId'],
        }),
    tx.viralServiceBaseService.findMany({
      where: { viralServiceId: args.viralServiceId },
      select: { baseServiceId: true },
    }),
  ])

  const { toAdd, toRemove } = planViralBaseServiceLinks({
    viralServiceId: args.viralServiceId,
    baseServiceIds: requested,
    existingBaseServiceIds: existing.map((row) => row.baseServiceId),
    chainedBaseServiceIds: chained.map((row) => row.viralServiceId),
  })

  if (toRemove.length) {
    await tx.viralServiceBaseService.deleteMany({
      where: {
        viralServiceId: args.viralServiceId,
        baseServiceId: { in: toRemove },
      },
    })
  }

  if (toAdd.length) {
    await tx.viralServiceBaseService.createMany({
      data: toAdd.map((baseServiceId) => ({
        viralServiceId: args.viralServiceId,
        baseServiceId,
      })),
    })
  }

  return { added: toAdd.length, removed: toRemove.length }
}
