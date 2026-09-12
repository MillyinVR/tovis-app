// tests/integration/service-category-links.test.ts
//
// A service in more than one category, on real Postgres: the admin write helper
// replaces the link set (and refuses the primary), and the shared picker tree
// lists a linked service under every top-level category it belongs to while
// placing it once per subtree. Everything runs in a rolled-back transaction.

import { randomUUID } from 'node:crypto'

import { ConsultServiceFamily, Prisma, PrismaClient } from '@prisma/client'
import { afterAll, describe, expect, it } from 'vitest'

import { PrimaryCategoryLinkError, replaceServiceCategoryLinks } from '@/lib/services/categoryLinks'
import { loadServiceCategoryTree } from '@/lib/services/categoryTree'

const db = new PrismaClient()
afterAll(() => db.$disconnect())

async function rolledBack(run: (tx: Prisma.TransactionClient, tag: string) => Promise<void>) {
  const rollback = new Error('links case complete')
  const tag = `lnk-${randomUUID().slice(0, 8)}`
  try {
    await db.$transaction(async (tx) => {
      await run(tx, tag)
      throw rollback
    }, { timeout: 30_000 })
  } catch (error) {
    if (error !== rollback) throw error
  }
}

async function seed(tx: Prisma.TransactionClient, tag: string) {
  const category = (slug: string, name: string, parentId: string | null = null, isActive = true) =>
    tx.serviceCategory.create({
      data: { slug: `${tag}-${slug}`, name: `${tag} ${name}`, consultFamily: ConsultServiceFamily.HAIR, parentId, isActive },
      select: { id: true, slug: true },
    })
  const barbering = await category('barbering', 'Barbering')
  const cuts = await category('cuts', 'Cuts')
  const color = await category('color', 'Color')
  const touchUp = await category('touch-up', 'Touch-up', color.id)
  const retired = await category('retired', 'Retired', null, false)
  const service = (name: string, categoryId: string, isActive = true) =>
    tx.service.create({
      data: { name: `${tag} ${name}`, categoryId, defaultDurationMinutes: 30, minPrice: new Prisma.Decimal('20.00'), isActive },
      select: { id: true, name: true },
    })
  const cut = await service('Cut', cuts.id)
  const fade = await service('Fade', barbering.id)
  const smudge = await service('Root Smudge', touchUp.id)
  const gone = await service('Gone', cuts.id, false)
  return { barbering, cuts, color, touchUp, retired, cut, fade, smudge, gone }
}

function subtree(tree: Awaited<ReturnType<typeof loadServiceCategoryTree>>, slugTag: string, id: string) {
  const node = tree.find((c) => c.id === id)
  if (!node) throw new Error(`no category ${slugTag}`)
  return node
}

describe('replaceServiceCategoryLinks', () => {
  it('adds, keeps and removes links to match the set, and refuses the primary before writing', async () => {
    await rolledBack(async (tx, tag) => {
      const f = await seed(tx, tag)
      const first = await replaceServiceCategoryLinks(tx, { serviceId: f.cut.id, primaryCategoryId: f.cuts.id, categoryIds: [f.barbering.id, f.color.id] })
      expect(first).toEqual({ added: 2, removed: 0 })

      const second = await replaceServiceCategoryLinks(tx, { serviceId: f.cut.id, primaryCategoryId: f.cuts.id, categoryIds: [f.color.id, f.touchUp.id] })
      expect(second).toEqual({ added: 1, removed: 1 })
      const links = await tx.serviceCategoryLink.findMany({ where: { serviceId: f.cut.id }, select: { categoryId: true } })
      expect(links.map((l) => l.categoryId).sort()).toEqual([f.color.id, f.touchUp.id].sort())

      await expect(
        replaceServiceCategoryLinks(tx, { serviceId: f.cut.id, primaryCategoryId: f.cuts.id, categoryIds: [f.cuts.id] }),
      ).rejects.toBeInstanceOf(PrimaryCategoryLinkError)
      // Nothing changed on the refusal.
      expect((await tx.serviceCategoryLink.count({ where: { serviceId: f.cut.id } }))).toBe(2)

      expect(await replaceServiceCategoryLinks(tx, { serviceId: f.cut.id, primaryCategoryId: f.cuts.id, categoryIds: [] })).toEqual({ added: 0, removed: 2 })
    })
  })

  it('fails the whole call on a category that does not exist', async () => {
    await rolledBack(async (tx, tag) => {
      const f = await seed(tx, tag)
      await expect(
        replaceServiceCategoryLinks(tx, { serviceId: f.cut.id, primaryCategoryId: f.cuts.id, categoryIds: ['no-such-category'] }),
      ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError)
    })
  })
})

describe('loadServiceCategoryTree with links', () => {
  it('lists a linked service under every top-level category, once per subtree, active rows only', async () => {
    await rolledBack(async (tx, tag) => {
      const f = await seed(tx, tag)
      await tx.serviceCategoryLink.createMany({
        data: [
          { serviceId: f.cut.id, categoryId: f.barbering.id }, // Cut: Cuts (primary) + Barbering
          { serviceId: f.smudge.id, categoryId: f.color.id }, // Smudge: Touch-up (primary child) + its parent Color
          { serviceId: f.fade.id, categoryId: f.retired.id }, // a link into an inactive category is not shown
          { serviceId: f.gone.id, categoryId: f.barbering.id }, // an inactive service is not shown anywhere
        ],
      })
      const tree = await loadServiceCategoryTree(tx)

      const barbering = subtree(tree, 'barbering', f.barbering.id)
      expect(barbering.services.map((s) => s.name).sort()).toEqual([`${tag} Cut`, `${tag} Fade`])

      const cuts = subtree(tree, 'cuts', f.cuts.id)
      expect(cuts.services.map((s) => s.name)).toEqual([`${tag} Cut`])

      // Primary wins inside a subtree: the smudge shows under Touch-up, not also under Color.
      const color = subtree(tree, 'color', f.color.id)
      expect(color.services).toEqual([])
      expect(color.children.map((c) => [c.id, c.services.map((s) => s.name)])).toEqual([[f.touchUp.id, [`${tag} Root Smudge`]]])

      expect(tree.find((c) => c.id === f.retired.id)).toBeUndefined()
    })
  })
})
