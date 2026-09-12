import { Prisma } from '@prisma/client'
import { describe, expect, it } from 'vitest'

import { buildServiceCategoryTree, type CategoryTreeRootRow, type CategoryTreeService } from './categoryTree'

function service(id: string, name = id): CategoryTreeService {
  return {
    id, name, minPrice: new Prisma.Decimal('10.00'), defaultDurationMinutes: 30,
    defaultImageUrl: null, isAddOnEligible: false, addOnGroup: null,
  }
}

const linked = (...items: CategoryTreeService[]) => items.map((s) => ({ service: s }))

function root(args: {
  id: string
  services?: CategoryTreeService[]
  linked?: CategoryTreeService[]
  children?: Array<{ id: string; services?: CategoryTreeService[]; linked?: CategoryTreeService[] }>
}): CategoryTreeRootRow {
  return {
    id: args.id, name: args.id,
    services: args.services ?? [], linkedServices: linked(...(args.linked ?? [])),
    children: (args.children ?? []).map((c) => ({
      id: c.id, name: c.id, services: c.services ?? [], linkedServices: linked(...(c.linked ?? [])),
    })),
  }
}

const names = (items: readonly { name: string }[]) => items.map((i) => i.name)

describe('buildServiceCategoryTree', () => {
  it('lists primary and linked services under a category, sorted by name', () => {
    const [cuts] = buildServiceCategoryTree([
      root({ id: 'cuts', services: [service('Womens Cut')], linked: [service('Buzz Cut'), service('Mens Cut')] }),
    ])
    expect(names(cuts!.services)).toEqual(['Buzz Cut', 'Mens Cut', 'Womens Cut'])
  })

  it('shows a linked service under BOTH top-level categories — that is the point of a link', () => {
    const cut = service('Cut')
    const tree = buildServiceCategoryTree([
      root({ id: 'barbering', linked: [cut] }),
      root({ id: 'cuts', services: [cut] }),
    ])
    expect(tree.map((t) => names(t.services))).toEqual([['Cut'], ['Cut']])
  })

  it('places a service ONCE per top-level subtree: the primary wins over a link', () => {
    const smudge = service('Root Smudge')
    const [color] = buildServiceCategoryTree([
      root({ id: 'hair-color', linked: [smudge], children: [{ id: 'touch-up', services: [smudge] }] }),
    ])
    expect(names(color!.services)).toEqual([])
    expect(names(color!.children[0]!.services)).toEqual(['Root Smudge'])
  })

  it('falls back to the first linked slot in display order (parent, then children by name)', () => {
    const gloss = service('Gloss')
    const [color] = buildServiceCategoryTree([
      root({
        id: 'hair-color',
        children: [
          { id: 'z-touch-up', linked: [gloss] },
          { id: 'a-glossing', linked: [gloss] },
        ],
      }),
    ])
    // Children come back sorted by name, so "a-glossing" is the first slot.
    expect(color!.children.map((c) => [c.id, names(c.services)])).toEqual([
      ['a-glossing', ['Gloss']],
      ['z-touch-up', []],
    ])
    // The concatenated "everything under this category" list a picker builds has no duplicate.
    const all = [...color!.services, ...color!.children.flatMap((c) => c.services)].map((s) => s.id)
    expect(new Set(all).size).toBe(all.length)
  })

  it('does not invent a slot for a service that appears nowhere in a subtree', () => {
    const tree = buildServiceCategoryTree([root({ id: 'empty', children: [{ id: 'child' }] })])
    expect(tree).toEqual([{ id: 'empty', name: 'empty', services: [], children: [{ id: 'child', name: 'child', services: [] }] }])
  })
})
