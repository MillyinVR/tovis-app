import { describe, expect, it, vi } from 'vitest'

import { setLookPostFeatured } from './featuring'

const NOW = new Date('2026-07-04T12:00:00Z')

function makeDb(existing: {
  id: string
  featuredAt: Date | null
  professionalId: string
  serviceId: string | null
  service: { categoryId: string } | null
} | null) {
  const update = vi.fn().mockImplementation((args: { data: { featuredAt: Date | null } }) =>
    Promise.resolve({ id: 'look_1', featuredAt: args.data.featuredAt }),
  )
  const findUnique = vi.fn().mockResolvedValue(existing)
  return { db: { lookPost: { findUnique, update } }, update }
}

describe('setLookPostFeatured', () => {
  it('features an unfeatured look and returns the scope', async () => {
    const { db, update } = makeDb({
      id: 'look_1',
      featuredAt: null,
      professionalId: 'pro_1',
      serviceId: 'svc_1',
      service: { categoryId: 'cat_1' },
    })

    const result = await setLookPostFeatured(db, {
      lookPostId: 'look_1',
      adminUserId: 'admin_1',
      featured: true,
      now: NOW,
    })

    expect(update).toHaveBeenCalledWith({
      where: { id: 'look_1' },
      data: { featuredAt: NOW, featuredByUserId: 'admin_1' },
      select: { id: true, featuredAt: true },
    })
    expect(result).toEqual({
      found: true,
      changed: true,
      featured: true,
      featuredAt: NOW,
      professionalId: 'pro_1',
      serviceId: 'svc_1',
      categoryId: 'cat_1',
    })
  })

  it('unfeatures a featured look (nulls featuredAt + featuredByUserId)', async () => {
    const { db, update } = makeDb({
      id: 'look_1',
      featuredAt: new Date('2026-07-01T00:00:00Z'),
      professionalId: 'pro_1',
      serviceId: null,
      service: null,
    })

    const result = await setLookPostFeatured(db, {
      lookPostId: 'look_1',
      adminUserId: 'admin_1',
      featured: false,
    })

    expect(update).toHaveBeenCalledWith({
      where: { id: 'look_1' },
      data: { featuredAt: null, featuredByUserId: null },
      select: { id: true, featuredAt: true },
    })
    expect(result).toMatchObject({ found: true, changed: true, featured: false })
  })

  it('is a forgiving no-op when already in the target state', async () => {
    const featuredAt = new Date('2026-07-01T00:00:00Z')
    const { db, update } = makeDb({
      id: 'look_1',
      featuredAt,
      professionalId: 'pro_1',
      serviceId: null,
      service: null,
    })

    const result = await setLookPostFeatured(db, {
      lookPostId: 'look_1',
      adminUserId: 'admin_1',
      featured: true,
    })

    expect(update).not.toHaveBeenCalled()
    expect(result).toEqual({
      found: true,
      changed: false,
      featured: true,
      featuredAt,
      professionalId: 'pro_1',
      serviceId: null,
      categoryId: null,
    })
  })

  it('returns found:false for an unknown look', async () => {
    const { db, update } = makeDb(null)

    const result = await setLookPostFeatured(db, {
      lookPostId: 'nope',
      adminUserId: 'admin_1',
      featured: true,
    })

    expect(result).toEqual({ found: false })
    expect(update).not.toHaveBeenCalled()
  })
})
