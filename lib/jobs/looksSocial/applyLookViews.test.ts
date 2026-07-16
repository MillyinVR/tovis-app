import { describe, expect, it, vi } from 'vitest'
import {
  LookImpressionSource,
  LookPostStatus,
  ModerationStatus,
} from '@prisma/client'

import {
  buildApplyLookViewsUpdate,
  coerceLookImpressionSource,
  impressionWindowDate,
  MAX_APPLY_LOOK_VIEWS_BATCH,
  processApplyLookViews,
  selectViewerCappedLookIds,
  type LookPostViewIngestDb,
} from './applyLookViews'
import type { LookViewImpression } from './contracts'

describe('coerceLookImpressionSource', () => {
  it('passes through valid enum values', () => {
    expect(coerceLookImpressionSource('DETAIL')).toBe(
      LookImpressionSource.DETAIL,
    )
    expect(coerceLookImpressionSource('BOARD')).toBe(LookImpressionSource.BOARD)
  })

  it('falls back to FEED for unknown, missing, or non-string sources', () => {
    expect(coerceLookImpressionSource('feed')).toBe(LookImpressionSource.FEED)
    expect(coerceLookImpressionSource(undefined)).toBe(LookImpressionSource.FEED)
    expect(coerceLookImpressionSource(42)).toBe(LookImpressionSource.FEED)
  })
})

describe('buildApplyLookViewsUpdate', () => {
  it('dedupes and trims legacy ids into FEED impressions', () => {
    const result = buildApplyLookViewsUpdate({
      lookPostIds: ['look_1', ' look_1 ', 'look_2', 'look_2', 'look_3'],
    })

    expect(result.lookPostIds).toEqual(['look_1', 'look_2', 'look_3'])
    expect(result.impressions).toEqual([
      { lookPostId: 'look_1', source: LookImpressionSource.FEED },
      { lookPostId: 'look_2', source: LookImpressionSource.FEED },
      { lookPostId: 'look_3', source: LookImpressionSource.FEED },
    ])
  })

  it('keeps the same look under distinct sources but collapses repeats', () => {
    const result = buildApplyLookViewsUpdate({
      impressions: [
        { lookPostId: 'look_1', source: LookImpressionSource.FEED },
        { lookPostId: 'look_1', source: LookImpressionSource.DETAIL },
        // duplicate (look_1, FEED) — collapses
        { lookPostId: 'look_1', source: LookImpressionSource.FEED },
        { lookPostId: 'look_2', source: LookImpressionSource.DETAIL },
      ],
    })

    // Distinct-look denominator counts look_1 once.
    expect(result.lookPostIds).toEqual(['look_1', 'look_2'])
    expect(result.impressions).toEqual([
      { lookPostId: 'look_1', source: LookImpressionSource.FEED },
      { lookPostId: 'look_1', source: LookImpressionSource.DETAIL },
      { lookPostId: 'look_2', source: LookImpressionSource.DETAIL },
    ])
  })

  it('merges a legacy FEED id into an explicit FEED impression for the same look', () => {
    const result = buildApplyLookViewsUpdate({
      impressions: [{ lookPostId: 'look_1', source: LookImpressionSource.FEED }],
      // The legacy FEED id for the same look collapses into the pair above.
      lookPostIds: ['look_1'],
    })

    expect(result.impressions).toEqual([
      { lookPostId: 'look_1', source: LookImpressionSource.FEED },
    ])
    expect(result.lookPostIds).toEqual(['look_1'])
  })

  it('drops blank, non-string, and malformed entries', () => {
    const result = buildApplyLookViewsUpdate({
      impressions: [
        { lookPostId: '', source: LookImpressionSource.FEED },
        { lookPostId: '   ', source: LookImpressionSource.DETAIL },
        // @ts-expect-error deliberately malformed runtime entry
        { source: LookImpressionSource.FEED },
      ],
      lookPostIds: ['look_1', '', '   ', 'look_2'],
    })

    expect(result.lookPostIds).toEqual(['look_1', 'look_2'])
  })

  it('returns empty work for an empty batch', () => {
    const result = buildApplyLookViewsUpdate({})
    expect(result.lookPostIds).toEqual([])
    expect(result.impressions).toEqual([])
  })

  it('caps distinct looks at the maximum size', () => {
    const ids = Array.from(
      { length: MAX_APPLY_LOOK_VIEWS_BATCH + 50 },
      (_v, i) => `look_${i}`,
    )

    const result = buildApplyLookViewsUpdate({ lookPostIds: ids })

    expect(result.lookPostIds).toHaveLength(MAX_APPLY_LOOK_VIEWS_BATCH)
  })

  it('lets an already-admitted look keep a second source past the cap', () => {
    // Admit the cap's worth of distinct looks, then re-offer the first one under
    // a new source: the pair is admitted (no new distinct look), a brand-new
    // look past the cap is not.
    const impressions: LookViewImpression[] = Array.from(
      { length: MAX_APPLY_LOOK_VIEWS_BATCH },
      (_v, i) => ({
        lookPostId: `look_${i}`,
        source: LookImpressionSource.FEED,
      }),
    )
    impressions.push({
      lookPostId: 'look_0',
      source: LookImpressionSource.DETAIL,
    })
    impressions.push({
      lookPostId: 'look_overflow',
      source: LookImpressionSource.FEED,
    })

    const result = buildApplyLookViewsUpdate({ impressions })

    expect(result.lookPostIds).toHaveLength(MAX_APPLY_LOOK_VIEWS_BATCH)
    expect(result.lookPostIds).not.toContain('look_overflow')
    expect(result.impressions).toContainEqual({
      lookPostId: 'look_0',
      source: LookImpressionSource.DETAIL,
    })
  })
})

describe('impressionWindowDate', () => {
  it('truncates to the UTC day (midnight)', () => {
    const window = impressionWindowDate(new Date('2026-07-08T23:59:59.500Z'))
    expect(window.toISOString()).toBe('2026-07-08T00:00:00.000Z')
  })
})

describe('selectViewerCappedLookIds', () => {
  const eligible = new Set(['look_1', 'look_2'])

  it('keeps only eligible FEED impressions', () => {
    const ids = selectViewerCappedLookIds(
      [
        { lookPostId: 'look_1', source: LookImpressionSource.FEED },
        // DETAIL is explicit nav — never counts toward the feed cap
        { lookPostId: 'look_1', source: LookImpressionSource.DETAIL },
        { lookPostId: 'look_2', source: LookImpressionSource.FEED },
        // ineligible look — dropped
        { lookPostId: 'look_gone', source: LookImpressionSource.FEED },
      ],
      eligible,
    )
    expect(ids).toEqual(['look_1', 'look_2'])
  })

  it('drops DETAIL-only and BOARD impressions', () => {
    const ids = selectViewerCappedLookIds(
      [
        { lookPostId: 'look_1', source: LookImpressionSource.DETAIL },
        { lookPostId: 'look_2', source: LookImpressionSource.BOARD },
      ],
      eligible,
    )
    expect(ids).toEqual([])
  })

  it('returns each eligible look once', () => {
    const ids = selectViewerCappedLookIds(
      [
        { lookPostId: 'look_1', source: LookImpressionSource.FEED },
        { lookPostId: 'look_1', source: LookImpressionSource.FEED },
      ],
      eligible,
    )
    expect(ids).toEqual(['look_1'])
  })
})

describe('processApplyLookViews', () => {
  function makeDb(eligibleIds: string[]) {
    const updateManyAndReturn = vi
      .fn()
      .mockResolvedValue(eligibleIds.map((id) => ({ id })))
    const upsert = vi
      .fn()
      .mockImplementation((args: { create: { lookPostId: string } }) =>
        Promise.resolve({ lookPostId: args.create.lookPostId }),
      )
    const viewerUpsert = vi
      .fn()
      .mockImplementation((args: { create: { lookPostId: string } }) =>
        Promise.resolve({ lookPostId: args.create.lookPostId }),
      )
    const db: LookPostViewIngestDb = {
      lookPost: { updateManyAndReturn },
      lookPostImpressionStat: { upsert },
      lookViewerImpressionStat: { upsert: viewerUpsert },
    }
    return { db, updateManyAndReturn, upsert, viewerUpsert }
  }

  const now = new Date('2026-07-08T12:00:00.000Z')

  it('increments viewCount for only the eligible looks and returns their ids', async () => {
    // 'look_2' is not published/approved, so the atomic update never touches it
    // and it never comes back in the returned rows.
    const { db, updateManyAndReturn } = makeDb(['look_1'])

    const result = await processApplyLookViews(
      db,
      { lookPostIds: ['look_1', 'look_1', 'look_2'] },
      { now },
    )

    expect(updateManyAndReturn).toHaveBeenCalledTimes(1)
    expect(updateManyAndReturn).toHaveBeenCalledWith({
      where: {
        id: { in: ['look_1', 'look_2'] },
        status: LookPostStatus.PUBLISHED,
        moderationStatus: ModerationStatus.APPROVED,
      },
      data: { viewCount: { increment: 1 } },
      select: { id: true },
    })
    expect(result.appliedCount).toBe(1)
    expect(result.lookPostIds).toEqual(['look_1'])
  })

  it('upserts a windowed per-source row for each eligible impression', async () => {
    const { db, upsert } = makeDb(['look_1'])

    await processApplyLookViews(
      db,
      {
        impressions: [
          { lookPostId: 'look_1', source: LookImpressionSource.FEED },
          { lookPostId: 'look_1', source: LookImpressionSource.DETAIL },
          // ineligible look — no impression row
          { lookPostId: 'look_gone', source: LookImpressionSource.FEED },
        ],
      },
      { now },
    )

    expect(upsert).toHaveBeenCalledTimes(2)
    const windowDate = new Date('2026-07-08T00:00:00.000Z')
    expect(upsert).toHaveBeenCalledWith({
      where: {
        lookPostId_source_windowDate: {
          lookPostId: 'look_1',
          source: LookImpressionSource.FEED,
          windowDate,
        },
      },
      create: {
        lookPostId: 'look_1',
        source: LookImpressionSource.FEED,
        windowDate,
        count: 1,
      },
      update: { count: { increment: 1 } },
      select: { lookPostId: true },
    })
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          lookPostId: 'look_1',
          source: LookImpressionSource.DETAIL,
        }),
      }),
    )
  })

  it('records no impression rows when no look is eligible', async () => {
    const { db, upsert } = makeDb([])

    const result = await processApplyLookViews(
      db,
      {
        impressions: [
          { lookPostId: 'look_gone', source: LookImpressionSource.FEED },
        ],
      },
      { now },
    )

    expect(upsert).not.toHaveBeenCalled()
    expect(result.appliedCount).toBe(0)
    expect(result.lookPostIds).toEqual([])
  })

  it('no-ops without touching the database when the batch is empty', async () => {
    const { db, updateManyAndReturn, upsert } = makeDb([])

    const result = await processApplyLookViews(db, {}, { now })

    expect(updateManyAndReturn).not.toHaveBeenCalled()
    expect(upsert).not.toHaveBeenCalled()
    expect(result.appliedCount).toBe(0)
    expect(result.lookPostIds).toEqual([])
  })

  it('bumps the per-viewer cap counter for eligible FEED looks when a viewer is present', async () => {
    const { db, viewerUpsert } = makeDb(['look_1', 'look_2'])

    await processApplyLookViews(
      db,
      {
        viewerId: 'user_1',
        impressions: [
          { lookPostId: 'look_1', source: LookImpressionSource.FEED },
          // DETAIL open — never counts toward the feed cap
          { lookPostId: 'look_1', source: LookImpressionSource.DETAIL },
          { lookPostId: 'look_2', source: LookImpressionSource.FEED },
          // ineligible — no cap row
          { lookPostId: 'look_gone', source: LookImpressionSource.FEED },
        ],
      },
      { now },
    )

    expect(viewerUpsert).toHaveBeenCalledTimes(2)
    expect(viewerUpsert).toHaveBeenCalledWith({
      where: { userId_lookPostId: { userId: 'user_1', lookPostId: 'look_1' } },
      create: {
        userId: 'user_1',
        lookPostId: 'look_1',
        count: 1,
        lastSeenAt: now,
      },
      update: { count: { increment: 1 }, lastSeenAt: now },
      select: { lookPostId: true },
    })
    expect(viewerUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_lookPostId: { userId: 'user_1', lookPostId: 'look_2' },
        },
      }),
    )
  })

  it('records no per-viewer cap rows for a guest (no viewerId)', async () => {
    const { db, viewerUpsert } = makeDb(['look_1'])

    await processApplyLookViews(
      db,
      {
        impressions: [
          { lookPostId: 'look_1', source: LookImpressionSource.FEED },
        ],
      },
      { now },
    )

    expect(viewerUpsert).not.toHaveBeenCalled()
  })

  it('records no per-viewer cap row for a DETAIL-only exposure', async () => {
    const { db, viewerUpsert } = makeDb(['look_1'])

    await processApplyLookViews(
      db,
      {
        viewerId: 'user_1',
        impressions: [
          { lookPostId: 'look_1', source: LookImpressionSource.DETAIL },
        ],
      },
      { now },
    )

    expect(viewerUpsert).not.toHaveBeenCalled()
  })
})
