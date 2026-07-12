// lib/looks/selects.test.ts
//
// §19e — owner board views (detail + preview) must gate saved looks to the ones
// still publicly renderable, so an unpublished/rejected/removed look neither
// renders stale nor inflates the item count. These lock the shared filter onto
// both the `items` sub-query AND the `_count` of both owner selects.

import {
  LookPostStatus,
  LookPostVisibility,
  ModerationStatus,
} from '@prisma/client'
import { describe, expect, it } from 'vitest'

import {
  boardVisibleLookItemWhere,
  looksBoardDetailSelect,
  looksBoardPreviewSelect,
} from './selects'

describe('boardVisibleLookItemWhere (§19e)', () => {
  it('gates a BoardItem on its look being PUBLISHED + APPROVED + PUBLIC + not removed', () => {
    expect(boardVisibleLookItemWhere).toEqual({
      lookPost: {
        status: LookPostStatus.PUBLISHED,
        visibility: LookPostVisibility.PUBLIC,
        moderationStatus: ModerationStatus.APPROVED,
        removedAt: null,
      },
    })
  })

  it('filters both the rendered items and the count on the board DETAIL select', () => {
    expect(looksBoardDetailSelect.items.where).toBe(boardVisibleLookItemWhere)
    expect(looksBoardDetailSelect._count.select.items).toEqual({
      where: boardVisibleLookItemWhere,
    })
  })

  it('filters both the rendered items and the count on the board PREVIEW select', () => {
    expect(looksBoardPreviewSelect.items.where).toBe(boardVisibleLookItemWhere)
    expect(looksBoardPreviewSelect._count.select.items).toEqual({
      where: boardVisibleLookItemWhere,
    })
  })
})
