// tests/integration/service-catalog-seed.test.ts
//
// The catalog seed against real Postgres: what it creates, what it refuses, what
// it holds back, and that a second run changes nothing. Every case runs inside
// a transaction that is rolled back, on a tagged synthetic catalog, so the
// shared test database is never left with rows (and the dev seed's own
// catalog — which spells "Root Touch-Up" the way production does NOT — never
// collides with the real one here; the real catalog's own proof is the
// scratch-database run recorded in the PR).

import { randomUUID } from 'node:crypto'

import {
  ConsultServiceFamily,
  Prisma,
  PrismaClient,
  ProfessionType,
  ServicePermissionMode,
} from '@prisma/client'
import { afterAll, describe, expect, it } from 'vitest'

import { validateServiceCatalog, type ServiceCatalog } from '@/lib/services/catalog'
import {
  ServiceCatalogRefusedError,
  applyServiceCatalogSeed,
  planServiceCatalogSeed,
  summarizeServiceCatalogSeedPlan,
} from '@/lib/services/catalog/seedPlan'

const db = new PrismaClient()
afterAll(() => db.$disconnect())

const OPEN = { allowFamilyChange: false, force: false }

function syntheticCatalog(tag: string): ServiceCatalog {
  return {
    categories: [
      { slug: `${tag}-color`, name: 'Color', description: 'Colour.', parentSlug: null, consultFamily: ConsultServiceFamily.HAIR },
      { slug: `${tag}-cuts`, name: 'Cuts', description: 'Cuts.', parentSlug: null, consultFamily: ConsultServiceFamily.HAIR },
      { slug: `${tag}-touch-up`, name: 'Touch-up', description: 'Child.', parentSlug: `${tag}-color`, consultFamily: ConsultServiceFamily.HAIR },
    ],
    services: [
      {
        name: `${tag} Balayage`, categorySlug: `${tag}-color`, defaultDurationMinutes: 180, floorUsd: '150.00',
        allowMobile: true, isAddOnEligible: false, addOnGroup: null, description: 'Hand-painted.',
        professions: [ProfessionType.COSMETOLOGIST, ProfessionType.HAIRSTYLIST],
      },
      {
        name: `${tag} Root Smudge`, categorySlug: `${tag}-touch-up`, defaultDurationMinutes: 30, floorUsd: '30.00',
        allowMobile: true, isAddOnEligible: true, addOnGroup: 'Color', description: null,
        professions: [ProfessionType.COSMETOLOGIST],
      },
      {
        name: `${tag} Cut`, categorySlug: `${tag}-cuts`, defaultDurationMinutes: 45, floorUsd: '35.00',
        allowMobile: false, isAddOnEligible: false, addOnGroup: null, description: 'A cut.',
        professions: [ProfessionType.COSMETOLOGIST, ProfessionType.BARBER],
      },
    ],
  }
}

async function rolledBack(run: (tx: Prisma.TransactionClient, tag: string) => Promise<void>) {
  const rollback = new Error('catalog seed case complete')
  const tag = `cat-${randomUUID().slice(0, 8)}`
  try {
    await db.$transaction(async (tx) => {
      await run(tx, tag)
      throw rollback
    }, { timeout: 30_000 })
  } catch (error) {
    if (error !== rollback) throw error
  }
}

async function readBack(tx: Prisma.TransactionClient, tag: string) {
  const categories = await tx.serviceCategory.findMany({
    where: { slug: { startsWith: `${tag}-` } },
    orderBy: { slug: 'asc' },
    select: { slug: true, name: true, isActive: true, consultFamily: true, parent: { select: { slug: true } } },
  })
  const services = await tx.service.findMany({
    where: { name: { startsWith: `${tag} ` } },
    orderBy: { name: 'asc' },
    select: {
      name: true, minPrice: true, defaultDurationMinutes: true, allowMobile: true, isAddOnEligible: true,
      addOnGroup: true, description: true, isActive: true, category: { select: { slug: true } },
      permissions: { select: { professionType: true, stateCode: true, mode: true } },
    },
  })
  return { categories, services }
}

describe('the service catalog seed', () => {
  it('creates categories (parents first), services and permissions, and a second run is a no-op', async () => {
    await rolledBack(async (tx, tag) => {
      const catalog = syntheticCatalog(tag)
      expect(validateServiceCatalog(catalog)).toEqual([])

      const plan = await planServiceCatalogSeed(tx, catalog, OPEN)
      expect(plan.refusals).toEqual([])
      expect(summarizeServiceCatalogSeedPlan(plan)).toEqual({
        categories: { create: 3, update: 0, skip: 0 },
        services: { create: 3, update: 0, skip: 0 },
        permissions: 5,
        heldBack: 0,
        refusals: 0,
      })

      const result = await applyServiceCatalogSeed(tx, plan, { activate: true })
      expect(result).toEqual({ categoriesCreated: 3, categoriesUpdated: 0, servicesCreated: 3, servicesUpdated: 0, permissionsCreated: 5 })

      const { categories, services } = await readBack(tx, tag)
      expect(categories.map((c) => [c.slug, c.isActive, c.parent?.slug ?? null])).toEqual([
        [`${tag}-color`, true, null],
        [`${tag}-cuts`, true, null],
        [`${tag}-touch-up`, true, `${tag}-color`],
      ])
      const smudge = services.find((s) => s.name === `${tag} Root Smudge`)
      expect(smudge).toMatchObject({
        minPrice: new Prisma.Decimal('30.00'), defaultDurationMinutes: 30, isAddOnEligible: true, addOnGroup: 'Color',
        description: null, isActive: true, category: { slug: `${tag}-touch-up` },
        permissions: [{ professionType: ProfessionType.COSMETOLOGIST, stateCode: null, mode: ServicePermissionMode.ALLOW }],
      })
      const cut = services.find((s) => s.name === `${tag} Cut`)
      expect(cut?.permissions.map((p) => p.professionType).sort()).toEqual([ProfessionType.BARBER, ProfessionType.COSMETOLOGIST])

      // Second run: everything is a skip, nothing to write.
      const again = await planServiceCatalogSeed(tx, catalog, OPEN)
      expect(summarizeServiceCatalogSeedPlan(again)).toEqual({
        categories: { create: 0, update: 0, skip: 3 },
        services: { create: 0, update: 0, skip: 3 },
        permissions: 0,
        heldBack: 0,
        refusals: 0,
      })
      const second = await applyServiceCatalogSeed(tx, again, { activate: true })
      expect(second).toEqual({ categoriesCreated: 0, categoriesUpdated: 0, servicesCreated: 0, servicesUpdated: 0, permissionsCreated: 0 })
    })
  })

  it('creates new categories inactive unless asked, and never touches an existing one’s activeness', async () => {
    await rolledBack(async (tx, tag) => {
      const catalog = syntheticCatalog(tag)
      await tx.serviceCategory.create({
        data: { slug: `${tag}-color`, name: 'Color', description: 'Colour.', consultFamily: ConsultServiceFamily.HAIR, isActive: true },
      })
      const plan = await planServiceCatalogSeed(tx, catalog, OPEN)
      await applyServiceCatalogSeed(tx, plan, { activate: false })
      const { categories } = await readBack(tx, tag)
      expect(categories.map((c) => [c.slug, c.isActive])).toEqual([
        [`${tag}-color`, true],
        [`${tag}-cuts`, false],
        [`${tag}-touch-up`, false],
      ])
    })
  })

  it('holds a floor change back without --force, and applies it with', async () => {
    await rolledBack(async (tx, tag) => {
      const catalog = syntheticCatalog(tag)
      const color = await tx.serviceCategory.create({
        data: { slug: `${tag}-color`, name: 'Color', description: 'Colour.', consultFamily: ConsultServiceFamily.HAIR },
      })
      await tx.service.create({
        data: { name: `${tag} Balayage`, categoryId: color.id, defaultDurationMinutes: 180, minPrice: new Prisma.Decimal('180.00'), allowMobile: true },
      })

      const held = await planServiceCatalogSeed(tx, catalog, OPEN)
      const balayage = held.services.find((a) => a.service.name === `${tag} Balayage`)
      expect(balayage?.kind).toBe('update') // the blank description is filled
      expect(balayage?.kind === 'update' && balayage.changes.map((c) => c.field)).toEqual(['description'])
      expect(balayage?.guarded).toEqual([{ field: 'minPrice', from: '180.00', to: '150.00', flag: 'force' }])
      await applyServiceCatalogSeed(tx, held, { activate: true })
      let row = await tx.service.findUniqueOrThrow({ where: { name: `${tag} Balayage` }, select: { minPrice: true, description: true } })
      expect(row.minPrice.toFixed(2)).toBe('180.00')
      expect(row.description).toBe('Hand-painted.')

      const forced = await planServiceCatalogSeed(tx, catalog, { ...OPEN, force: true })
      const forcedRow = forced.services.find((a) => a.service.name === `${tag} Balayage`)
      expect(forcedRow?.kind === 'update' && forcedRow.changes.map((c) => c.field)).toEqual(['minPrice'])
      await applyServiceCatalogSeed(tx, forced, { activate: true })
      row = await tx.service.findUniqueOrThrow({ where: { name: `${tag} Balayage` }, select: { minPrice: true, description: true } })
      expect(row.minPrice.toFixed(2)).toBe('150.00')
    })
  })

  it('holds a consult-family change back without --allow-family-change, and a parent move without --force', async () => {
    await rolledBack(async (tx, tag) => {
      const catalog = syntheticCatalog(tag)
      const color = await tx.serviceCategory.create({
        data: { slug: `${tag}-color`, name: 'Colour (old name)', description: null, consultFamily: ConsultServiceFamily.OTHER },
      })
      await tx.serviceCategory.create({
        data: { slug: `${tag}-touch-up`, name: 'Touch-up', description: 'Child.', consultFamily: ConsultServiceFamily.HAIR, parentId: null },
      })
      const cuts = await tx.serviceCategory.create({
        data: { slug: `${tag}-cuts`, name: 'Cuts', description: 'Cuts.', consultFamily: ConsultServiceFamily.HAIR },
      })
      // An existing service filed under the wrong category.
      await tx.service.create({
        data: { name: `${tag} Cut`, categoryId: color.id, defaultDurationMinutes: 45, minPrice: new Prisma.Decimal('35.00'), allowMobile: false, description: 'A cut.' },
      })
      void cuts

      const held = await planServiceCatalogSeed(tx, catalog, OPEN)
      const colorAction = held.categories.find((a) => a.category.slug === `${tag}-color`)
      expect(colorAction?.kind).toBe('update') // name + description are free to change
      expect(colorAction?.guarded).toEqual([{ field: 'consultFamily', from: 'OTHER', to: 'HAIR', flag: 'allowFamilyChange' }])
      const touchUp = held.categories.find((a) => a.category.slug === `${tag}-touch-up`)
      expect(touchUp?.kind).toBe('skip')
      expect(touchUp?.guarded).toEqual([{ field: 'parentSlug', from: '∅', to: `${tag}-color`, flag: 'force' }])
      const cutAction = held.services.find((a) => a.service.name === `${tag} Cut`)
      expect(cutAction?.kind).toBe('skip')
      expect(cutAction?.guarded).toEqual([{ field: 'categorySlug', from: `${tag}-color`, to: `${tag}-cuts`, flag: 'force' }])

      await applyServiceCatalogSeed(tx, held, { activate: true })
      let back = await readBack(tx, tag)
      expect(back.categories.find((c) => c.slug === `${tag}-color`)).toMatchObject({ name: 'Color', consultFamily: ConsultServiceFamily.OTHER })
      expect(back.categories.find((c) => c.slug === `${tag}-touch-up`)?.parent).toBeNull()
      expect(back.services.find((s) => s.name === `${tag} Cut`)?.category.slug).toBe(`${tag}-color`)

      const allowed = await planServiceCatalogSeed(tx, catalog, { allowFamilyChange: true, force: true })
      expect(summarizeServiceCatalogSeedPlan(allowed).heldBack).toBe(0)
      await applyServiceCatalogSeed(tx, allowed, { activate: true })
      back = await readBack(tx, tag)
      expect(back.categories.find((c) => c.slug === `${tag}-color`)?.consultFamily).toBe(ConsultServiceFamily.HAIR)
      expect(back.categories.find((c) => c.slug === `${tag}-touch-up`)?.parent?.slug).toBe(`${tag}-color`)
      expect(back.services.find((s) => s.name === `${tag} Cut`)?.category.slug).toBe(`${tag}-cuts`)
    })
  })

  it('refuses a name that normalises onto an existing row spelled differently, and writes nothing', async () => {
    await rolledBack(async (tx, tag) => {
      const catalog = syntheticCatalog(tag)
      const color = await tx.serviceCategory.create({
        data: { slug: `${tag}-color`, name: 'Color', description: 'Colour.', consultFamily: ConsultServiceFamily.HAIR },
      })
      await tx.service.create({
        data: { name: `${tag} Root-Smudge`, categoryId: color.id, defaultDurationMinutes: 30, minPrice: new Prisma.Decimal('30.00') },
      })

      const plan = await planServiceCatalogSeed(tx, catalog, OPEN)
      expect(plan.refusals).toEqual([
        { row: `${tag} Root Smudge`, problem: `would sit next to existing row "${tag} Root-Smudge", which normalises to the same name` },
      ])
      // The other rows are still planned, so the operator sees the whole picture…
      expect(plan.services.map((a) => a.service.name).sort()).toEqual([`${tag} Balayage`, `${tag} Cut`])
      // …but nothing is applied.
      await expect(applyServiceCatalogSeed(tx, plan, { activate: true })).rejects.toBeInstanceOf(ServiceCatalogRefusedError)
      const { categories, services } = await readBack(tx, tag)
      expect(categories.map((c) => c.slug)).toEqual([`${tag}-color`])
      expect(services.map((s) => s.name)).toEqual([`${tag} Root-Smudge`])
    })
  })

  it('refuses an invalid catalog before reading anything it would write', async () => {
    await rolledBack(async (tx, tag) => {
      const catalog = syntheticCatalog(tag)
      const [first] = catalog.services
      if (!first) throw new Error('fixture has no service')
      const broken: ServiceCatalog = { ...catalog, services: [{ ...first, floorUsd: '-5' }] }
      const plan = await planServiceCatalogSeed(tx, broken, OPEN)
      expect(plan.refusals.map((r) => r.problem)).toContain('floor must be a non-negative amount with exactly two decimals')
      await expect(applyServiceCatalogSeed(tx, plan, { activate: true })).rejects.toBeInstanceOf(ServiceCatalogRefusedError)
      expect((await readBack(tx, tag)).categories).toEqual([])
    })
  })

  it('grants only the missing licences, never duplicating a permission row', async () => {
    await rolledBack(async (tx, tag) => {
      const catalog = syntheticCatalog(tag)
      const cuts = await tx.serviceCategory.create({
        data: { slug: `${tag}-cuts`, name: 'Cuts', description: 'Cuts.', consultFamily: ConsultServiceFamily.HAIR },
      })
      const cut = await tx.service.create({
        data: { name: `${tag} Cut`, categoryId: cuts.id, defaultDurationMinutes: 45, minPrice: new Prisma.Decimal('35.00'), description: 'A cut.' },
      })
      await tx.servicePermission.create({ data: { serviceId: cut.id, professionType: ProfessionType.BARBER, stateCode: null, mode: ServicePermissionMode.ALLOW } })
      // A state-scoped grant does not count as the state-wide one the catalog grants.
      await tx.servicePermission.create({ data: { serviceId: cut.id, professionType: ProfessionType.COSMETOLOGIST, stateCode: 'CA', mode: ServicePermissionMode.ALLOW } })

      const plan = await planServiceCatalogSeed(tx, catalog, OPEN)
      expect(plan.permissions.find((p) => p.serviceName === `${tag} Cut`)).toEqual({ serviceName: `${tag} Cut`, missing: [ProfessionType.COSMETOLOGIST] })
      await applyServiceCatalogSeed(tx, plan, { activate: true })
      // Postgres orders an enum by declaration, not alphabet — sort here instead.
      const rows = (await tx.servicePermission.findMany({ where: { serviceId: cut.id }, select: { professionType: true, stateCode: true } }))
        .sort((a, b) => a.professionType.localeCompare(b.professionType) || (a.stateCode ?? '').localeCompare(b.stateCode ?? ''))
      expect(rows).toEqual([
        { professionType: ProfessionType.BARBER, stateCode: null },
        { professionType: ProfessionType.COSMETOLOGIST, stateCode: null },
        { professionType: ProfessionType.COSMETOLOGIST, stateCode: 'CA' },
      ])
    })
  })
})
