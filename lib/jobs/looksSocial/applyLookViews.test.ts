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
  function makeDb(eligibleIds: string[]) {
    const updateManyAndReturn = vi
      .fn()
      .mockResolvedValue(eligibleIds.map((id) => ({ id })))
    const db: LookPostViewIncrementDb = {
      lookPost: { updateManyAndReturn },
    }
    return { db, updateManyAndReturn }
  }

  it('increments viewCount for only the eligible looks and returns their ids', async () => {
    // 'look_2' is not published/approved, so the atomic update never touches it
    // and it never comes back in the returned rows.
    const { db, updateManyAndReturn } = makeDb(['look_1'])

    const result = await processApplyLookViews(db, {
      lookPostIds: ['look_1', 'look_1', 'look_2'],
    })

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

  it('no-ops without touching the database when the batch is empty', async () => {
    const { db, updateManyAndReturn } = makeDb([])

    const result = await processApplyLookViews(db, { lookPostIds: [] })

    expect(updateManyAndReturn).not.toHaveBeenCalled()
    expect(result.appliedCount).toBe(0)
    expect(result.lookPostIds).toEqual([])
  })

  it('applies nothing when no batch id is eligible', async () => {
    const { db } = makeDb([])

    const result = await processApplyLookViews(db, {
      lookPostIds: ['look_gone'],
    })

    expect(result.appliedCount).toBe(0)
    expect(result.lookPostIds).toEqual([])
  })
})
