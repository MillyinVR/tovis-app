// lib/services/categoryTree.ts
//
// The service library as a pro browses it: active top-level categories, their
// active children, and under each the active services that belong there —
// by PRIMARY category (`Service.categoryId`) or by an additional link
// (`ServiceCategoryLink`). ONE loader, because two surfaces render this tree
// (the web "Add a service" overlay via ServicesManagerSection, and iOS via
// GET /api/v1/pro/services/catalog) and they had each copied the query; with
// links in play a second copy is a second place to forget them.
//
// Placement rule — a service appears ONCE per top-level subtree. Both clients
// let a pro browse "everything under this category" by concatenating the
// parent's list with its children's, and iOS keys that picker by service id,
// so a service linked to both a parent and its child (or to two siblings)
// would surface twice in one list. Inside a top-level subtree the service is
// placed in its PRIMARY category when that is inside the subtree, otherwise
// in the first linked slot in display order (parent, then children by name).
// Across different top-level categories it appears in each — that is the
// point of a link.

import type { Prisma, PrismaClient } from '@prisma/client'

export const CATEGORY_TREE_SERVICE_SELECT = {
  id: true,
  name: true,
  minPrice: true,
  defaultDurationMinutes: true,
  defaultImageUrl: true,
  isAddOnEligible: true,
  addOnGroup: true,
} satisfies Prisma.ServiceSelect

export type CategoryTreeService = Prisma.ServiceGetPayload<{
  select: typeof CATEGORY_TREE_SERVICE_SELECT
}>

const CATEGORY_TREE_NODE_SELECT = {
  id: true,
  name: true,
  services: {
    where: { isActive: true },
    select: CATEGORY_TREE_SERVICE_SELECT,
  },
  linkedServices: {
    where: { service: { isActive: true } },
    select: { service: { select: CATEGORY_TREE_SERVICE_SELECT } },
  },
} satisfies Prisma.ServiceCategorySelect

const CATEGORY_TREE_ROOT_SELECT = {
  ...CATEGORY_TREE_NODE_SELECT,
  children: {
    where: { isActive: true },
    orderBy: { name: 'asc' },
    select: CATEGORY_TREE_NODE_SELECT,
  },
} satisfies Prisma.ServiceCategorySelect

/** One category as the database hands it back: primary services + linked ones. */
export type CategoryTreeNodeRow = Prisma.ServiceCategoryGetPayload<{
  select: typeof CATEGORY_TREE_NODE_SELECT
}>

export type CategoryTreeRootRow = Prisma.ServiceCategoryGetPayload<{
  select: typeof CATEGORY_TREE_ROOT_SELECT
}>

export type ServiceCategoryTreeChild = {
  id: string
  name: string
  services: CategoryTreeService[]
}

export type ServiceCategoryTreeNode = ServiceCategoryTreeChild & {
  children: ServiceCategoryTreeChild[]
}

function byName<T extends { name: string }>(a: T, b: T): number {
  return a.name.localeCompare(b.name)
}

/**
 * Pure: rows → the tree the pickers render, with the placement rule applied.
 * Exported for its unit test; callers use `loadServiceCategoryTree`.
 */
export function buildServiceCategoryTree(
  roots: readonly CategoryTreeRootRow[],
): ServiceCategoryTreeNode[] {
  return roots.map((root) => {
    // Display order inside the subtree: the parent first, then children by name.
    const slots: CategoryTreeNodeRow[] = [root, ...[...root.children].sort(byName)]
    const placed = new Map<string, { slotId: string; service: CategoryTreeService }>()

    // Primary homes win wherever they sit inside the subtree.
    for (const slot of slots) {
      for (const service of slot.services) {
        if (!placed.has(service.id)) placed.set(service.id, { slotId: slot.id, service })
      }
    }
    // Then the first linked slot, in display order, for everything else.
    for (const slot of slots) {
      for (const link of slot.linkedServices) {
        if (!placed.has(link.service.id)) {
          placed.set(link.service.id, { slotId: slot.id, service: link.service })
        }
      }
    }

    const servicesIn = (slotId: string): CategoryTreeService[] =>
      [...placed.values()]
        .filter((entry) => entry.slotId === slotId)
        .map((entry) => entry.service)
        .sort(byName)

    return {
      id: root.id,
      name: root.name,
      services: servicesIn(root.id),
      children: slots.slice(1).map((child) => ({
        id: child.id,
        name: child.name,
        services: servicesIn(child.id),
      })),
    }
  })
}

export async function loadServiceCategoryTree(
  db: PrismaClient | Prisma.TransactionClient,
): Promise<ServiceCategoryTreeNode[]> {
  const roots = await db.serviceCategory.findMany({
    where: { isActive: true, parentId: null },
    orderBy: { name: 'asc' },
    select: CATEGORY_TREE_ROOT_SELECT,
  })
  return buildServiceCategoryTree(roots)
}
