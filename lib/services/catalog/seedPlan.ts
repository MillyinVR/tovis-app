// lib/services/catalog/seedPlan.ts
//
// Turning the catalog into database rows, in two halves that the CLI and the
// tests both drive: PLAN (read what is there, decide every action, refuse
// anything unsafe) and APPLY (write exactly the planned actions, inside the
// caller's transaction). A dry run is a plan that is printed and not applied.
//
// What the plan will NOT do on its own, by design:
//   * lower OR raise an existing service's floor — a floor is enforced against
//     every live offering (types.ts), so a change either refuses a pro's real
//     price or charges her client above it; `force` applies it knowingly;
//   * move an existing service to another category, or an existing category
//     under another parent — `force`;
//   * change an existing category's consult FAMILY — the consult keys its packs
//     on the family, and a change restarts a client's in-progress intake
//     (docs/OPEN-WORK.md §P "Known edge"); `allowFamilyChange`;
//   * create a service whose name NORMALISES equal to an existing row spelled
//     differently ("Root Touch-Up" next to "Root touch up") — refused outright,
//     because the consult matches names case-insensitively and would see two;
//   * remove an "also in" link an admin added by hand — links are ADD-ONLY
//     here (extras are listed, never dropped);
//   * activate or deactivate anything that exists; delete anything, ever.

import {
  Prisma,
  ServicePermissionMode,
  type ConsultServiceFamily,
  type ProfessionType,
} from '@prisma/client'

import { normalizeServiceName } from '@/lib/migration/serviceMatch'

import { validateServiceCatalog, type CatalogProblem } from './index'
import type { CatalogCategory, CatalogService, ServiceCatalog } from './types'

export type SeedPlanOptions = {
  /** Apply a consult-family change on an existing category. */
  allowFamilyChange: boolean
  /** Apply a floor change, a category move or a parent change on an existing row. */
  force: boolean
}

/** One field the plan would change on an existing row. */
export type FieldChange = { field: string; from: string; to: string }

/** A change the plan saw but will not apply without its flag. */
export type GuardedChange = FieldChange & { flag: 'allowFamilyChange' | 'force' }

export type CategoryAction =
  | { kind: 'create'; category: CatalogCategory; guarded: GuardedChange[] }
  | { kind: 'update'; category: CatalogCategory; id: string; changes: FieldChange[]; guarded: GuardedChange[] }
  | { kind: 'skip'; category: CatalogCategory; id: string; guarded: GuardedChange[] }

export type ServiceAction =
  | { kind: 'create'; service: CatalogService; guarded: GuardedChange[] }
  | { kind: 'update'; service: CatalogService; id: string; changes: FieldChange[]; guarded: GuardedChange[] }
  | { kind: 'skip'; service: CatalogService; id: string; guarded: GuardedChange[] }

export type PermissionAction = {
  serviceName: string
  /** Licences with no ALLOW row yet (state-wide, `stateCode` null). */
  missing: ProfessionType[]
}

/** "Also in" links the catalog names that the row does not have yet. */
export type LinkAction = {
  serviceName: string
  /** Category slugs to link (each resolves to an id at apply time). */
  add: string[]
  /** Links the row has that the catalog does not name — reported, never removed. */
  extra: string[]
}

export type ServiceCatalogSeedPlan = {
  categories: CategoryAction[]
  services: ServiceAction[]
  permissions: PermissionAction[]
  links: LinkAction[]
  /** A non-empty list means NOTHING may be applied. */
  refusals: CatalogProblem[]
}

export class ServiceCatalogRefusedError extends Error {
  constructor(public readonly refusals: readonly CatalogProblem[]) {
    super(`service catalog refused: ${refusals.map((r) => `${r.row}: ${r.problem}`).join('; ')}`)
    this.name = 'ServiceCatalogRefusedError'
  }
}

const CATEGORY_SELECT = {
  id: true,
  slug: true,
  name: true,
  description: true,
  parentId: true,
  consultFamily: true,
  isActive: true,
} satisfies Prisma.ServiceCategorySelect

const SERVICE_SELECT = {
  id: true,
  name: true,
  categoryId: true,
  description: true,
  defaultDurationMinutes: true,
  minPrice: true,
  allowMobile: true,
  isAddOnEligible: true,
  addOnGroup: true,
  permissions: { select: { professionType: true, stateCode: true, mode: true } },
  additionalCategoryLinks: { select: { categoryId: true } },
} satisfies Prisma.ServiceSelect

type ExistingCategory = Prisma.ServiceCategoryGetPayload<{ select: typeof CATEGORY_SELECT }>
type ExistingService = Prisma.ServiceGetPayload<{ select: typeof SERVICE_SELECT }>

function show(value: string | number | boolean | null | ConsultServiceFamily): string {
  return value === null ? '∅' : String(value)
}

function planCategory(
  category: CatalogCategory,
  existingBySlug: ReadonlyMap<string, ExistingCategory>,
  slugById: ReadonlyMap<string, string>,
  options: SeedPlanOptions,
): CategoryAction {
  const existing = existingBySlug.get(category.slug)
  if (!existing) return { kind: 'create', category, guarded: [] }

  const changes: FieldChange[] = []
  const guarded: GuardedChange[] = []
  if (existing.name !== category.name) {
    changes.push({ field: 'name', from: existing.name, to: category.name })
  }
  if ((existing.description ?? null) !== category.description) {
    changes.push({ field: 'description', from: show(existing.description), to: category.description })
  }
  const existingParentSlug = existing.parentId === null ? null : slugById.get(existing.parentId) ?? existing.parentId
  if (existingParentSlug !== category.parentSlug) {
    const change = { field: 'parentSlug', from: show(existingParentSlug), to: show(category.parentSlug) }
    if (options.force) changes.push(change)
    else guarded.push({ ...change, flag: 'force' })
  }
  if (existing.consultFamily !== category.consultFamily) {
    const change = { field: 'consultFamily', from: existing.consultFamily, to: category.consultFamily }
    if (options.allowFamilyChange) changes.push(change)
    else guarded.push({ ...change, flag: 'allowFamilyChange' })
  }
  if (changes.length === 0) return { kind: 'skip', category, id: existing.id, guarded }
  return { kind: 'update', category, id: existing.id, changes, guarded }
}

function planService(
  service: CatalogService,
  existing: ExistingService | undefined,
  slugById: ReadonlyMap<string, string>,
  options: SeedPlanOptions,
): ServiceAction {
  if (!existing) return { kind: 'create', service, guarded: [] }

  const changes: FieldChange[] = []
  const guarded: GuardedChange[] = []
  if (existing.defaultDurationMinutes !== service.defaultDurationMinutes) {
    changes.push({ field: 'defaultDurationMinutes', from: show(existing.defaultDurationMinutes), to: show(service.defaultDurationMinutes) })
  }
  if (existing.allowMobile !== service.allowMobile) {
    changes.push({ field: 'allowMobile', from: show(existing.allowMobile), to: show(service.allowMobile) })
  }
  if (existing.isAddOnEligible !== service.isAddOnEligible) {
    changes.push({ field: 'isAddOnEligible', from: show(existing.isAddOnEligible), to: show(service.isAddOnEligible) })
  }
  if ((existing.addOnGroup ?? null) !== service.addOnGroup) {
    changes.push({ field: 'addOnGroup', from: show(existing.addOnGroup), to: show(service.addOnGroup) })
  }
  // An existing description is the admin's words; the catalog only fills a blank.
  if (existing.description === null && service.description !== null) {
    changes.push({ field: 'description', from: '∅', to: service.description })
  }
  const existingFloor = existing.minPrice.toFixed(2)
  if (existingFloor !== service.floorUsd) {
    const change = { field: 'minPrice', from: existingFloor, to: service.floorUsd }
    if (options.force) changes.push(change)
    else guarded.push({ ...change, flag: 'force' })
  }
  const existingCategorySlug = slugById.get(existing.categoryId) ?? existing.categoryId
  if (existingCategorySlug !== service.categorySlug) {
    const change = { field: 'categorySlug', from: existingCategorySlug, to: service.categorySlug }
    if (options.force) changes.push(change)
    else guarded.push({ ...change, flag: 'force' })
  }
  if (changes.length === 0) return { kind: 'skip', service, id: existing.id, guarded }
  return { kind: 'update', service, id: existing.id, changes, guarded }
}

function planLinks(
  service: CatalogService,
  existing: ExistingService | undefined,
  slugById: ReadonlyMap<string, string>,
): LinkAction | null {
  const have = new Set(
    (existing?.additionalCategoryLinks ?? []).map((link) => slugById.get(link.categoryId) ?? link.categoryId),
  )
  const wanted = new Set(service.alsoInCategorySlugs)
  const add = [...wanted].filter((slug) => !have.has(slug))
  const extra = [...have].filter((slug) => !wanted.has(slug))
  return add.length || extra.length ? { serviceName: service.name, add, extra } : null
}

function planPermissions(service: CatalogService, existing: ExistingService | undefined): PermissionAction | null {
  const granted = new Set(
    (existing?.permissions ?? [])
      .filter((row) => row.mode === ServicePermissionMode.ALLOW && row.stateCode === null)
      .map((row) => row.professionType),
  )
  const missing = service.professions.filter((profession) => !granted.has(profession))
  return missing.length ? { serviceName: service.name, missing } : null
}

/**
 * Reads the current rows and decides every action. Refuses (without throwing)
 * when the catalog itself is invalid or a new name would collide with an
 * existing row's normalised name; the caller decides what to do with a refusal.
 */
export async function planServiceCatalogSeed(
  tx: Prisma.TransactionClient,
  catalog: ServiceCatalog,
  options: SeedPlanOptions,
): Promise<ServiceCatalogSeedPlan> {
  const refusals = validateServiceCatalog(catalog)

  const [existingCategories, existingServices] = await Promise.all([
    tx.serviceCategory.findMany({ select: CATEGORY_SELECT }),
    tx.service.findMany({ select: SERVICE_SELECT }),
  ])
  const categoriesBySlug = new Map(existingCategories.map((row) => [row.slug, row]))
  const slugById = new Map(existingCategories.map((row) => [row.id, row.slug]))
  const servicesByName = new Map(existingServices.map((row) => [row.name, row]))
  const servicesByNormalized = new Map(existingServices.map((row) => [normalizeServiceName(row.name), row]))

  const categories = catalog.categories.map((category) => planCategory(category, categoriesBySlug, slugById, options))

  const services: ServiceAction[] = []
  const permissions: PermissionAction[] = []
  const links: LinkAction[] = []
  for (const service of catalog.services) {
    const exact = servicesByName.get(service.name)
    const nearby = servicesByNormalized.get(normalizeServiceName(service.name))
    if (!exact && nearby) {
      refusals.push({
        row: service.name,
        problem: `would sit next to existing row "${nearby.name}", which normalises to the same name`,
      })
      continue
    }
    services.push(planService(service, exact, slugById, options))
    const permission = planPermissions(service, exact)
    if (permission) permissions.push(permission)
    const link = planLinks(service, exact, slugById)
    if (link) links.push(link)
  }

  return { categories, services, permissions, links, refusals }
}

export type SeedApplyOptions = {
  /** Whether a category CREATED by this run starts active. Existing rows keep theirs. */
  activate: boolean
}

export type ServiceCatalogSeedResult = {
  categoriesCreated: number
  categoriesUpdated: number
  servicesCreated: number
  servicesUpdated: number
  permissionsCreated: number
  linksCreated: number
}

/**
 * Writes the plan, and nothing that is not in it. Throws
 * `ServiceCatalogRefusedError` on a plan with refusals, before any write.
 * Runs inside the caller's transaction so a failure anywhere leaves nothing.
 */
export async function applyServiceCatalogSeed(
  tx: Prisma.TransactionClient,
  plan: ServiceCatalogSeedPlan,
  options: SeedApplyOptions,
): Promise<ServiceCatalogSeedResult> {
  if (plan.refusals.length) throw new ServiceCatalogRefusedError(plan.refusals)

  const result: ServiceCatalogSeedResult = {
    categoriesCreated: 0,
    categoriesUpdated: 0,
    servicesCreated: 0,
    servicesUpdated: 0,
    permissionsCreated: 0,
    linksCreated: 0,
  }

  // Categories in catalog order — validation guarantees parents come first,
  // so a child's parent id is always known by the time it is written.
  const categoryIdBySlug = new Map<string, string>()
  for (const action of plan.categories) {
    if (action.kind !== 'create') categoryIdBySlug.set(action.category.slug, action.id)
  }
  for (const action of plan.categories) {
    const { category } = action
    const parentId = category.parentSlug ? categoryIdBySlug.get(category.parentSlug) ?? null : null
    if (category.parentSlug && parentId === null) {
      throw new Error(`parent "${category.parentSlug}" of "${category.slug}" was not resolved`)
    }
    if (action.kind === 'create') {
      const created = await tx.serviceCategory.create({
        data: {
          slug: category.slug,
          name: category.name,
          description: category.description,
          parentId,
          consultFamily: category.consultFamily,
          isActive: options.activate,
        },
        select: { id: true },
      })
      categoryIdBySlug.set(category.slug, created.id)
      result.categoriesCreated += 1
    } else if (action.kind === 'update') {
      const data: Prisma.ServiceCategoryUpdateInput = {}
      for (const change of action.changes) {
        if (change.field === 'name') data.name = category.name
        else if (change.field === 'description') data.description = category.description
        else if (change.field === 'consultFamily') data.consultFamily = category.consultFamily
        else if (change.field === 'parentSlug') {
          data.parent = parentId ? { connect: { id: parentId } } : { disconnect: true }
        }
      }
      await tx.serviceCategory.update({ where: { id: action.id }, data })
      result.categoriesUpdated += 1
    }
  }

  const serviceIdByName = new Map<string, string>()
  for (const action of plan.services) {
    const { service } = action
    const categoryId = categoryIdBySlug.get(service.categorySlug)
    if (categoryId === undefined) {
      throw new Error(`category "${service.categorySlug}" of "${service.name}" was not resolved`)
    }
    if (action.kind === 'create') {
      const created = await tx.service.create({
        data: {
          name: service.name,
          categoryId,
          description: service.description,
          defaultDurationMinutes: service.defaultDurationMinutes,
          minPrice: new Prisma.Decimal(service.floorUsd),
          allowMobile: service.allowMobile,
          isAddOnEligible: service.isAddOnEligible,
          addOnGroup: service.addOnGroup,
          isActive: true,
        },
        select: { id: true },
      })
      serviceIdByName.set(service.name, created.id)
      result.servicesCreated += 1
      continue
    }
    serviceIdByName.set(service.name, action.id)
    if (action.kind !== 'update') continue
    const data: Prisma.ServiceUpdateInput = {}
    for (const change of action.changes) {
      if (change.field === 'defaultDurationMinutes') data.defaultDurationMinutes = service.defaultDurationMinutes
      else if (change.field === 'allowMobile') data.allowMobile = service.allowMobile
      else if (change.field === 'isAddOnEligible') data.isAddOnEligible = service.isAddOnEligible
      else if (change.field === 'addOnGroup') data.addOnGroup = service.addOnGroup
      else if (change.field === 'description') data.description = service.description
      else if (change.field === 'minPrice') data.minPrice = new Prisma.Decimal(service.floorUsd)
      else if (change.field === 'categorySlug') data.category = { connect: { id: categoryId } }
    }
    await tx.service.update({ where: { id: action.id }, data })
    result.servicesUpdated += 1
  }

  for (const permission of plan.permissions) {
    const serviceId = serviceIdByName.get(permission.serviceName)
    if (serviceId === undefined) continue // its service was refused; nothing to grant
    await tx.servicePermission.createMany({
      data: permission.missing.map((professionType) => ({
        serviceId,
        professionType,
        stateCode: null,
        mode: ServicePermissionMode.ALLOW,
      })),
    })
    result.permissionsCreated += permission.missing.length
  }

  for (const link of plan.links) {
    if (!link.add.length) continue
    const serviceId = serviceIdByName.get(link.serviceName)
    if (serviceId === undefined) continue // its service was refused
    const categoryIds = link.add.map((slug) => {
      const id = categoryIdBySlug.get(slug)
      if (id === undefined) throw new Error(`"also in" category "${slug}" of "${link.serviceName}" was not resolved`)
      return id
    })
    await tx.serviceCategoryLink.createMany({
      data: categoryIds.map((categoryId) => ({ serviceId, categoryId })),
      skipDuplicates: true,
    })
    result.linksCreated += categoryIds.length
  }

  return result
}

/** The plan as the CLI prints it: one line per row, then the guarded changes. */
export function formatServiceCatalogSeedPlan(plan: ServiceCatalogSeedPlan): string[] {
  const lines: string[] = []
  for (const action of plan.categories) {
    const label = `category ${action.category.slug}`
    if (action.kind === 'create') lines.push(`  + ${label} ("${action.category.name}")`)
    else if (action.kind === 'update') lines.push(`  ~ ${label}: ${action.changes.map(describeChange).join(', ')}`)
    else lines.push(`  = ${label}`)
    for (const g of action.guarded) lines.push(`    ⚠️ held back (needs --${flagName(g.flag)}): ${describeChange(g)}`)
  }
  for (const action of plan.services) {
    const label = `service "${action.service.name}" [${action.service.categorySlug}]`
    if (action.kind === 'create') lines.push(`  + ${label} ${action.service.defaultDurationMinutes} min, floor $${action.service.floorUsd}`)
    else if (action.kind === 'update') lines.push(`  ~ ${label}: ${action.changes.map(describeChange).join(', ')}`)
    else lines.push(`  = ${label}`)
    for (const g of action.guarded) lines.push(`    ⚠️ held back (needs --${flagName(g.flag)}): ${describeChange(g)}`)
  }
  for (const permission of plan.permissions) {
    lines.push(`  + permission "${permission.serviceName}": ALLOW ${permission.missing.join(', ')}`)
  }
  for (const link of plan.links) {
    if (link.add.length) lines.push(`  + also in "${link.serviceName}": ${link.add.join(', ')}`)
    if (link.extra.length) lines.push(`    ℹ️ "${link.serviceName}" is also linked to ${link.extra.join(', ')} (not in the catalog; left alone)`)
  }
  for (const refusal of plan.refusals) {
    lines.push(`  ✖ REFUSED ${refusal.row}: ${refusal.problem}`)
  }
  return lines
}

function describeChange(change: FieldChange): string {
  return `${change.field} ${change.from} → ${change.to}`
}

function flagName(flag: GuardedChange['flag']): string {
  return flag === 'allowFamilyChange' ? 'allow-family-change' : 'force'
}

/** Totals for the summary line. */
export function summarizeServiceCatalogSeedPlan(plan: ServiceCatalogSeedPlan) {
  const count = <T extends { kind: string }>(actions: readonly T[], kind: string) =>
    actions.filter((a) => a.kind === kind).length
  return {
    categories: {
      create: count(plan.categories, 'create'),
      update: count(plan.categories, 'update'),
      skip: count(plan.categories, 'skip'),
    },
    services: {
      create: count(plan.services, 'create'),
      update: count(plan.services, 'update'),
      skip: count(plan.services, 'skip'),
    },
    permissions: plan.permissions.reduce((sum, p) => sum + p.missing.length, 0),
    links: plan.links.reduce((sum, l) => sum + l.add.length, 0),
    heldBack:
      plan.categories.reduce((sum, a) => sum + a.guarded.length, 0) +
      plan.services.reduce((sum, a) => sum + a.guarded.length, 0),
    refusals: plan.refusals.length,
  }
}
