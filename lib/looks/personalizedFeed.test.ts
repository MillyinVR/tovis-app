// lib/looks/personalizedFeed.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  prisma: {
    proFollow: { findMany: vi.fn() },
    lookLike: { findMany: vi.fn() },
    lookHide: { findMany: vi.fn() },
    boardItem: { findMany: vi.fn() },
    board: { findMany: vi.fn() },
    lookPost: { findMany: vi.fn() },
    professionalAvailabilityStat: { findMany: vi.fn() },
    professionalBadgeStat: { findMany: vi.fn() },
    lookPostConversionStat: { findMany: vi.fn() },
    booking: { findMany: vi.fn() },
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
  AFFINITY_BOOKING_HALF_LIFE_DAYS,
  AFFINITY_BOOKING_WEIGHT,
  AFFINITY_HALF_LIFE_DAYS,
  BOARD_GLOBAL_BLEED_WEIGHT,
  HIDE_SUPPRESSION_HALF_LIFE_DAYS,
  aggregateBoardContextSignals,
  aggregateCategoryWeights,
  bookingCategoryAffinityEntries,
  buildPersonalizedFeedPage,
  computeAffinityDecayFactor,
  learnPriceBand,
  loadPersonalizedAffinity,
  parseSeenLookIds,
} from './personalizedFeed'

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

describe('lib/looks/personalizedFeed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.prisma.proFollow.findMany.mockResolvedValue([])
    mocks.prisma.lookLike.findMany.mockResolvedValue([])
    mocks.prisma.lookHide.findMany.mockResolvedValue([])
    mocks.prisma.boardItem.findMany.mockResolvedValue([])
    mocks.prisma.board.findMany.mockResolvedValue([])
    mocks.prisma.lookPost.findMany.mockResolvedValue([])
    mocks.prisma.professionalAvailabilityStat.findMany.mockResolvedValue([])
    mocks.prisma.professionalBadgeStat.findMany.mockResolvedValue([])
    mocks.prisma.lookPostConversionStat.findMany.mockResolvedValue([])
    mocks.prisma.booking.findMany.mockResolvedValue([])
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

  describe('bookingCategoryAffinityEntries', () => {
    const DAY = 24 * 60 * 60 * 1000

    function bookingRow(args: {
      scheduledFor: Date
      finishedAt?: Date | null
      categorySlug?: string | null
      servicePrice?: number | null
    }) {
      return {
        professionalId: 'pro',
        scheduledFor: args.scheduledFor,
        finishedAt: args.finishedAt ?? null,
        categorySlug: args.categorySlug ?? null,
        servicePrice: args.servicePrice ?? null,
      }
    }

    it('weights a fresh completed booking at the heaviest behavioral weight (spec §2)', () => {
      const entries = bookingCategoryAffinityEntries(
        [bookingRow({ scheduledFor: NOW, finishedAt: NOW, categorySlug: 'balayage' })],
        NOW,
      )
      expect(entries).toEqual([
        { slug: 'balayage', weight: AFFINITY_BOOKING_WEIGHT },
      ])
      // A booking outweighs a like (1) or a save (2) on the same category.
      expect(AFFINITY_BOOKING_WEIGHT).toBeGreaterThan(2)
    })

    it('ages the signal by finishedAt (else scheduledFor) at the slow booking half-life', () => {
      const halfLifeAgo = new Date(
        NOW.getTime() - AFFINITY_BOOKING_HALF_LIFE_DAYS * DAY,
      )
      const entries = bookingCategoryAffinityEntries(
        [
          // Scheduled long ago but FINISHED now → full weight (finishedAt wins).
          bookingRow({
            scheduledFor: halfLifeAgo,
            finishedAt: NOW,
            categorySlug: 'balayage',
          }),
          // No finishedAt → the scheduledFor slot ages it one half-life → ×0.5.
          bookingRow({
            scheduledFor: halfLifeAgo,
            finishedAt: null,
            categorySlug: 'nails',
          }),
        ],
        NOW,
      )
      expect(
        entries.find((e) => e.slug === 'balayage')?.weight,
      ).toBeCloseTo(AFFINITY_BOOKING_WEIGHT, 5)
      expect(entries.find((e) => e.slug === 'nails')?.weight).toBeCloseTo(
        AFFINITY_BOOKING_WEIGHT * 0.5,
        5,
      )
    })

    it('skips a booking with no resolvable category', () => {
      expect(
        bookingCategoryAffinityEntries(
          [
            bookingRow({ scheduledFor: NOW, categorySlug: null }),
            bookingRow({ scheduledFor: NOW, categorySlug: '   ' }),
          ],
          NOW,
        ),
      ).toEqual([])
    })

    it('emits one entry per booking so repeat visits sum in the category graph', () => {
      const entries = bookingCategoryAffinityEntries(
        [
          bookingRow({ scheduledFor: NOW, finishedAt: NOW, categorySlug: 'balayage' }),
          bookingRow({ scheduledFor: NOW, finishedAt: NOW, categorySlug: 'balayage' }),
        ],
        NOW,
      )
      expect(entries).toHaveLength(2)
      // Two fresh bookings sum to 2× the weight (the ranker caps the total).
      expect(aggregateCategoryWeights(entries).get('balayage')).toBeCloseTo(
        2 * AFFINITY_BOOKING_WEIGHT,
        5,
      )
    })
  })

  describe('learnPriceBand', () => {
    const DAY = 24 * 60 * 60 * 1000

    function pricedRow(args: {
      scheduledFor: Date
      finishedAt?: Date | null
      servicePrice: number | null
    }) {
      return {
        professionalId: 'pro',
        scheduledFor: args.scheduledFor,
        finishedAt: args.finishedAt ?? null,
        categorySlug: 'balayage',
        servicePrice: args.servicePrice,
      }
    }

    it('returns null when no booking carries a usable price', () => {
      expect(
        learnPriceBand(
          [
            pricedRow({ scheduledFor: NOW, servicePrice: null }),
            pricedRow({ scheduledFor: NOW, servicePrice: 0 }),
            pricedRow({ scheduledFor: NOW, servicePrice: -50 }),
          ],
          NOW,
        ),
      ).toBeNull()
      expect(learnPriceBand([], NOW)).toBeNull()
    })

    it('centers on the LOG-mean of equal-age prices and counts the priced bookings', () => {
      // Two same-day bookings at $50 and $200 → geometric mean $100 (log space).
      const band = learnPriceBand(
        [
          pricedRow({ scheduledFor: NOW, finishedAt: NOW, servicePrice: 50 }),
          pricedRow({ scheduledFor: NOW, finishedAt: NOW, servicePrice: 200 }),
        ],
        NOW,
      )
      expect(band).not.toBeNull()
      expect(Math.exp(band!.logCenter)).toBeCloseTo(100, 5)
      expect(band!.sampleCount).toBe(2)
    })

    it('recency-weights the center toward recent visits (slow booking half-life)', () => {
      // A fresh $200 visit vs one a half-life old at $50: the old one counts ×0.5,
      // so the log-center leans toward $200. weighted = (1·ln200 + 0.5·ln50)/1.5.
      const halfLifeAgo = new Date(
        NOW.getTime() - AFFINITY_BOOKING_HALF_LIFE_DAYS * DAY,
      )
      const band = learnPriceBand(
        [
          pricedRow({ scheduledFor: NOW, finishedAt: NOW, servicePrice: 200 }),
          pricedRow({
            scheduledFor: halfLifeAgo,
            finishedAt: halfLifeAgo,
            servicePrice: 50,
          }),
        ],
        NOW,
      )
      const expected = (Math.log(200) + 0.5 * Math.log(50)) / 1.5
      expect(band!.logCenter).toBeCloseTo(expected, 5)
      // Both bookings are priced, so confidence counts both (recency shifts the
      // center, not the sample count).
      expect(band!.sampleCount).toBe(2)
    })

    it('skips unpriced rows but still counts the priced ones', () => {
      const band = learnPriceBand(
        [
          pricedRow({ scheduledFor: NOW, finishedAt: NOW, servicePrice: 100 }),
          pricedRow({ scheduledFor: NOW, finishedAt: NOW, servicePrice: null }),
        ],
        NOW,
      )
      expect(band!.sampleCount).toBe(1)
      expect(Math.exp(band!.logCenter)).toBeCloseTo(100, 5)
    })
  })

  describe('loadPersonalizedAffinity', () => {
    it('folds declared board purposes into category + occasion weights', async () => {
      mocks.prisma.board.findMany.mockResolvedValue([
        {
          type: BoardType.NAILS,
          eventDate: null,
        },
      ])
      mocks.prisma.boardItem.findMany.mockResolvedValue([catRow('nails')])

      const affinity = await loadPersonalizedAffinity({
        userId: 'user_1',
        clientId: 'client_1',
        now: NOW,
      })

      // damped board save (2 × 0.15 = 0.3) + board-purpose (3 × noDateFactor
      // 0.5 = 1.5) — §6.2: the board save bleeds into global at the small fraction
      expect(affinity.categoryWeights.get('nails')).toBeCloseTo(
        2 * BOARD_GLOBAL_BLEED_WEIGHT + 1.5,
        5,
      )
      expect(affinity.occasionTagWeights.get('nails')).toBe(
        BOARD_EVENT_PROXIMITY.noDateFactor,
      )
    })

    it('bleeds a board save into global at only BOARD_GLOBAL_BLEED_WEIGHT while likes stay full (spec §6.2) and collects followed pros', async () => {
      mocks.prisma.proFollow.findMany.mockResolvedValue([
        { professionalId: 'pro_a' },
        { professionalId: 'pro_b' },
      ])
      mocks.prisma.lookLike.findMany.mockResolvedValue([
        catRow('balayage'),
        catRow(null),
      ])
      mocks.prisma.boardItem.findMany.mockResolvedValue([catRow('balayage')])

      const affinity = await loadPersonalizedAffinity({
        userId: 'user_1',
        clientId: 'client_1',
        now: NOW,
      })

      expect([...affinity.followedProfessionalIds].sort()).toEqual([
        'pro_a',
        'pro_b',
      ])
      // full like (1 × 1) + damped board save (2 × 0.15) on balayage — the board
      // save contributes far less than the Looks-feed like, so board activity
      // flavors but never floods the discovery feed.
      expect(affinity.categoryWeights.get('balayage')).toBeCloseTo(
        1 + 2 * BOARD_GLOBAL_BLEED_WEIGHT,
        5,
      )
    })

    it('bleeds a standalone board save (no like, no purpose) at exactly the small fraction (spec §6.2)', async () => {
      mocks.prisma.boardItem.findMany.mockResolvedValue([catRow('balayage')])

      const affinity = await loadPersonalizedAffinity({
        userId: 'user_1',
        clientId: 'client_1',
        now: NOW,
      })

      // Only signal is one board save → 2 × 0.15 = 0.3 in global category
      // affinity, vs 1.0 for a single Looks-feed like on the same category.
      expect(affinity.categoryWeights.get('balayage')).toBeCloseTo(
        2 * BOARD_GLOBAL_BLEED_WEIGHT,
        5,
      )
    })

    it('skips client-scoped queries for a viewer without a client profile', async () => {
      await loadPersonalizedAffinity({ userId: 'user_1', clientId: null, now: NOW })
      expect(mocks.prisma.proFollow.findMany).not.toHaveBeenCalled()
      expect(mocks.prisma.boardItem.findMany).not.toHaveBeenCalled()
      expect(mocks.prisma.board.findMany).not.toHaveBeenCalled()
      expect(mocks.prisma.clientProfile.findUnique).not.toHaveBeenCalled()
      // Bookings are keyed on the client id (spec §6.7) → skipped too.
      expect(mocks.prisma.booking.findMany).not.toHaveBeenCalled()
      // Likes are keyed on userId, so they still run.
      expect(mocks.prisma.lookLike.findMany).toHaveBeenCalledTimes(1)
    })

    it('loads a per-pro relationship map from the viewer completed bookings (spec §6.7)', async () => {
      const older = new Date('2026-05-01T12:00:00.000Z')
      const newer = new Date('2026-06-20T12:00:00.000Z')
      mocks.prisma.booking.findMany.mockResolvedValue([
        // Two completed visits with pro_a; the reader keeps the latest instant.
        { professionalId: 'pro_a', scheduledFor: newer, finishedAt: null },
        {
          professionalId: 'pro_a',
          scheduledFor: older,
          finishedAt: older,
        },
        { professionalId: 'pro_b', scheduledFor: older, finishedAt: null },
      ])

      const affinity = await loadPersonalizedAffinity({
        userId: 'user_1',
        clientId: 'client_1',
        now: NOW,
      })

      // Only COMPLETED bookings are queried (status filter is the reader's job).
      expect(mocks.prisma.booking.findMany).toHaveBeenCalledTimes(1)
      const signals = affinity.relationshipSignals
      expect(signals?.get('pro_a')).toEqual({
        lastVisitAt: newer,
        completedVisits: 2,
      })
      expect(signals?.get('pro_b')).toEqual({
        lastVisitAt: older,
        completedVisits: 1,
      })
    })

    it('folds completed bookings into category affinity from the SAME read (spec §2)', async () => {
      // A completed balayage booking + one balayage like. The booking is the
      // strongest signal, so it dominates: full like (1) + fresh booking (4).
      // One booking read serves both the category fold and the §6.7 relationship
      // map — no second query.
      mocks.prisma.lookLike.findMany.mockResolvedValue([catRow('balayage')])
      mocks.prisma.booking.findMany.mockResolvedValue([
        {
          professionalId: 'pro_a',
          scheduledFor: NOW,
          finishedAt: NOW,
          service: { category: { slug: 'balayage' } },
        },
      ])

      const affinity = await loadPersonalizedAffinity({
        userId: 'user_1',
        clientId: 'client_1',
        now: NOW,
      })

      expect(mocks.prisma.booking.findMany).toHaveBeenCalledTimes(1)
      expect(affinity.categoryWeights.get('balayage')).toBeCloseTo(
        1 + AFFINITY_BOOKING_WEIGHT,
        5,
      )
      // The same read still builds the per-pro relationship map.
      expect(affinity.relationshipSignals?.get('pro_a')).toEqual({
        lastVisitAt: NOW,
        completedVisits: 1,
      })
    })

    it('learns a price band from the SAME booking read (spec §4.5)', async () => {
      // A Decimal-like price snapshot: the reader resolves serviceSubtotal ??
      // subtotal, then .toNumber(). Two same-day bookings at $80 and $120 →
      // geometric-mean center $~98, both priced.
      const dec = (n: number) => ({ toNumber: () => n })
      mocks.prisma.booking.findMany.mockResolvedValue([
        {
          professionalId: 'pro_a',
          scheduledFor: NOW,
          finishedAt: NOW,
          service: { category: { slug: 'balayage' } },
          subtotalSnapshot: dec(80),
          serviceSubtotalSnapshot: null,
        },
        {
          professionalId: 'pro_a',
          scheduledFor: NOW,
          finishedAt: NOW,
          service: { category: { slug: 'balayage' } },
          // Service subtotal wins over the booking subtotal when present.
          subtotalSnapshot: dec(999),
          serviceSubtotalSnapshot: dec(120),
        },
      ])

      const affinity = await loadPersonalizedAffinity({
        userId: 'user_1',
        clientId: 'client_1',
        now: NOW,
      })

      expect(affinity.priceBand).not.toBeNull()
      expect(Math.exp(affinity.priceBand!.logCenter)).toBeCloseTo(
        Math.sqrt(80 * 120),
        5,
      )
      expect(affinity.priceBand!.sampleCount).toBe(2)
    })

    it('leaves the price band null when bookings carry no usable price (spec §4.5)', async () => {
      mocks.prisma.booking.findMany.mockResolvedValue([
        {
          professionalId: 'pro_a',
          scheduledFor: NOW,
          finishedAt: NOW,
          service: { category: { slug: 'balayage' } },
          subtotalSnapshot: { toNumber: () => 0 },
          serviceSubtotalSnapshot: null,
        },
      ])

      const affinity = await loadPersonalizedAffinity({
        userId: 'user_1',
        clientId: 'client_1',
        now: NOW,
      })

      expect(affinity.priceBand).toBeNull()
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

      const affinity = await loadPersonalizedAffinity({
        userId: 'user_1',
        clientId: 'client_1',
        now: NOW,
      })

      // fresh full like (1 × 1) + half-life-old damped board save
      // (2 × 0.15 × 0.5) — decay and the §6.2 bleed fraction compose
      expect(affinity.categoryWeights.get('balayage')).toBeCloseTo(
        1 + 2 * BOARD_GLOBAL_BLEED_WEIGHT * 0.5,
        5,
      )
    })

    it('collects hidden look ids and decayed category suppression (spec §2.2)', async () => {
      const hideHalfLifeAgo = new Date(
        NOW.getTime() - HIDE_SUPPRESSION_HALF_LIFE_DAYS * 24 * 60 * 60 * 1000,
      )
      mocks.prisma.lookHide.findMany.mockResolvedValue([
        { lookPostId: 'hidden_a', createdAt: NOW, ...catRow('bridal') },
        {
          lookPostId: 'hidden_b',
          createdAt: hideHalfLifeAgo,
          ...catRow('bridal'),
        },
        // No category → contributes to the exclusion list but not suppression.
        { lookPostId: 'hidden_c', createdAt: NOW, ...catRow(null) },
      ])

      const affinity = await loadPersonalizedAffinity({
        userId: 'user_1',
        clientId: 'client_1',
        now: NOW,
      })

      expect(affinity.hiddenLookIds).toEqual([
        'hidden_a',
        'hidden_b',
        'hidden_c',
      ])
      // fresh hide (1.0) + one-half-life-old hide (0.5) on the same category.
      expect(affinity.categorySuppressionWeights?.get('bridal')).toBeCloseTo(
        1 + 0.5,
        5,
      )
    })

    it('folds declared self-profile interests in undecayed (spec §6.6)', async () => {
      mocks.prisma.clientProfile.findUnique.mockResolvedValue({
        selfProfile: { interests: ['nails'] },
      })

      const affinity = await loadPersonalizedAffinity({
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

      const affinity = await loadPersonalizedAffinity({
        userId: 'user_1',
        clientId: 'client_1',
        now: NOW,
      })

      expect(affinity.tasteVector).toHaveLength(1024)
      expect(affinity.tasteSignalCount).toBe(12)
    })

    it('leaves the taste vector null when none is stored', async () => {
      const affinity = await loadPersonalizedAffinity({
        userId: 'user_1',
        clientId: 'client_1',
        now: NOW,
      })

      expect(affinity.tasteVector).toBeNull()
      expect(affinity.tasteSignalCount).toBe(0)
    })

    it('does not read a taste vector for a viewer without a client profile', async () => {
      await loadPersonalizedAffinity({ userId: 'user_1', clientId: null, now: NOW })
      expect(mocks.prisma.$queryRaw).not.toHaveBeenCalled()
    })
  })

  describe('loadPersonalizedAffinity — §6.3 in-session visual responsiveness', () => {
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

      const affinity = await loadPersonalizedAffinity({
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

      const affinity = await loadPersonalizedAffinity({
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

      const affinity = await loadPersonalizedAffinity({
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

      const affinity = await loadPersonalizedAffinity({
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

  describe('buildPersonalizedFeedPage', () => {
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

      const page = await buildPersonalizedFeedPage({
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

    it('boosts a booked-pro look above a higher-rankScore peer and reports the §6.7 counts', async () => {
      mocks.prisma.booking.findMany.mockResolvedValue([
        {
          professionalId: 'pro_booked',
          scheduledFor: NOW,
          finishedAt: NOW,
        },
      ])
      // Backbone: a non-booked pro leads on rankScore; the booked pro trails.
      mocks.prisma.lookPost.findMany.mockResolvedValueOnce([
        feedRow({ id: 'b_other', professionalId: 'pro_other', rankScore: 8 }),
        feedRow({ id: 'b_booked', professionalId: 'pro_booked', rankScore: 5 }),
      ])

      const page = await buildPersonalizedFeedPage({
        tenant: ROOT_TENANT,
        userId: 'user_1',
        clientId: 'client_1',
        limit: 2,
        cursor: null,
        seenLookIds: new Set(),
        now: NOW,
      })

      // A recent booking out-pulls the +3 rankScore gap → the booked pro leads.
      expect(page.items[0]?.id).toBe('b_booked')
      expect(page.meta.relationshipProCount).toBe(1)
      expect(page.meta.relationshipBoostedCount).toBe(1)
    })

    it('lifts a bookable but under-discovered pro over an established peer and reports the §4.5 count', async () => {
      // Both pros have a real near-term opening (same availability → equal
      // availability boost), so the underbooked on-ramp is what differs.
      mocks.prisma.professionalAvailabilityStat.findMany.mockResolvedValue([
        { professionalId: 'pro_established', nextOpeningDate: NOW, fullness14d: 0 },
        { professionalId: 'pro_new', nextOpeningDate: NOW, fullness14d: 0 },
      ])
      // Established pro has plenty of completed bookings (no on-ramp); the new pro
      // has no badge-stat row → 0 completed → full on-ramp.
      mocks.prisma.professionalBadgeStat.findMany.mockResolvedValue([
        { professionalId: 'pro_established', completedBookingCount30d: 20 },
      ])
      // Backbone: the established pro leads on rankScore; the new pro trails.
      mocks.prisma.lookPost.findMany.mockResolvedValueOnce([
        feedRow({ id: 'b_established', professionalId: 'pro_established', rankScore: 8 }),
        feedRow({ id: 'b_new', professionalId: 'pro_new', rankScore: 5 }),
      ])

      const page = await buildPersonalizedFeedPage({
        tenant: ROOT_TENANT,
        userId: 'user_1',
        clientId: 'client_1',
        limit: 2,
        cursor: null,
        seenLookIds: new Set(),
        now: NOW,
      })

      // The underbooked on-ramp (+10) out-pulls the +3 rankScore gap → new leads.
      expect(page.items[0]?.id).toBe('b_new')
      // Only the under-discovered pro is lifted; the established pro earns nothing.
      expect(page.meta.underbookedBoostedCount).toBe(1)
      // Both pros are bookable, so both count toward the §4.3 bookable blend.
      expect(page.meta.bookableCount).toBe(2)
    })

    it('never lifts an unbookable pro even with zero completed bookings (calendar-health gate)', async () => {
      // No availability rows → nobody is bookable → the on-ramp stays dark even
      // though neither pro has a badge-stat row (0 completed bookings).
      mocks.prisma.professionalAvailabilityStat.findMany.mockResolvedValue([])
      mocks.prisma.professionalBadgeStat.findMany.mockResolvedValue([])
      mocks.prisma.lookPost.findMany.mockResolvedValueOnce([
        feedRow({ id: 'b_hi', professionalId: 'pro_hi', rankScore: 8 }),
        feedRow({ id: 'b_lo', professionalId: 'pro_lo', rankScore: 5 }),
      ])

      const page = await buildPersonalizedFeedPage({
        tenant: ROOT_TENANT,
        userId: 'user_1',
        clientId: 'client_1',
        limit: 2,
        cursor: null,
        seenLookIds: new Set(),
        now: NOW,
      })

      // Order tracks rankScore (no on-ramp lift), and nothing is reported.
      expect(page.items.map((item) => item.id)).toEqual(['b_hi', 'b_lo'])
      expect(page.meta.underbookedBoostedCount).toBe(0)
    })

    it('lifts an efficiently-converting look over a heavily-saved non-converter and reports the §4.2 count', async () => {
      // b_converts: few exposures, several bookings → efficient converter → full boost.
      // b_pretty: many saves/views, one booking → near-0 conversion boost.
      mocks.prisma.lookPostConversionStat.findMany.mockResolvedValue([
        { lookPostId: 'b_converts', bookingCount: 8, interestCount: 12 },
        { lookPostId: 'b_pretty', bookingCount: 1, interestCount: 3_000 },
      ])
      // Backbone: the "pretty" look leads on rankScore; the converter trails.
      mocks.prisma.lookPost.findMany.mockResolvedValueOnce([
        feedRow({ id: 'b_pretty', professionalId: 'pro_a', rankScore: 9 }),
        feedRow({ id: 'b_converts', professionalId: 'pro_b', rankScore: 6 }),
      ])

      const page = await buildPersonalizedFeedPage({
        tenant: ROOT_TENANT,
        userId: 'user_1',
        clientId: 'client_1',
        limit: 2,
        cursor: null,
        seenLookIds: new Set(),
        now: NOW,
      })

      // The conversion boost (~+8) out-pulls the +3 rankScore gap → converter leads.
      expect(page.items[0]?.id).toBe('b_converts')
      // Both looks have a row (>=1 booking), so both count toward the §4.2 metric.
      expect(page.meta.conversionBoostedCount).toBe(2)
      expect(mocks.prisma.lookPostConversionStat.findMany).toHaveBeenCalledWith({
        where: { lookPostId: { in: ['b_pretty', 'b_converts'] } },
        select: { lookPostId: true, bookingCount: true, interestCount: true },
      })
    })

    it('reports zero conversion lift when no displayed look has driven a booking', async () => {
      mocks.prisma.lookPostConversionStat.findMany.mockResolvedValue([])
      mocks.prisma.lookPost.findMany.mockResolvedValueOnce([
        feedRow({ id: 'b_1', professionalId: 'pro_a', rankScore: 8 }),
        feedRow({ id: 'b_2', professionalId: 'pro_b', rankScore: 5 }),
      ])

      const page = await buildPersonalizedFeedPage({
        tenant: ROOT_TENANT,
        userId: 'user_1',
        clientId: 'client_1',
        limit: 2,
        cursor: null,
        seenLookIds: new Set(),
        now: NOW,
      })

      expect(page.items.map((item) => item.id)).toEqual(['b_1', 'b_2'])
      expect(page.meta.conversionBoostedCount).toBe(0)
    })

    it('lifts a reliable pro over a frequent canceller and reports the §4.2 reliability count', async () => {
      // No availability rows (default) → nobody is bookable → the underbooked
      // on-ramp is gated OFF, isolating the reliability term. pro_reliable: 20/20
      // completed → full-ish boost. pro_flaky: 12/20 (60%) → below the 0.75 floor
      // → no lift.
      mocks.prisma.professionalBadgeStat.findMany.mockResolvedValue([
        {
          professionalId: 'pro_reliable',
          completedBookingCount30d: 20,
          resolvedBookingCount: 20,
          completedResolvedCount: 20,
        },
        {
          professionalId: 'pro_flaky',
          completedBookingCount30d: 20,
          resolvedBookingCount: 20,
          completedResolvedCount: 12,
        },
      ])
      // Backbone: the flaky pro leads on rankScore; the reliable pro trails.
      mocks.prisma.lookPost.findMany.mockResolvedValueOnce([
        feedRow({ id: 'b_flaky', professionalId: 'pro_flaky', rankScore: 8 }),
        feedRow({ id: 'b_reliable', professionalId: 'pro_reliable', rankScore: 5 }),
      ])

      const page = await buildPersonalizedFeedPage({
        tenant: ROOT_TENANT,
        userId: 'user_1',
        clientId: 'client_1',
        limit: 2,
        cursor: null,
        seenLookIds: new Set(),
        now: NOW,
      })

      // The reliability boost (~+5.2) out-pulls the +3 rankScore gap → reliable leads.
      expect(page.items[0]?.id).toBe('b_reliable')
      // Only the reliable pro clears the floor; the canceller earns nothing.
      expect(page.meta.reliabilityBoostedCount).toBe(1)
      // The reliability reader queries the badge-stat table with its OWN select
      // (distinct from the underbooked read on the same table).
      expect(mocks.prisma.professionalBadgeStat.findMany).toHaveBeenCalledWith({
        where: { professionalId: { in: ['pro_flaky', 'pro_reliable'] } },
        select: {
          professionalId: true,
          resolvedBookingCount: true,
          completedResolvedCount: true,
        },
      })
    })

    it('lifts an in-budget look over a pricier peer via the learned band and reports the §4.5 count', async () => {
      // Three $100 completed bookings with an UNRELATED pro + category (lashes) →
      // a confident band centered on ln(100), with no relationship/category bleed
      // into the two 'balayage' feed looks (so price_fit is what differs).
      const dec = (n: number) => ({ toNumber: () => n })
      mocks.prisma.booking.findMany.mockResolvedValue(
        [100, 100, 100].map(() => ({
          professionalId: 'pro_elsewhere',
          scheduledFor: NOW,
          finishedAt: NOW,
          service: { category: { slug: 'lashes' } },
          subtotalSnapshot: dec(100),
          serviceSubtotalSnapshot: null,
        })),
      )
      // Backbone: a pricey out-of-band look leads on rankScore; the in-band look
      // trails. priceStartingAt is a plain number here (a Decimal at runtime).
      mocks.prisma.lookPost.findMany.mockResolvedValueOnce([
        feedRow({
          id: 'b_pricey',
          professionalId: 'pro_x',
          rankScore: 8,
          priceStartingAt: 1500,
        }),
        feedRow({
          id: 'b_inbudget',
          professionalId: 'pro_y',
          rankScore: 5,
          priceStartingAt: 100,
        }),
      ])

      const page = await buildPersonalizedFeedPage({
        tenant: ROOT_TENANT,
        userId: 'user_1',
        clientId: 'client_1',
        limit: 2,
        cursor: null,
        seenLookIds: new Set(),
        now: NOW,
      })

      // The price-fit boost (~+8 at full confidence) out-pulls the +3 rankScore
      // gap → the in-budget look leads.
      expect(page.items[0]?.id).toBe('b_inbudget')
      // Coverage metric: both looks carry a price + the viewer has a band, so both
      // were price-matched (the far-out $1500 look still earns a ~0.09 Gaussian
      // tail — it's buried by ordering, not zeroed).
      expect(page.meta.priceFitBoostedCount).toBe(2)
    })

    it('excludes an unpriced look from the price-fit coverage count', async () => {
      const dec = (n: number) => ({ toNumber: () => n })
      mocks.prisma.booking.findMany.mockResolvedValue([
        {
          professionalId: 'pro_elsewhere',
          scheduledFor: NOW,
          finishedAt: NOW,
          service: { category: { slug: 'lashes' } },
          subtotalSnapshot: dec(100),
          serviceSubtotalSnapshot: null,
        },
      ])
      mocks.prisma.lookPost.findMany.mockResolvedValueOnce([
        feedRow({ id: 'b_priced', professionalId: 'pro_x', rankScore: 8, priceStartingAt: 100 }),
        feedRow({ id: 'b_unpriced', professionalId: 'pro_y', rankScore: 5, priceStartingAt: null }),
      ])

      const page = await buildPersonalizedFeedPage({
        tenant: ROOT_TENANT,
        userId: 'user_1',
        clientId: 'client_1',
        limit: 2,
        cursor: null,
        seenLookIds: new Set(),
        now: NOW,
      })

      // Only the priced look is matchable against the band.
      expect(page.meta.priceFitBoostedCount).toBe(1)
    })

    it('reports zero price-fit lift when the viewer has no learned band', async () => {
      // No priced bookings → no band → the term is dark; order tracks rankScore.
      mocks.prisma.lookPost.findMany.mockResolvedValueOnce([
        feedRow({ id: 'b_hi', professionalId: 'pro_a', rankScore: 8, priceStartingAt: 100 }),
        feedRow({ id: 'b_lo', professionalId: 'pro_b', rankScore: 5, priceStartingAt: 100 }),
      ])

      const page = await buildPersonalizedFeedPage({
        tenant: ROOT_TENANT,
        userId: 'user_1',
        clientId: 'client_1',
        limit: 2,
        cursor: null,
        seenLookIds: new Set(),
        now: NOW,
      })

      expect(page.items.map((item) => item.id)).toEqual(['b_hi', 'b_lo'])
      expect(page.meta.priceFitBoostedCount).toBe(0)
    })

    it('does not inject on a paginated continuation', async () => {
      mocks.prisma.proFollow.findMany.mockResolvedValue([
        { professionalId: 'pro_followed' },
      ])
      mocks.prisma.lookPost.findMany.mockResolvedValueOnce([
        feedRow({ id: 'b1', rankScore: 5 }),
      ])

      const page = await buildPersonalizedFeedPage({
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

    it('excludes the viewer’s hidden looks from the backbone and reports the count (§2.2)', async () => {
      mocks.prisma.lookHide.findMany.mockResolvedValue([
        { lookPostId: 'hidden_a', createdAt: NOW, ...catRow('bridal') },
        { lookPostId: 'hidden_b', createdAt: NOW, ...catRow(null) },
      ])
      mocks.prisma.lookPost.findMany.mockResolvedValueOnce([
        feedRow({ id: 'b1', rankScore: 5 }),
      ])

      const page = await buildPersonalizedFeedPage({
        tenant: ROOT_TENANT,
        userId: 'user_1',
        clientId: 'client_1',
        limit: 2,
        cursor: null,
        seenLookIds: new Set(['seen_x']),
        now: NOW,
      })

      const backboneWhere =
        mocks.prisma.lookPost.findMany.mock.calls[0]?.[0]?.where
      const idExclusion = backboneWhere?.AND?.find(
        (clause: Record<string, unknown>) =>
          clause && typeof clause === 'object' && 'id' in clause,
      )
      expect(idExclusion).toEqual({
        id: {
          notIn: expect.arrayContaining(['hidden_a', 'hidden_b', 'seen_x']),
        },
      })
      expect(page.meta.hiddenExcludedCount).toBe(2)
      expect(page.meta.categorySuppressionCount).toBe(1)
    })

    it('skips the candidate-embedding query when the viewer has no taste vector', async () => {
      mocks.prisma.lookPost.findMany.mockResolvedValueOnce([
        feedRow({ id: 'b1', rankScore: 5 }),
      ])

      const page = await buildPersonalizedFeedPage({
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

      const page = await buildPersonalizedFeedPage({
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

  describe('buildPersonalizedFeedPage — §4.3 composition + §4.3.1 diversity', () => {
    const OLD = new Date('2026-01-01T00:00:00.000Z')

    // Four distinct liked categories → a confident graph (>= the exploration
    // gate). Old timestamps keep them out of the §6.3 session window.
    function confidentGraphLikes() {
      return ['balayage', 'lashes', 'nails', 'brows'].map((slug, i) => ({
        lookPostId: `like_${i}`,
        createdAt: OLD,
        ...catRow(slug),
      }))
    }

    afterEach(() => {
      vi.unstubAllEnvs()
    })

    it('is byte-identical (no exploration) with the flag off, even on a confident graph', async () => {
      mocks.prisma.lookLike.findMany.mockResolvedValue(confidentGraphLikes())
      mocks.prisma.lookPost.findMany.mockResolvedValueOnce([
        feedRow({ id: 'b1', rankScore: 5 }),
      ])

      const page = await buildPersonalizedFeedPage({
        tenant: ROOT_TENANT,
        userId: 'user_1',
        clientId: 'client_1',
        limit: 12,
        cursor: null,
        seenLookIds: new Set(),
        now: NOW,
      })

      // Only the backbone query ran — no exploration query.
      expect(mocks.prisma.lookPost.findMany).toHaveBeenCalledTimes(1)
      expect(page.items.map((i) => i.id)).toEqual(['b1'])
      expect(page.meta.explorationInjectedCount).toBe(0)
      expect(page.meta.sessionIntent).toBe('default')
      expect(page.meta.availabilityWeightMultiplier).toBe(1)
    })

    it('does not reserve exploration slots for a thin graph even with the flag on', async () => {
      vi.stubEnv('ENABLE_FEED_DIVERSITY_INJECTION', '1')
      // Two liked categories → below the confidence gate.
      mocks.prisma.lookLike.findMany.mockResolvedValue([
        { lookPostId: 'l0', createdAt: OLD, ...catRow('balayage') },
        { lookPostId: 'l1', createdAt: OLD, ...catRow('lashes') },
      ])
      mocks.prisma.lookPost.findMany.mockResolvedValueOnce([
        feedRow({ id: 'b1', rankScore: 5 }),
      ])

      const page = await buildPersonalizedFeedPage({
        tenant: ROOT_TENANT,
        userId: 'user_1',
        clientId: 'client_1',
        limit: 12,
        cursor: null,
        seenLookIds: new Set(),
        now: NOW,
      })

      expect(mocks.prisma.lookPost.findMany).toHaveBeenCalledTimes(1)
      expect(page.meta.explorationInjectedCount).toBe(0)
    })

    it('injects an off-graph exploration slice on a confident graph and interleaves it', async () => {
      vi.stubEnv('ENABLE_FEED_DIVERSITY_INJECTION', '1')
      mocks.prisma.lookLike.findMany.mockResolvedValue(confidentGraphLikes())

      mocks.prisma.lookPost.findMany
        // Backbone.
        .mockResolvedValueOnce([
          feedRow({ id: 'b1', professionalId: 'pro_x', rankScore: 9 }),
          feedRow({ id: 'b2', professionalId: 'pro_y', rankScore: 7 }),
          feedRow({ id: 'b3', professionalId: 'pro_z', rankScore: 5 }),
        ])
        // Exploration (off-graph, quality-ranked).
        .mockResolvedValueOnce([
          feedRow({
            id: 'exp1',
            professionalId: 'pro_new',
            rankScore: 100,
            service: { category: { slug: 'microblading' } },
          }),
        ])

      const page = await buildPersonalizedFeedPage({
        tenant: ROOT_TENANT,
        userId: 'user_1',
        clientId: 'client_1',
        limit: 12,
        cursor: null,
        seenLookIds: new Set(),
        now: NOW,
      })

      const ids = page.items.map((i) => i.id)
      expect(ids).toContain('exp1')
      // Every backbone row is still present (exploration rides on top).
      expect(ids).toEqual(expect.arrayContaining(['b1', 'b2', 'b3']))
      expect(page.meta.explorationInjectedCount).toBe(1)

      // The exploration query excludes the viewer's affinity categories.
      const exploreWhere =
        mocks.prisma.lookPost.findMany.mock.calls[1]?.[0]?.where
      const categoryClause = exploreWhere?.AND?.find(
        (clause: Record<string, unknown>) =>
          clause && typeof clause === 'object' && 'service' in clause,
      )
      expect(categoryClause?.service?.category?.slug?.notIn).toEqual(
        expect.arrayContaining(['balayage', 'lashes', 'nails', 'brows']),
      )
      // …and it excludes the backbone ids already on the page.
      const idClause = exploreWhere?.AND?.find(
        (clause: Record<string, unknown>) =>
          clause && typeof clause === 'object' && 'id' in clause,
      )
      expect(idClause?.id?.notIn).toEqual(
        expect.arrayContaining(['b1', 'b2', 'b3']),
      )
    })

    it('leans the availability multiplier by session intent and reports it', async () => {
      mocks.prisma.lookPost.findMany.mockResolvedValueOnce([
        feedRow({ id: 'b1', rankScore: 5 }),
      ])

      const page = await buildPersonalizedFeedPage({
        tenant: ROOT_TENANT,
        userId: 'user_1',
        clientId: 'client_1',
        limit: 12,
        cursor: null,
        seenLookIds: new Set(),
        now: NOW,
        intent: 'book',
      })

      expect(page.meta.sessionIntent).toBe('book')
      expect(page.meta.availabilityWeightMultiplier).toBe(1.75)
    })

    it('reports the displayed bookable/inspiration split (§4.3 composition metric)', async () => {
      mocks.prisma.lookPost.findMany.mockResolvedValueOnce([
        feedRow({ id: 'b1', professionalId: 'pro_open', rankScore: 5 }),
        feedRow({ id: 'b2', professionalId: 'pro_booked', rankScore: 3 }),
      ])
      // pro_open has a real near-term opening; pro_booked has no row.
      mocks.prisma.professionalAvailabilityStat.findMany.mockResolvedValue([
        { professionalId: 'pro_open', nextOpeningDate: NOW, fullness14d: 0 },
      ])

      const page = await buildPersonalizedFeedPage({
        tenant: ROOT_TENANT,
        userId: 'user_1',
        clientId: 'client_1',
        limit: 12,
        cursor: null,
        seenLookIds: new Set(),
        now: NOW,
      })

      expect(page.meta.bookableCount).toBe(1)
      expect(page.meta.inspirationCount).toBe(1)
      expect(page.meta.bookableCount + page.meta.inspirationCount).toBe(
        page.items.length,
      )
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
