import { describe, expect, it, vi } from 'vitest'
import { LookPostStatus, ModerationStatus } from '@prisma/client'

import {
  buildApplyLookViewsUpdate,
  MAX_APPLY_LOOK_VIEWS_BATCH,
  processApplyLookViews,
  type LookPostViewIncrementDb,
} from './applyLookViews'

describe('buildApplyLookViewsUpdate', () => {
  it('dedupes and trims ids so each look counts once per batch', () => {
    const result = buildApplyLookViewsUpdate({
      lookPostIds: ['look_1', ' look_1 ', 'look_2', 'look_2', 'look_3'],
    })

    expect(result.lookPostIds).toEqual(['look_1', 'look_2', 'look_3'])
  })

  it('drops blank and non-string entries', () => {
    const result = buildApplyLookViewsUpdate({
      // Simulate a loosely-parsed payload with junk entries.
      lookPostIds: ['look_1', '', '   ', 'look_2'],
    })

    expect(result.lookPostIds).toEqual(['look_1', 'look_2'])
  })

  it('returns an empty list for an empty batch', () => {
    expect(buildApplyLookViewsUpdate({ lookPostIds: [] }).lookPostIds).toEqual(
      [],
    )
  })

  it('caps the batch at the maximum size', () => {
    const ids = Array.from(
      { length: MAX_APPLY_LOOK_VIEWS_BATCH + 50 },
      (_v, i) => `look_${i}`,
    )

    const result = buildApplyLookViewsUpdate({ lookPostIds: ids })

    expect(result.lookPostIds).toHaveLength(MAX_APPLY_LOOK_VIEWS_BATCH)
  })
})

describe('processApplyLookViews', () => {
  function makeDb(count: number) {
    const updateMany = vi.fn().mockResolvedValue({ count })
    const db: LookPostViewIncrementDb = {
      lookPost: { updateMany },
    }
    return { db, updateMany }
  }

  it('increments viewCount for the published, approved looks in the batch', async () => {
    const { db, updateMany } = makeDb(2)

    const result = await processApplyLookViews(db, {
      lookPostIds: ['look_1', 'look_1', 'look_2'],
    })

    expect(updateMany).toHaveBeenCalledTimes(1)
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['look_1', 'look_2'] },
        status: LookPostStatus.PUBLISHED,
        moderationStatus: ModerationStatus.APPROVED,
      },
      data: { viewCount: { increment: 1 } },
    })
    expect(result.appliedCount).toBe(2)
  })

  it('no-ops without touching the database when the batch is empty', async () => {
    const { db, updateMany } = makeDb(0)

    const result = await processApplyLookViews(db, { lookPostIds: [] })

    expect(updateMany).not.toHaveBeenCalled()
    expect(result.appliedCount).toBe(0)
  })
})
