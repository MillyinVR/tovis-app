// lib/services/catalog/index.ts
//
// The whole canonical service catalog, and the rules a catalog must satisfy
// before anything is seeded from it. Today it is hair; a later vertical adds
// its own `<vertical>.ts` and spreads it in here.

import { normalizeServiceName } from '@/lib/migration/serviceMatch'

import { HAIR_CATALOG_CATEGORIES, HAIR_CATALOG_SERVICES } from './hair'
import type { CatalogService, ServiceCatalog } from './types'

export type { CatalogCategory, CatalogService, ServiceCatalog } from './types'

export const SERVICE_CATALOG: ServiceCatalog = {
  categories: HAIR_CATALOG_CATEGORIES,
  services: HAIR_CATALOG_SERVICES,
}

/** The shortest appointment the catalog will describe. */
export const CATALOG_MIN_DURATION_MINUTES = 5

const TWO_DECIMAL_MONEY = /^\d+\.\d{2}$/

export type CatalogProblem = { row: string; problem: string }

export function catalogFloorCents(service: Pick<CatalogService, 'floorUsd'>): number {
  return Math.round(Number(service.floorUsd) * 100)
}

/**
 * Every rule the seed relies on, checked up front so a bad row is refused by
 * NAME before a transaction opens. Returns every problem, not just the first.
 */
export function validateServiceCatalog(catalog: ServiceCatalog): CatalogProblem[] {
  const problems: CatalogProblem[] = []
  const seenSlugs = new Set<string>()

  for (const category of catalog.categories) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(category.slug)) {
      problems.push({ row: category.slug, problem: 'category slug must be kebab-case' })
    }
    if (seenSlugs.has(category.slug)) {
      problems.push({ row: category.slug, problem: 'duplicate category slug' })
    }
    if (!category.name.trim()) {
      problems.push({ row: category.slug, problem: 'category name is empty' })
    }
    if (category.parentSlug !== null) {
      if (!seenSlugs.has(category.parentSlug)) {
        problems.push({
          row: category.slug,
          problem: `parent "${category.parentSlug}" must be listed before its child`,
        })
      } else if (catalog.categories.find((c) => c.slug === category.parentSlug)?.parentSlug) {
        problems.push({ row: category.slug, problem: 'categories nest at most two levels' })
      }
    }
    seenSlugs.add(category.slug)
  }

  const seenNames = new Set<string>()
  const seenNormalized = new Map<string, string>()
  for (const service of catalog.services) {
    const name = service.name
    if (name !== name.trim() || !name) {
      problems.push({ row: name, problem: 'service name is empty or has surrounding whitespace' })
    }
    if (seenNames.has(name)) {
      problems.push({ row: name, problem: 'duplicate service name' })
    }
    seenNames.add(name)
    const normalized = normalizeServiceName(name)
    const clash = seenNormalized.get(normalized)
    if (clash !== undefined && clash !== name) {
      problems.push({ row: name, problem: `normalises the same as "${clash}"` })
    }
    seenNormalized.set(normalized, name)

    if (!seenSlugs.has(service.categorySlug)) {
      problems.push({ row: name, problem: `unknown category "${service.categorySlug}"` })
    }
    if (
      !Number.isInteger(service.defaultDurationMinutes) ||
      service.defaultDurationMinutes < CATALOG_MIN_DURATION_MINUTES
    ) {
      problems.push({ row: name, problem: `duration must be a whole number of at least ${CATALOG_MIN_DURATION_MINUTES} minutes` })
    }
    if (!TWO_DECIMAL_MONEY.test(service.floorUsd)) {
      problems.push({ row: name, problem: 'floor must be a non-negative amount with exactly two decimals' })
    }
    if (service.addOnGroup !== null && !service.isAddOnEligible) {
      problems.push({ row: name, problem: 'has an add-on group but is not add-on eligible' })
    }
    if (service.addOnGroup !== null && !service.addOnGroup.trim()) {
      problems.push({ row: name, problem: 'add-on group is empty' })
    }
    if (service.description !== null && !service.description.trim()) {
      problems.push({ row: name, problem: 'description is empty — use null' })
    }
    if (service.professions.length === 0) {
      problems.push({ row: name, problem: 'grants no licence' })
    }
    if (new Set(service.professions).size !== service.professions.length) {
      problems.push({ row: name, problem: 'lists a licence twice' })
    }
  }

  return problems
}
