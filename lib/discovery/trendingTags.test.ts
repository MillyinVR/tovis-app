// lib/discovery/trendingTags.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  prisma: {
    lookTag: { findMany: vi.fn() },
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }))

import { getTrendingLookTags, parseTrendingTagsResponse } from './trendingTags'
import { rootTenantContext } from '@/lib/tenant/context'

const TENANT = rootTenantContext('tenant-root')
const NOW = new Date('2026-07-07T12:00:00.000Z')

type Row = { slug: string; display: string; _count: { looks: number } }

function row(slug: string, display: string, looks: number): Row {
  return { slug, display, _count: { looks } }
}

describe('getTrendingLookTags', () => {
  beforeEach(() => {
    mocks.prisma.lookTag.findMany.mockReset()
  })

  it('ranks by the windowed look count, drops zero-count tags, caps to the limit', async () => {
    mocks.prisma.lookTag.findMany.mockResolvedValue([
      row('balayage', 'Balayage', 3),
      row('lashes', 'Lashes', 9),
      row('nails', 'Nails', 0),
      row('braids', 'Braids', 5),
    ])

    const tags = await getTrendingLookTags({ tenant: TENANT, now: NOW, limit: 2 })

    expect(tags).toEqual([
      { slug: 'lashes', display: 'Lashes', lookCount: 9 },
      { slug: 'braids', display: 'Braids', lookCount: 5 },
    ])
  })

  it('breaks count ties by slug for a stable order', async () => {
    mocks.prisma.lookTag.findMany.mockResolvedValue([
      row('zeta', 'Zeta', 4),
      row('alpha', 'Alpha', 4),
    ])

    const tags = await getTrendingLookTags({ tenant: TENANT, now: NOW })

    expect(tags.map((tag) => tag.slug)).toEqual(['alpha', 'zeta'])
  })

  it('queries a window relative to now and inherits the feed visibility gate', async () => {
    mocks.prisma.lookTag.findMany.mockResolvedValue([])

    await getTrendingLookTags({ tenant: TENANT, now: NOW, windowDays: 30 })

    const call = mocks.prisma.lookTag.findMany.mock.calls[0]
    expect(call).toBeDefined()
    if (!call) return
    const arg = call[0]
    expect(arg.where.bannedAt).toBeNull()

    const windowWhere = arg.where.looks.some
    // Feed gate is inherited from buildLooksFeedWhere.
    expect(windowWhere.status).toBe('PUBLISHED')
    expect(windowWhere.moderationStatus).toBe('APPROVED')
    // publishedAt is narrowed to the 30-day window (not just `not: null`).
    const expectedStart = new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000)
    expect(windowWhere.publishedAt.gte.getTime()).toBe(expectedStart.getTime())
    // The filtered relation count reuses the same window predicate.
    expect(arg.select._count.select.looks.where).toBe(windowWhere)
  })
})

describe('parseTrendingTagsResponse', () => {
  it('parses a well-formed envelope', () => {
    const parsed = parseTrendingTagsResponse({
      tags: [
        { slug: 'lashes', display: 'Lashes', lookCount: 4 },
        { slug: 'nails', display: 'Nails', lookCount: 2 },
      ],
    })

    expect(parsed).toEqual([
      { slug: 'lashes', display: 'Lashes', lookCount: 4 },
      { slug: 'nails', display: 'Nails', lookCount: 2 },
    ])
  })

  it('drops malformed entries and tolerates a missing count', () => {
    const parsed = parseTrendingTagsResponse({
      tags: [
        { slug: 'lashes', display: 'Lashes' },
        { slug: '', display: 'Empty slug', lookCount: 3 },
        { display: 'No slug', lookCount: 3 },
        'not-an-object',
      ],
    })

    expect(parsed).toEqual([{ slug: 'lashes', display: 'Lashes', lookCount: 0 }])
  })

  it('returns [] for a non-envelope', () => {
    expect(parseTrendingTagsResponse(null)).toEqual([])
    expect(parseTrendingTagsResponse({ tags: 'nope' })).toEqual([])
  })
})
