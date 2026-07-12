// lib/looks/hides.test.ts
import { describe, expect, it, vi } from 'vitest'

import { HIDDEN_LOOK_IDS_CAP, loadHiddenLookIds } from './hides'

describe('lib/looks/hides', () => {
  describe('loadHiddenLookIds', () => {
    it('maps rows to ids and requests the newest, capped set', async () => {
      const findMany = vi.fn().mockResolvedValue([
        { lookPostId: 'a' },
        { lookPostId: 'b' },
      ])
      const db = { lookHide: { findMany } }

      const ids = await loadHiddenLookIds(db, { userId: 'user_1' })

      expect(ids).toEqual(['a', 'b'])
      expect(findMany).toHaveBeenCalledWith({
        where: { userId: 'user_1' },
        orderBy: { createdAt: 'desc' },
        take: HIDDEN_LOOK_IDS_CAP,
        select: { lookPostId: true },
      })
    })

    it('returns an empty list when the viewer has no hides', async () => {
      const findMany = vi.fn().mockResolvedValue([])
      const ids = await loadHiddenLookIds(
        { lookHide: { findMany } },
        { userId: 'user_1' },
      )
      expect(ids).toEqual([])
    })
  })
})
