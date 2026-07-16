import { describe, expect, it, vi } from 'vitest'

import {
  CAPPED_LOOK_IDS_CAP,
  IMPRESSION_CAP_EXPOSURES,
  loadCappedLookIds,
} from './viewerImpressionCap'

describe('loadCappedLookIds', () => {
  function makeDb(rows: Array<{ lookPostId: string }>) {
    const findMany = vi.fn().mockResolvedValue(rows)
    return { db: { lookViewerImpressionStat: { findMany } }, findMany }
  }

  it('queries the viewer’s looks at/above the exposure cap and returns their ids', async () => {
    const { db, findMany } = makeDb([
      { lookPostId: 'look_1' },
      { lookPostId: 'look_2' },
    ])

    const ids = await loadCappedLookIds(db, { userId: 'user_1' })

    expect(ids).toEqual(['look_1', 'look_2'])
    expect(findMany).toHaveBeenCalledWith({
      where: { userId: 'user_1', count: { gte: IMPRESSION_CAP_EXPOSURES } },
      orderBy: { lastSeenAt: 'desc' },
      take: CAPPED_LOOK_IDS_CAP,
      select: { lookPostId: true },
    })
  })

  it('honours an explicit cap override', async () => {
    const { db, findMany } = makeDb([])

    await loadCappedLookIds(db, { userId: 'user_1', cap: 10 })

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user_1', count: { gte: 10 } },
      }),
    )
  })

  it('returns an empty list for a viewer with no capped looks', async () => {
    const { db } = makeDb([])
    await expect(loadCappedLookIds(db, { userId: 'user_1' })).resolves.toEqual(
      [],
    )
  })
})
