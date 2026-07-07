// lib/looks/adminTags.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const lookTagFindMany = vi.fn()
  const lookTagFindUnique = vi.fn()
  const lookTagUpdate = vi.fn()
  const lookTagDelete = vi.fn()

  const tx = {
    lookTag: {
      findUnique: lookTagFindUnique,
      update: lookTagUpdate,
      delete: lookTagDelete,
    },
  }

  const prisma = {
    lookTag: {
      findMany: lookTagFindMany,
      findUnique: lookTagFindUnique,
      update: lookTagUpdate,
      delete: lookTagDelete,
    },
    $transaction: vi.fn(async (cb: (db: typeof tx) => unknown) => cb(tx)),
  }

  return {
    lookTagFindMany,
    lookTagFindUnique,
    lookTagUpdate,
    lookTagDelete,
    prisma,
  }
})

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }))

import {
  isAdminLookTagBannedFilter,
  listAdminLookTags,
  mergeLookTags,
  renameLookTag,
  setLookTagBanned,
} from './adminTags'

const NOW = new Date('2026-07-07T12:00:00.000Z')

function tagRow(overrides: Record<string, unknown> = {}) {
  return {
    slug: 'balayage',
    display: 'Balayage',
    bannedAt: null,
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    _count: { looks: 5 },
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('isAdminLookTagBannedFilter', () => {
  it('accepts the known filters only', () => {
    expect(isAdminLookTagBannedFilter('ALL')).toBe(true)
    expect(isAdminLookTagBannedFilter('ACTIVE')).toBe(true)
    expect(isAdminLookTagBannedFilter('BANNED')).toBe(true)
    expect(isAdminLookTagBannedFilter('nope')).toBe(false)
  })
})

describe('listAdminLookTags', () => {
  it('maps rows to DTOs and passes a slug/display search + ban filter', async () => {
    mocks.lookTagFindMany.mockResolvedValue([tagRow(), tagRow({ slug: 'blonde', display: 'Blonde', bannedAt: NOW })])

    const items = await listAdminLookTags({ q: 'Bal', banned: 'ACTIVE' })

    expect(items[0]).toEqual({
      slug: 'balayage',
      display: 'Balayage',
      lookCount: 5,
      banned: false,
      bannedAt: null,
      createdAt: '2026-07-01T00:00:00.000Z',
    })
    expect(items[1]?.banned).toBe(true)

    const where = mocks.lookTagFindMany.mock.calls[0]![0].where
    expect(where.bannedAt).toBeNull()
    // Slug arm normalizes the query to a slug; display arm is case-insensitive.
    expect(where.OR).toEqual([
      { slug: { contains: 'bal' } },
      { display: { contains: 'Bal', mode: 'insensitive' } },
    ])
  })
})

describe('setLookTagBanned', () => {
  it('bans an existing tag with the provided timestamp', async () => {
    mocks.lookTagFindUnique
      .mockResolvedValueOnce({ slug: 'balayage' })
      .mockResolvedValueOnce(tagRow({ bannedAt: NOW }))

    const result = await setLookTagBanned({ slug: 'Balayage', banned: true, now: NOW })

    expect(mocks.lookTagUpdate).toHaveBeenCalledWith({
      where: { slug: 'balayage' },
      data: { bannedAt: NOW },
    })
    expect(result.ok && result.tag.banned).toBe(true)
  })

  it('404s an unknown tag', async () => {
    mocks.lookTagFindUnique.mockResolvedValue(null)
    const result = await setLookTagBanned({ slug: 'ghost', banned: true, now: NOW })
    expect(result).toMatchObject({ ok: false, code: 'NOT_FOUND' })
    expect(mocks.lookTagUpdate).not.toHaveBeenCalled()
  })
})

describe('renameLookTag', () => {
  it('rejects a display that no longer normalizes to the slug', async () => {
    const result = await renameLookTag({ slug: 'balayage', display: 'Something Else' })
    expect(result).toMatchObject({ ok: false, code: 'INVALID' })
    expect(mocks.lookTagUpdate).not.toHaveBeenCalled()
  })

  it('renames the display when it still normalizes to the slug', async () => {
    mocks.lookTagFindUnique
      .mockResolvedValueOnce({ slug: 'balayage' })
      .mockResolvedValueOnce(tagRow({ display: 'BaLaYaGe' }))

    const result = await renameLookTag({ slug: 'balayage', display: 'BaLaYaGe' })

    expect(mocks.lookTagUpdate).toHaveBeenCalledWith({
      where: { slug: 'balayage' },
      data: { display: 'BaLaYaGe' },
    })
    expect(result.ok).toBe(true)
  })
})

describe('mergeLookTags', () => {
  it('reconnects the source looks onto the target then deletes the source', async () => {
    mocks.lookTagFindUnique
      // from
      .mockResolvedValueOnce({ id: 'tag_from', looks: [{ id: 'look_1' }, { id: 'look_2' }] })
      // to
      .mockResolvedValueOnce({ id: 'tag_to' })
      // reload target
      .mockResolvedValueOnce(tagRow({ slug: 'blonde', display: 'Blonde', _count: { looks: 7 } }))

    const result = await mergeLookTags({ fromSlug: 'balayage', toSlug: 'blonde' })

    expect(mocks.lookTagUpdate).toHaveBeenCalledWith({
      where: { id: 'tag_to' },
      data: { looks: { connect: [{ id: 'look_1' }, { id: 'look_2' }] } },
    })
    expect(mocks.lookTagDelete).toHaveBeenCalledWith({ where: { id: 'tag_from' } })
    expect(result).toMatchObject({ ok: true, movedLookCount: 2 })
  })

  it('rejects merging a tag into itself', async () => {
    const result = await mergeLookTags({ fromSlug: 'balayage', toSlug: 'Balayage' })
    expect(result).toMatchObject({ ok: false, code: 'INVALID' })
  })

  it('404s when either tag is missing', async () => {
    mocks.lookTagFindUnique
      .mockResolvedValueOnce({ id: 'tag_from', looks: [] })
      .mockResolvedValueOnce(null)

    const result = await mergeLookTags({ fromSlug: 'balayage', toSlug: 'ghost' })
    expect(result).toMatchObject({ ok: false, code: 'NOT_FOUND' })
    expect(mocks.lookTagDelete).not.toHaveBeenCalled()
  })
})
