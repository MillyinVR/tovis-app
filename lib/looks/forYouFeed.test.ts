// lib/looks/forYouFeed.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  prisma: {
    proFollow: { findMany: vi.fn() },
    lookLike: { findMany: vi.fn() },
    boardItem: { findMany: vi.fn() },
    board: { findMany: vi.fn() },
    lookPost: { findMany: vi.fn() },
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }))

import { BoardType } from '@prisma/client'

import { rootTenantContext } from '@/lib/tenant/context'
import { BOARD_EVENT_PROXIMITY } from '@/lib/boards/context'
import {
  aggregateBoardContextSignals,
  aggregateCategoryWeights,
  buildForYouFeedPage,
  loadForYouAffinity,
  parseSeenLookIds,
} from './forYouFeed'

const ROOT_TENANT = rootTenantContext('tenant_root')
const NOW = new Date('2026-07-04T12:00:00.000Z')

function catRow(slug: string | null) {
  return { lookPost: { service: slug ? { category: { slug } } : null } }
}

function feedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'look',
    professionalId: 'pro',
    publishedAt: new Date('2026-07-01T00:00:00.000Z'),
    rankScore: 10,
    spotlightScore: 0,
    service: { category: { slug: 'balayage' } },
    ...overrides,
  }
}

describe('lib/looks/forYouFeed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.prisma.proFollow.findMany.mockResolvedValue([])
    mocks.prisma.lookLike.findMany.mockResolvedValue([])
    mocks.prisma.boardItem.findMany.mockResolvedValue([])
    mocks.prisma.board.findMany.mockResolvedValue([])
    mocks.prisma.lookPost.findMany.mockResolvedValue([])
  })

  describe('aggregateCategoryWeights', () => {
    it('sums weights per slug and drops empty / non-positive entries', () => {
      const weights = aggregateCategoryWeights([
        { slug: 'balayage', weight: 1 },
        { slug: 'balayage', weight: 2 },
        { slug: 'nails', weight: 1 },
        { slug: '  ', weight: 5 },
        { slug: 'lashes', weight: 0 },
        { slug: 'lashes', weight: -3 },
      ])
      expect(weights.get('balayage')).toBe(3)
      expect(weights.get('nails')).toBe(1)
      expect(weights.has('lashes')).toBe(false)
      expect(weights.has('')).toBe(false)
    })
  })

  describe('parseSeenLookIds', () => {
    it('splits, trims and de-dupes', () => {
      const seen = parseSeenLookIds(' a, b ,a,,c ')
      expect([...seen].sort()).toEqual(['a', 'b', 'c'])
    })

    it('returns empty for nullish input', () => {
      expect(parseSeenLookIds(null).size).toBe(0)
      expect(parseSeenLookIds(undefined).size).toBe(0)
    })

    it('caps the list', () => {
      const many = Array.from({ length: 500 }, (_, i) => `id${i}`).join(',')
      expect(parseSeenLookIds(many).size).toBe(300)
    })
  })

  describe('aggregateBoardContextSignals', () => {
    it('maps a dated occasion board onto tag + category weights at full proximity', () => {
      const signals = aggregateBoardContextSignals(
        [
          {
            type: BoardType.BRIDAL,
            eventDate: new Date('2026-07-20T00:00:00.000Z'),
          },
        ],
        NOW,
      )

      expect(signals.occasionTagWeights.get('bridal')).toBe(1)
      expect(signals.occasionTagWeights.get('wedding')).toBe(1)
      expect(
        signals.categoryEntries.find((entry) => entry.slug === 'hair')?.weight,
      ).toBe(3)
    })

    it('keeps the strongest weight when boards overlap and drops passed events', () => {
      const signals = aggregateBoardContextSignals(
        [
          // Wedding long past → contributes nothing.
          {
            type: BoardType.BRIDAL,
            eventDate: new Date('2026-01-01T00:00:00.000Z'),
          },
          // Undated prom board → baseline factor; shares the 'updo' tag with
          // the imminent bridal board below.
          { type: BoardType.PROM, eventDate: null },
          {
            type: BoardType.BRIDAL,
            eventDate: new Date('2026-07-10T00:00:00.000Z'),
          },
        ],
        NOW,
      )

      expect(signals.occasionTagWeights.get('updo')).toBe(1)
      expect(signals.occasionTagWeights.get('prom')).toBe(
        BOARD_EVENT_PROXIMITY.noDateFactor,
      )
    })

    it('ignores GENERAL boards entirely', () => {
      const signals = aggregateBoardContextSignals(
        [{ type: BoardType.GENERAL, eventDate: null }],
        NOW,
      )
      expect(signals.occasionTagWeights.size).toBe(0)
      expect(signals.categoryEntries).toEqual([])
    })
  })

  describe('loadForYouAffinity', () => {
    it('folds declared board purposes into category + occasion weights', async () => {
      mocks.prisma.board.findMany.mockResolvedValue([
        {
          type: BoardType.NAILS,
          eventDate: null,
        },
      ])
      mocks.prisma.boardItem.findMany.mockResolvedValue([catRow('nails')])

      const affinity = await loadForYouAffinity({
        userId: 'user_1',
        clientId: 'client_1',
        now: NOW,
      })

      // save(2) + board-purpose (3 × noDateFactor 0.5 = 1.5)
      expect(affinity.categoryWeights.get('nails')).toBeCloseTo(3.5, 5)
      expect(affinity.occasionTagWeights.get('nails')).toBe(
        BOARD_EVENT_PROXIMITY.noDateFactor,
      )
    })

    it('weights saves above likes and collects followed pros', async () => {
      mocks.prisma.proFollow.findMany.mockResolvedValue([
        { professionalId: 'pro_a' },
        { professionalId: 'pro_b' },
      ])
      mocks.prisma.lookLike.findMany.mockResolvedValue([
        catRow('balayage'),
        catRow(null),
      ])
      mocks.prisma.boardItem.findMany.mockResolvedValue([catRow('balayage')])

      const affinity = await loadForYouAffinity({
        userId: 'user_1',
        clientId: 'client_1',
        now: NOW,
      })

      expect([...affinity.followedProfessionalIds].sort()).toEqual([
        'pro_a',
        'pro_b',
      ])
      // like(1) + save(2) on balayage
      expect(affinity.categoryWeights.get('balayage')).toBe(3)
    })

    it('skips client-scoped queries for a viewer without a client profile', async () => {
      await loadForYouAffinity({ userId: 'user_1', clientId: null, now: NOW })
      expect(mocks.prisma.proFollow.findMany).not.toHaveBeenCalled()
      expect(mocks.prisma.boardItem.findMany).not.toHaveBeenCalled()
      expect(mocks.prisma.board.findMany).not.toHaveBeenCalled()
      // Likes are keyed on userId, so they still run.
      expect(mocks.prisma.lookLike.findMany).toHaveBeenCalledTimes(1)
    })
  })

  describe('buildForYouFeedPage', () => {
    it('injects fresh followed looks on entry and rides the backbone cursor', async () => {
      mocks.prisma.proFollow.findMany.mockResolvedValue([
        { professionalId: 'pro_followed' },
      ])

      // Backbone page: limit 2 → fetch 3 to detect hasMore.
      mocks.prisma.lookPost.findMany
        .mockResolvedValueOnce([
          feedRow({ id: 'b1', professionalId: 'pro_x', rankScore: 5 }),
          feedRow({ id: 'b2', professionalId: 'pro_y', rankScore: 3 }),
          feedRow({ id: 'b3', professionalId: 'pro_z', rankScore: 1 }),
        ])
        // Injection: a fresh followed look with no engagement.
        .mockResolvedValueOnce([
          feedRow({
            id: 'inj1',
            professionalId: 'pro_followed',
            rankScore: 0,
            publishedAt: NOW,
          }),
        ])

      const page = await buildForYouFeedPage({
        tenant: ROOT_TENANT,
        userId: 'user_1',
        clientId: 'client_1',
        limit: 2,
        cursor: null,
        seenLookIds: new Set(),
        now: NOW,
      })

      const ids = page.items.map((item) => item.id)
      // Followed injection leads via the follow boost; backbone rides along.
      expect(ids).toContain('inj1')
      expect(ids).toContain('b1')
      expect(ids[0]).toBe('inj1')
      // b3 was the +1 overflow row → not displayed, but hasMore → cursor set.
      expect(ids).not.toContain('b3')
      expect(page.nextCursor).toBeTruthy()
      expect(page.meta.injectedCount).toBe(1)
      expect(page.meta.backboneCount).toBe(2)
      expect(page.meta.followedCount).toBe(1)
    })

    it('does not inject on a paginated continuation', async () => {
      mocks.prisma.proFollow.findMany.mockResolvedValue([
        { professionalId: 'pro_followed' },
      ])
      mocks.prisma.lookPost.findMany.mockResolvedValueOnce([
        feedRow({ id: 'b1', rankScore: 5 }),
      ])

      const page = await buildForYouFeedPage({
        tenant: ROOT_TENANT,
        userId: 'user_1',
        clientId: 'client_1',
        limit: 2,
        cursor: { rankScore: 8, publishedAt: NOW, id: 'prev' },
        seenLookIds: new Set(),
        now: NOW,
      })

      // Only the backbone query ran — no injection query.
      expect(mocks.prisma.lookPost.findMany).toHaveBeenCalledTimes(1)
      expect(page.items.map((i) => i.id)).toEqual(['b1'])
      expect(page.meta.injectedCount).toBe(0)
      expect(page.nextCursor).toBeNull()
    })
  })
})
