import { ConsultServiceFamily, ProfessionType } from '@prisma/client'
import { describe, expect, it } from 'vitest'

import {
  CONSULT_SAFETY_SERVICE_BOOKING_RULES,
  isStrandTestOptionalAddOn,
} from '@/lib/consult/safetyRouting'
import { HAIR_COLOR_CATEGORY_SLUG } from '@/lib/consult/serviceScope'
import { normalizeServiceName } from '@/lib/migration/serviceMatch'

import {
  SERVICE_CATALOG,
  catalogFloorCents,
  validateServiceCatalog,
  type CatalogCategory,
  type CatalogService,
  type ServiceCatalog,
} from './index'
import { HAIR_CATALOG_CATEGORIES, HAIR_SAFETY_TEST_SERVICES } from './hair'
import { HAIR_CUTS_CATEGORY_SLUG, HAIR_HAIRCUT_CATEGORY_SLUG, HAIR_TREATMENT_CATEGORY_SLUG } from './slugs'

/**
 * Production's twelve rows as they stood on 2026-09-12 (SQL against
 * rqhhvuaoksuvbvlypztn). The catalog must carry their NAMES, DURATIONS and
 * FLOORS verbatim: the seed never renames (name is the unique key — a
 * respelling is a second row) and holds a floor change back (a floor is
 * enforced against every live offering). Each row's category is the one it
 * lives in today; the ONE deliberate move is listed separately below.
 */
const PROD_ROWS_2026_09_12: ReadonlyArray<[name: string, categorySlug: string, minutes: number, floor: string]> = [
  ['Beard Trim', 'cuts', 20, '20.00'],
  ['Cut', 'cuts', 40, '35.00'],
  ['Cut & Beard Trim', 'cuts', 50, '45.00'],
  ['Mens Cut', 'cuts', 30, '35.00'],
  ['Military Cut', 'cuts', 30, '25.00'],
  ['Student Cut', 'cuts', 30, '25.00'],
  ['Full Head Highlight', 'hair-color', 120, '203.00'],
  ['Partial Highlight', 'hair-color', 75, '153.00'],
  ['Root touch up', 'hair-color', 75, '55.00'],
  ['Toner', 'hair-color', 15, '30.00'],
  ['iTip install', 'hair-extensions', 120, '300.00'],
  ['iTip Maintenance', 'hair-extensions', 60, '200.00'],
]

/**
 * Tori's 2026-09-12 call: the generic "Cut" is a salon cut first. The seed
 * applies a category move only with --force, so this is a visible step in the
 * prod run, not a side effect. It stays listed under Barbering through a link.
 */
const DELIBERATE_CATEGORY_MOVES: ReadonlyMap<string, string> = new Map([['Cut', HAIR_HAIRCUT_CATEGORY_SLUG]])

const PROD_CATEGORY_SLUGS_2026_09_12 = ['cuts', 'hair-color', 'hair-extensions']

function byName(name: string): CatalogService {
  const row = SERVICE_CATALOG.services.find((s) => s.name === name)
  if (!row) throw new Error(`catalog has no "${name}"`)
  return row
}

describe('the hair service catalog', () => {
  it('is valid', () => {
    expect(validateServiceCatalog(SERVICE_CATALOG)).toEqual([])
  })

  it("carries production's existing rows verbatim", () => {
    for (const [name, categorySlug, minutes, floor] of PROD_ROWS_2026_09_12) {
      const row = byName(name)
      expect(row.categorySlug, name).toBe(DELIBERATE_CATEGORY_MOVES.get(name) ?? categorySlug)
      if (DELIBERATE_CATEGORY_MOVES.has(name)) {
        // Still browsable where prod has it today.
        expect(row.alsoInCategorySlugs, name).toContain(categorySlug)
      }
      expect(row.defaultDurationMinutes, name).toBe(minutes)
      expect(row.floorUsd, name).toBe(floor)
    }
    for (const slug of PROD_CATEGORY_SLUGS_2026_09_12) {
      expect(HAIR_CATALOG_CATEGORIES.map((c) => c.slug)).toContain(slug)
    }
  })

  it('is a HAIR menu: every category resolves the hair consult packs', () => {
    expect(new Set(HAIR_CATALOG_CATEGORIES.map((c) => c.consultFamily))).toEqual(
      new Set([ConsultServiceFamily.HAIR]),
    )
  })

  it('splits Barbering from Cuts and lets a cut live in both without a second row', () => {
    expect(HAIR_CATALOG_CATEGORIES.find((c) => c.slug === HAIR_CUTS_CATEGORY_SLUG)?.name).toBe('Barbering')
    expect(HAIR_CATALOG_CATEGORIES.find((c) => c.slug === HAIR_HAIRCUT_CATEGORY_SLUG)?.name).toBe('Cuts')
    expect(byName('Straight Razor Fade').categorySlug).toBe(HAIR_CUTS_CATEGORY_SLUG)
    expect(byName('Womens Cut & Style').categorySlug).toBe(HAIR_HAIRCUT_CATEGORY_SLUG)
    expect(byName('Mens Cut')).toMatchObject({ categorySlug: HAIR_CUTS_CATEGORY_SLUG, alsoInCategorySlugs: [HAIR_HAIRCUT_CATEGORY_SLUG] })
    expect(byName('Cut')).toMatchObject({ categorySlug: HAIR_HAIRCUT_CATEGORY_SLUG, alsoInCategorySlugs: [HAIR_CUTS_CATEGORY_SLUG] })
    // A link never points at the row's own primary, and every link is a known category.
    const slugs = new Set(HAIR_CATALOG_CATEGORIES.map((c) => c.slug))
    for (const row of SERVICE_CATALOG.services) {
      for (const also of row.alsoInCategorySlugs) {
        expect(also, row.name).not.toBe(row.categorySlug)
        expect(slugs.has(also), `${row.name} → ${also}`).toBe(true)
      }
    }
  })

  it('covers cuts, colour, extensions, treatments, styling and braids', () => {
    const perCategory = new Map<string, number>()
    for (const row of SERVICE_CATALOG.services) {
      perCategory.set(row.categorySlug, (perCategory.get(row.categorySlug) ?? 0) + 1)
    }
    for (const category of HAIR_CATALOG_CATEGORIES) {
      expect(perCategory.get(category.slug) ?? 0, category.slug).toBeGreaterThanOrEqual(6)
    }
  })

  it('derives the safety tests from the routing rules, so the analysis can find them by exact name', () => {
    const rules = CONSULT_SAFETY_SERVICE_BOOKING_RULES
    const patch = byName(rules.PATCH_TEST.name)
    const strand = byName(rules.STRAND_TEST.name)
    expect(patch.defaultDurationMinutes).toBe(rules.PATCH_TEST.durationMinutes)
    expect(catalogFloorCents(patch)).toBe(rules.PATCH_TEST.priceCents)
    expect(strand.defaultDurationMinutes).toBe(rules.STRAND_TEST.durationMinutes)
    expect(catalogFloorCents(strand)).toBe(rules.STRAND_TEST.priceCents)
    expect(HAIR_SAFETY_TEST_SERVICES.map((s) => s.name).sort()).toEqual(
      [rules.PATCH_TEST.name, rules.STRAND_TEST.name].sort(),
    )
    // They are the only $0 rows besides the consultations a pro may price herself.
    const free = SERVICE_CATALOG.services.filter((s) => catalogFloorCents(s) === 0).map((s) => s.name).sort()
    expect(free).toEqual(
      [rules.PATCH_TEST.name, rules.STRAND_TEST.name, 'Color Consultation', 'Extensions Consultation'].sort(),
    )
  })

  it('gives the consult a consultation row to resolve in the colour and extensions categories', () => {
    // analysisContract resolves a CONSULTATION recommendation to an offering
    // whose name matches /\bconsult/i within the session's category.
    expect(byName('Color Consultation').categorySlug).toBe(HAIR_COLOR_CATEGORY_SLUG)
    expect(byName('Extensions Consultation').categorySlug).toBe('hair-extensions')
    expect(/\bconsult/i.test('Color Consultation')).toBe(true)
  })

  it('offers the strand-test add-ons the routing rule recognises', () => {
    const deep = byName('Deep Conditioning Treatment')
    expect(deep.categorySlug).toBe(HAIR_TREATMENT_CATEGORY_SLUG)
    expect(isStrandTestOptionalAddOn({ categorySlug: deep.categorySlug, serviceName: deep.name })).toBe(true)
    const cut = byName('Womens Cut & Style')
    expect(cut.categorySlug).toBe(HAIR_HAIRCUT_CATEGORY_SLUG)
    expect(isStrandTestOptionalAddOn({ categorySlug: cut.categorySlug, serviceName: cut.name })).toBe(true)
    const fade = byName('Straight Razor Fade')
    expect(fade.categorySlug).toBe(HAIR_CUTS_CATEGORY_SLUG)
    expect(isStrandTestOptionalAddOn({ categorySlug: fade.categorySlug, serviceName: fade.name })).toBe(true)
    const keratin = byName('Keratin Smoothing Treatment')
    expect(isStrandTestOptionalAddOn({ categorySlug: keratin.categorySlug, serviceName: keratin.name })).toBe(false)
  })

  it('keeps every new floor at or under the existing colour floors — a floor refuses a real price', () => {
    // The two highest floors are production's own (Tori's prices); nothing
    // this catalog adds may sit above a full head of foils.
    const ceiling = catalogFloorCents(byName('Full Head Highlight'))
    const above = SERVICE_CATALOG.services
      .filter((s) => !PROD_ROWS_2026_09_12.some(([name]) => name === s.name))
      .filter((s) => catalogFloorCents(s) > ceiling)
      .map((s) => s.name)
    expect(above).toEqual([])
  })

  it('carries no brand names', () => {
    const text = SERVICE_CATALOG.services.map((s) => `${s.name} ${s.description ?? ''}`).join('\n')
    expect(text).not.toMatch(/olaplex|brazilian blowout|k18|shellac|wella|redken|schwarzkopf/i)
  })

  it('grants every row to a hair licence, cuts to barbers, braids to braiders', () => {
    for (const row of SERVICE_CATALOG.services) {
      expect(row.professions, row.name).toContain(ProfessionType.COSMETOLOGIST)
      expect(row.professions, row.name).toContain(ProfessionType.HAIRSTYLIST)
      expect(row.professions.includes(ProfessionType.BARBER), row.name).toBe(
        row.categorySlug === HAIR_CUTS_CATEGORY_SLUG || row.categorySlug === HAIR_HAIRCUT_CATEGORY_SLUG,
      )
      expect(row.professions.includes(ProfessionType.HAIR_BRAIDER), row.name).toBe(row.categorySlug === 'braiding')
    }
  })
})

describe('validateServiceCatalog', () => {
  const parent: CatalogCategory = { slug: 'parent', name: 'Parent', description: 'p', parentSlug: null, consultFamily: ConsultServiceFamily.HAIR }
  const child: CatalogCategory = { slug: 'child', name: 'Child', description: 'c', parentSlug: 'parent', consultFamily: ConsultServiceFamily.HAIR }
  const row: CatalogService = {
    name: 'Row One', categorySlug: 'child', alsoInCategorySlugs: [], defaultDurationMinutes: 30, floorUsd: '10.00',
    allowMobile: true, isAddOnEligible: false, addOnGroup: null, description: null, professions: [ProfessionType.COSMETOLOGIST],
  }
  const base: ServiceCatalog = { categories: [parent, child], services: [row] }

  it('accepts a well-formed catalog, including a link to another category', () => {
    expect(validateServiceCatalog(base)).toEqual([])
    expect(validateServiceCatalog({ ...base, services: [{ ...row, alsoInCategorySlugs: ['parent'] }] })).toEqual([])
  })

  it.each<[string, ServiceCatalog, string]>([
    ['a child listed before its parent', { ...base, categories: [child, parent] }, 'must be listed before'],
    ['three levels of nesting', { ...base, categories: [...base.categories, { slug: 'grandchild', name: 'G', description: 'g', parentSlug: 'child', consultFamily: ConsultServiceFamily.HAIR }] }, 'at most two levels'],
    ['a non-kebab slug', { ...base, categories: [{ ...parent, slug: 'Parent Slug' }] }, 'kebab-case'],
    ['a duplicate slug', { ...base, categories: [parent, parent] }, 'duplicate category slug'],
    ['a duplicate name', { ...base, services: [row, row] }, 'duplicate service name'],
    ['two names that normalise alike', { ...base, services: [row, { ...row, name: 'row-one' }] }, 'normalises the same as'],
    ['an unknown category', { ...base, services: [{ ...row, categorySlug: 'nope' }] }, 'unknown category'],
    ['a duration under five minutes', { ...base, services: [{ ...row, defaultDurationMinutes: 4 }] }, 'at least 5 minutes'],
    ['a fractional duration', { ...base, services: [{ ...row, defaultDurationMinutes: 30.5 }] }, 'whole number'],
    ['a floor without two decimals', { ...base, services: [{ ...row, floorUsd: '10' }] }, 'exactly two decimals'],
    ['a negative floor', { ...base, services: [{ ...row, floorUsd: '-1.00' }] }, 'exactly two decimals'],
    ['an add-on group on a non-add-on', { ...base, services: [{ ...row, addOnGroup: 'Finish' }] }, 'not add-on eligible'],
    ['an empty description', { ...base, services: [{ ...row, description: ' ' }] }, 'use null'],
    ['a row granting no licence', { ...base, services: [{ ...row, professions: [] }] }, 'grants no licence'],
    ['a padded name', { ...base, services: [{ ...row, name: ' Row One' }] }, 'surrounding whitespace'],
    ['an unknown "also in" category', { ...base, services: [{ ...row, alsoInCategorySlugs: ['nope'] }] }, 'unknown "also in" category'],
    ['an "also in" equal to the primary', { ...base, services: [{ ...row, alsoInCategorySlugs: ['child'] }] }, 'names its own primary'],
    ['a repeated "also in"', { ...base, services: [{ ...row, alsoInCategorySlugs: ['parent', 'parent'] }] }, 'lists an "also in" category twice'],
  ])('refuses %s', (_label, catalog, problem) => {
    const problems = validateServiceCatalog(catalog)
    expect(problems.map((p) => p.problem).join('\n')).toContain(problem)
  })

  it('uses the same normaliser the consult matches menu names with', () => {
    expect(normalizeServiceName('Root Touch-Up')).toBe(normalizeServiceName('Root touch up'))
  })
})
