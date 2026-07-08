// lib/looks/boardFeedRanking.test.ts
import { describe, expect, it } from 'vitest'

import {
  BOARD_FEED_RANK_WEIGHTS,
  computeBoardFeedScore,
  rankBoardFeedRows,
  type BoardFeedContext,
  type BoardFeedRankableRow,
} from './boardFeedRanking'
import { LOOK_EMBEDDING_DIMENSIONS } from '@/lib/personalization/lookEmbedding'

const NOW = new Date('2026-07-04T12:00:00.000Z')
// 3 days old → freshness = freshnessMax / (1 + 3) with a 1-day half-life.
const PUBLISHED = new Date('2026-07-01T12:00:00.000Z')
const FRESHNESS = BOARD_FEED_RANK_WEIGHTS.freshnessMax / 4

function row(overrides: Partial<BoardFeedRankableRow> = {}): BoardFeedRankableRow {
  return {
    id: overrides.id ?? 'look_1',
    professionalId: overrides.professionalId ?? 'pro_1',
    // Honor an explicit `publishedAt: null` (?? would treat null as absent).
    publishedAt: 'publishedAt' in overrides ? overrides.publishedAt ?? null : PUBLISHED,
    rankScore: overrides.rankScore ?? 10,
    service: overrides.service ?? { category: { slug: 'hair' } },
    tags: overrides.tags ?? null,
  }
}

function ctx(overrides: Partial<BoardFeedContext> = {}): BoardFeedContext {
  return {
    occasionTagWeights: overrides.occasionTagWeights ?? new Map(),
    answerTagSlugs: overrides.answerTagSlugs ?? new Set(),
    feasibilityTagSlugs: overrides.feasibilityTagSlugs ?? new Set(),
    tasteVector: overrides.tasteVector ?? null,
    tasteSignalCount: overrides.tasteSignalCount ?? 0,
    candidateEmbeddings: overrides.candidateEmbeddings ?? new Map(),
    seenLookIds: overrides.seenLookIds ?? new Set(),
    now: overrides.now ?? NOW,
  }
}

function unitVector(axis: number): number[] {
  const v = new Array<number>(LOOK_EMBEDDING_DIMENSIONS).fill(0)
  v[axis] = 1
  return v
}

describe('lib/looks/boardFeedRanking', () => {
  describe('computeBoardFeedScore', () => {
    it('passes the engagement backbone through when no board signals apply', () => {
      const score = computeBoardFeedScore(row({ rankScore: 10 }), ctx())
      expect(score).toBeCloseTo(10 + FRESHNESS, 5)
    })

    it('adds the full occasion boost for a tag match at full proximity', () => {
      const score = computeBoardFeedScore(
        row({ rankScore: 10, tags: [{ slug: 'bridal' }] }),
        ctx({ occasionTagWeights: new Map([['bridal', 1]]) }),
      )
      expect(score).toBeCloseTo(
        10 + BOARD_FEED_RANK_WEIGHTS.occasionMax + FRESHNESS,
        5,
      )
    })

    it('scales the occasion boost by event proximity', () => {
      const score = computeBoardFeedScore(
        row({ rankScore: 0, publishedAt: null, tags: [{ slug: 'prom' }] }),
        ctx({ occasionTagWeights: new Map([['prom', 0.5]]) }),
      )
      expect(score).toBeCloseTo(BOARD_FEED_RANK_WEIGHTS.occasionMax * 0.5, 5)
    })

    it('adds the service-answer boost when a candidate tag matches an answer slug', () => {
      const score = computeBoardFeedScore(
        row({ rankScore: 0, publishedAt: null, tags: [{ slug: 'red' }] }),
        ctx({ answerTagSlugs: new Set(['red']) }),
      )
      expect(score).toBeCloseTo(BOARD_FEED_RANK_WEIGHTS.serviceAnswerMax, 5)
    })

    it('adds the feasibility boost when a candidate tag matches a self-profile slug', () => {
      const score = computeBoardFeedScore(
        row({ rankScore: 0, publishedAt: null, tags: [{ slug: 'curlyhair' }] }),
        ctx({ feasibilityTagSlugs: new Set(['curlyhair']) }),
      )
      expect(score).toBeCloseTo(BOARD_FEED_RANK_WEIGHTS.feasibilityMax, 5)
    })

    it('stacks occasion + answer + feasibility for a look that matches all three', () => {
      const score = computeBoardFeedScore(
        row({
          rankScore: 0,
          publishedAt: null,
          tags: [{ slug: 'bridal' }, { slug: 'red' }, { slug: 'curlyhair' }],
        }),
        ctx({
          occasionTagWeights: new Map([['bridal', 1]]),
          answerTagSlugs: new Set(['red']),
          feasibilityTagSlugs: new Set(['curlyhair']),
        }),
      )
      expect(score).toBeCloseTo(
        BOARD_FEED_RANK_WEIGHTS.occasionMax +
          BOARD_FEED_RANK_WEIGHTS.serviceAnswerMax +
          BOARD_FEED_RANK_WEIGHTS.feasibilityMax,
        5,
      )
    })

    it('adds a visual boost for a cosine-1 candidate at full taste confidence', () => {
      const axis = unitVector(0)
      const score = computeBoardFeedScore(
        row({ id: 'look_v', rankScore: 0, publishedAt: null }),
        ctx({
          tasteVector: axis,
          // Well above visualConfidenceFullSignals → full confidence.
          tasteSignalCount: 100,
          candidateEmbeddings: new Map([['look_v', axis]]),
        }),
      )
      expect(score).toBeCloseTo(BOARD_FEED_RANK_WEIGHTS.visualMax, 5)
    })

    it('contributes 0 visual boost when the board has no taste vector', () => {
      const axis = unitVector(0)
      const score = computeBoardFeedScore(
        row({ id: 'look_v', rankScore: 5, publishedAt: null }),
        ctx({
          tasteVector: null,
          tasteSignalCount: 0,
          candidateEmbeddings: new Map([['look_v', axis]]),
        }),
      )
      expect(score).toBeCloseTo(5, 5)
    })

    it('sinks an already-seen look beneath everything unseen', () => {
      const score = computeBoardFeedScore(
        row({ id: 'seen_1', rankScore: 100, tags: [{ slug: 'bridal' }] }),
        ctx({
          occasionTagWeights: new Map([['bridal', 1]]),
          seenLookIds: new Set(['seen_1']),
        }),
      )
      expect(score).toBeLessThan(0)
    })

    it('keeps occasion the heaviest single term (above answer and feasibility)', () => {
      expect(BOARD_FEED_RANK_WEIGHTS.occasionMax).toBeGreaterThan(
        BOARD_FEED_RANK_WEIGHTS.serviceAnswerMax,
      )
      expect(BOARD_FEED_RANK_WEIGHTS.serviceAnswerMax).toBeGreaterThan(
        BOARD_FEED_RANK_WEIGHTS.feasibilityMax,
      )
    })
  })

  describe('rankBoardFeedRows', () => {
    it('orders an occasion match above a higher-rankScore non-match', () => {
      const plain = row({ id: 'plain', rankScore: 15, tags: null })
      const bridal = row({ id: 'bridal', rankScore: 5, tags: [{ slug: 'bridal' }] })

      const ranked = rankBoardFeedRows(
        [plain, bridal],
        ctx({ occasionTagWeights: new Map([['bridal', 1]]) }),
      )

      expect(ranked.map((r) => r.id)).toEqual(['bridal', 'plain'])
    })

    it('does not mutate the input array', () => {
      const rows = [row({ id: 'a' }), row({ id: 'b' })]
      const snapshot = rows.map((r) => r.id)
      rankBoardFeedRows(rows, ctx())
      expect(rows.map((r) => r.id)).toEqual(snapshot)
    })

    it('falls back to the RANKED tie-break (id desc) for otherwise-equal rows', () => {
      // Identical rankScore AND publishedAt → equal score (freshness ties too);
      // the tie-break mirrors the DB RANKED order, ending in id descending.
      const same = new Date('2026-06-10T00:00:00.000Z')
      const a = row({ id: 'a', rankScore: 10, publishedAt: same })
      const z = row({ id: 'z', rankScore: 10, publishedAt: same })

      const ranked = rankBoardFeedRows([a, z], ctx())
      expect(ranked.map((r) => r.id)).toEqual(['z', 'a'])
    })
  })
})
