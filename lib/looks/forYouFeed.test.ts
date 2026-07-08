// lib/looks/forYouFeed.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  prisma: {
    proFollow: { findMany: vi.fn() },
    lookLike: { findMany: vi.fn() },
    boardItem: { findMany: vi.fn() },
    board: { findMany: vi.fn() },
    lookPost: { findMany: vi.fn() },
    clientProfile: { findUnique: vi.fn() },
    // Raw-SQL surface for the pgvector store (taste vector + candidate
    // embeddings). Routed by SQL text in beforeEach; default returns nothing.
    $queryRaw: vi.fn(),
  },
}))

// pgvector text literal of the expected dimension, all components = `fill`.
function dimVecText(fill: number): string {
  return `[${Array.from({ length: 1024 }, () => fill).join(',')}]`
}

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }))

import { BoardType } from '@prisma/client'

import { rootTenantContext } from '@/lib/tenant/context'
import { BOARD_EVENT_PROXIMITY } from '@/lib/boards/context'
import {
  AFFINITY_HALF_LIFE_DAYS,
  aggregateBoardContextSignals,
  aggregateCategoryWeights,
  buildForYouFeedPage,
  computeAffinityDecayFactor,
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
    mocks.prisma.clientProfile.findUnique.mockResolvedValue(null)
    // No taste vector and no candidate embeddings by default.
    mocks.prisma.$queryRaw.mockResolvedValue([])
  })

  // Route a raw-SQL call by its text: the taste-vector read vs the
  // candidate-embedding read hit the same $queryRaw mock.
  function routeRawSql(handlers: {
    tasteVector?: unknown[]
    candidateEmbeddings?: unknown[]
  }) {
    mocks.prisma.$queryRaw.mockImplementation((strings: TemplateStringsArray) => {
      const sql = Array.isArray(strings) ? strings.join(' ') : String(strings)
      if (sql.includes('ClientTasteVector')) {
        return Promise.resolve(handlers.tasteVector ?? [])
      }
      if (sql.includes('LookPostEmbedding')) {
        return Promise.resolve(handlers.candidateEmbeddings ?? [])
      }
      return Promise.resolve([])
    })
  }

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
      expect(mocks.prisma.clientProfile.findUnique).not.toHaveBeenCalled()
      // Likes are keyed on userId, so they still run.
      expect(mocks.prisma.lookLike.findMany).toHaveBeenCalledTimes(1)
    })

    it('time-decays like/save signals by age (spec §6.2)', async () => {
      const halfLifeAgo = new Date(
        NOW.getTime() - AFFINITY_HALF_LIFE_DAYS * 24 * 60 * 60 * 1000,
      )
      mocks.prisma.lookLike.findMany.mockResolvedValue([
        { ...catRow('balayage'), createdAt: NOW },
      ])
      mocks.prisma.boardItem.findMany.mockResolvedValue([
        { ...catRow('balayage'), createdAt: halfLifeAgo },
      ])

      const affinity = await loadForYouAffinity({
        userId: 'user_1',
        clientId: 'client_1',
        now: NOW,
      })

      // fresh like (1 × 1) + half-life-old save (2 × 0.5)
      expect(affinity.categoryWeights.get('balayage')).toBeCloseTo(2, 5)
    })

    it('folds declared self-profile interests in undecayed (spec §6.6)', async () => {
      mocks.prisma.clientProfile.findUnique.mockResolvedValue({
        selfProfile: { interests: ['nails'] },
      })

      const affinity = await loadForYouAffinity({
        userId: 'user_1',
        clientId: 'client_1',
        now: NOW,
      })

      expect(affinity.categoryWeights.get('nails')).toBe(3)
      expect(affinity.categoryWeights.get('nails-enhancements')).toBe(3)
    })

    it('loads the viewer taste vector + signal count (spec §6.0)', async () => {
      routeRawSql({
        tasteVector: [{ embeddingText: dimVecText(0.02), signalCount: 12 }],
      })

      const affinity = await loadForYouAffinity({
        userId: 'user_1',
        clientId: 'client_1',
        now: NOW,
      })

      expect(affinity.tasteVector).toHaveLength(1024)
      expect(affinity.tasteSignalCount).toBe(12)
    })

    it('leaves the taste vector null when none is stored', async () => {
      const affinity = await loadForYouAffinity({
        userId: 'user_1',
        clientId: 'client_1',
        now: NOW,
      })

      expect(affinity.tasteVector).toBeNull()
      expect(affinity.tasteSignalCount).toBe(0)
    })

    it('does not read a taste vector for a viewer without a client profile', async () => {
      await loadForYouAffinity({ userId: 'user_1', clientId: null, now: NOW })
      expect(mocks.prisma.$queryRaw).not.toHaveBeenCalled()
    })
  })

  describe('loadForYouAffinity — §6.3 in-session visual responsiveness', () => {
    // A like/save row carrying the fields the §6.3 delta reads.
    function sessionRow(args: {
      lookPostId: string
      createdAt: Date
      slug?: string | null
    }) {
      return {
        lookPostId: args.lookPostId,
        createdAt: args.createdAt,
        lookPost: {
          service: args.slug ? { category: { slug: args.slug } } : null,
        },
      }
    }

    function lookPostEmbeddingSqlCalls(): string[] {
      return mocks.prisma.$queryRaw.mock.calls
        .map((call) =>
          Array.isArray(call[0]) ? call[0].join(' ') : String(call[0]),
        )
        .filter((sql) => sql.includes('LookPostEmbedding'))
    }

    it('folds a fresh in-session save embedding into the taste vector', async () => {
      // Mature taste points along axis 0; the just-saved look points along axis
      // 1, so the blended vector must gain an axis-1 component this request.
      routeRawSql({
        tasteVector: [{ embeddingText: unitFirstAxis(), signalCount: 30 }],
        candidateEmbeddings: [
          { lookPostId: 'saved_now', embeddingText: unitSecondAxis() },
        ],
      })
      mocks.prisma.boardItem.findMany.mockResolvedValue([
        sessionRow({ lookPostId: 'saved_now', createdAt: NOW, slug: 'bridal' }),
      ])

      const affinity = await loadForYouAffinity({
        userId: 'user_1',
        clientId: 'client_1',
        now: NOW,
      })

      expect(affinity.sessionVisualSignalCount).toBe(1)
      // Confidence rose by the fresh signal (30 + 1).
      expect(affinity.tasteSignalCount).toBe(31)
      expect(affinity.tasteVector).not.toBeNull()
      const vector = affinity.tasteVector!
      expect(vector[1] ?? 0).toBeGreaterThan(0)
      // Mature direction still dominant.
      expect(vector[0] ?? 0).toBeGreaterThan(vector[1] ?? Number.NaN)
    })

    it('ignores a like/save outside the session window', async () => {
      const threeHoursAgo = new Date(NOW.getTime() - 3 * 60 * 60 * 1000)
      routeRawSql({
        tasteVector: [{ embeddingText: unitFirstAxis(), signalCount: 30 }],
      })
      mocks.prisma.boardItem.findMany.mockResolvedValue([
        sessionRow({
          lookPostId: 'saved_stale',
          createdAt: threeHoursAgo,
          slug: 'bridal',
        }),
      ])

      const affinity = await loadForYouAffinity({
        userId: 'user_1',
        clientId: 'client_1',
        now: NOW,
      })

      expect(affinity.sessionVisualSignalCount).toBe(0)
      expect(affinity.tasteSignalCount).toBe(30)
      // No embedding fetch when nothing is in-window.
      expect(lookPostEmbeddingSqlCalls()).toHaveLength(0)
      // Stored vector unchanged (unit along axis 0).
      expect(affinity.tasteVector![0] ?? Number.NaN).toBeCloseTo(1)
    })

    it('seeds a session-only taste vector for a viewer with no stored vector', async () => {
      routeRawSql({
        tasteVector: [], // no mature vector
        candidateEmbeddings: [
          { lookPostId: 'liked_now', embeddingText: unitSecondAxis() },
        ],
      })
      mocks.prisma.lookLike.findMany.mockResolvedValue([
        sessionRow({ lookPostId: 'liked_now', createdAt: NOW, slug: 'bridal' }),
      ])

      const affinity = await loadForYouAffinity({
        userId: 'user_1',
        clientId: 'client_1',
        now: NOW,
      })

      expect(affinity.sessionVisualSignalCount).toBe(1)
      expect(affinity.tasteSignalCount).toBe(1)
      expect(affinity.tasteVector).not.toBeNull()
      expect(affinity.tasteVector![1] ?? Number.NaN).toBeCloseTo(1)
    })

    it('does not fetch session embeddings for a viewer without a client profile', async () => {
      mocks.prisma.lookLike.findMany.mockResolvedValue([
        sessionRow({ lookPostId: 'liked_now', createdAt: NOW }),
      ])

      const affinity = await loadForYouAffinity({
        userId: 'user_1',
        clientId: null,
        now: NOW,
      })

      expect(affinity.sessionVisualSignalCount).toBe(0)
      expect(mocks.prisma.$queryRaw).not.toHaveBeenCalled()
    })
  })

  describe('computeAffinityDecayFactor', () => {
    it('is 1 for fresh or missing timestamps and halves per half-life', () => {
      expect(computeAffinityDecayFactor(NOW, NOW)).toBe(1)
      expect(computeAffinityDecayFactor(null, NOW)).toBe(1)
      expect(computeAffinityDecayFactor(new Date(Number.NaN), NOW)).toBe(1)

      const oneHalfLife = new Date(
        NOW.getTime() - AFFINITY_HALF_LIFE_DAYS * 24 * 60 * 60 * 1000,
      )
      expect(computeAffinityDecayFactor(oneHalfLife, NOW)).toBeCloseTo(0.5, 10)

      const twoHalfLives = new Date(
        NOW.getTime() - 2 * AFFINITY_HALF_LIFE_DAYS * 24 * 60 * 60 * 1000,
      )
      expect(computeAffinityDecayFactor(twoHalfLives, NOW)).toBeCloseTo(
        0.25,
        10,
      )

      // A clock skewed into the future never boosts past full weight.
      const future = new Date(NOW.getTime() + 24 * 60 * 60 * 1000)
      expect(computeAffinityDecayFactor(future, NOW)).toBe(1)
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

    it('skips the candidate-embedding query when the viewer has no taste vector', async () => {
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

      // Only the taste-vector read hit $queryRaw; no candidate-embedding read.
      const sqlCalls = mocks.prisma.$queryRaw.mock.calls.map((call) =>
        Array.isArray(call[0]) ? call[0].join(' ') : String(call[0]),
      )
      expect(sqlCalls.some((s) => s.includes('LookPostEmbedding'))).toBe(false)
      expect(page.meta.candidateEmbeddingCount).toBe(0)
      expect(page.meta.tasteSignalCount).toBe(0)
    })

    it('reorders the page by visual similarity and reports visual meta', async () => {
      // Taste vector points "one way"; b_match aligns with it, b_miss is
      // orthogonal. Both share the same rankScore, so the visual boost is the
      // tie-breaker that lifts the aligned look to the top.
      routeRawSql({
        tasteVector: [{ embeddingText: unitFirstAxis(), signalCount: 50 }],
        candidateEmbeddings: [
          { lookPostId: 'b_match', embeddingText: unitFirstAxis() },
          { lookPostId: 'b_miss', embeddingText: unitSecondAxis() },
        ],
      })
      mocks.prisma.lookPost.findMany.mockResolvedValueOnce([
        feedRow({ id: 'b_miss', professionalId: 'pro_x', rankScore: 5 }),
        feedRow({ id: 'b_match', professionalId: 'pro_y', rankScore: 5 }),
      ])

      const page = await buildForYouFeedPage({
        tenant: ROOT_TENANT,
        userId: 'user_1',
        clientId: 'client_1',
        limit: 5,
        cursor: null,
        seenLookIds: new Set(),
        now: NOW,
      })

      expect(page.items.map((i) => i.id)).toEqual(['b_match', 'b_miss'])
      expect(page.meta.candidateEmbeddingCount).toBe(2)
      expect(page.meta.tasteSignalCount).toBe(50)
    })
  })
})

// Unit vectors along the 1st / 2nd axis (orthogonal), for the visual-order test.
function unitFirstAxis(): string {
  const parts = Array.from({ length: 1024 }, () => 0)
  parts[0] = 1
  return `[${parts.join(',')}]`
}
function unitSecondAxis(): string {
  const parts = Array.from({ length: 1024 }, () => 0)
  parts[1] = 1
  return `[${parts.join(',')}]`
}
