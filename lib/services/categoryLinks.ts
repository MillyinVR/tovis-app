// lib/services/categoryLinks.ts
//
// The write side of "a service in more than one category": the admin names the
// set of ADDITIONAL categories a service is listed under, and this replaces
// the service's links with exactly that set. Used by both admin routes
// (create and edit) so the two cannot drift on the one rule that matters —
// a link never points at the service's own primary category.

import type { Prisma } from '@prisma/client'

import { parseFormIdSet } from './formIdSet'

/** The form field both admin routes read; many values, or one comma-joined value. */
export const ADDITIONAL_CATEGORY_IDS_FIELD = 'additionalCategoryIds'

/**
 * `null` when the field is ABSENT — the caller leaves the links untouched, so
 * a form that does not know about links cannot wipe them by saving
 * (memory: a replace write that does not echo a field wipes it). An empty
 * string or an empty list means "no additional categories".
 *
 * The parsing itself lives in `parseFormIdSet`, shared with the viral
 * base-service links, which need the same absent-is-not-empty rule.
 */
export function parseAdditionalCategoryIds(form: FormData): string[] | null {
  return parseFormIdSet(form, ADDITIONAL_CATEGORY_IDS_FIELD)
}

export class PrimaryCategoryLinkError extends Error {
  constructor() {
    super('A service cannot be linked to its own primary category.')
    this.name = 'PrimaryCategoryLinkError'
  }
}

/**
 * Make the service's additional categories exactly `categoryIds`: links not in
 * the set are removed, missing ones created, the rest left alone. Throws
 * `PrimaryCategoryLinkError` before writing if the set names the primary.
 * A category id that does not exist fails the insert's foreign key — the
 * caller's transaction rolls the whole change back.
 */
export async function replaceServiceCategoryLinks(
  tx: Prisma.TransactionClient,
  args: { serviceId: string; primaryCategoryId: string; categoryIds: readonly string[] },
): Promise<{ added: number; removed: number }> {
  const wanted = new Set(args.categoryIds)
  if (wanted.has(args.primaryCategoryId)) throw new PrimaryCategoryLinkError()

  const existing = await tx.serviceCategoryLink.findMany({
    where: { serviceId: args.serviceId },
    select: { categoryId: true },
  })
  const have = new Set(existing.map((row) => row.categoryId))
  const toAdd = [...wanted].filter((id) => !have.has(id))
  const toRemove = [...have].filter((id) => !wanted.has(id))

  if (toRemove.length) {
    await tx.serviceCategoryLink.deleteMany({
      where: { serviceId: args.serviceId, categoryId: { in: toRemove } },
    })
  }
  if (toAdd.length) {
    await tx.serviceCategoryLink.createMany({
      data: toAdd.map((categoryId) => ({ serviceId: args.serviceId, categoryId })),
    })
  }
  return { added: toAdd.length, removed: toRemove.length }
}
