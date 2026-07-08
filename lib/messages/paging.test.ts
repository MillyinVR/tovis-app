// lib/messages/paging.test.ts
import { describe, expect, it } from 'vitest'

import { THREAD_MESSAGE_PAGE_SIZE, nextOlderCursor } from './paging'

describe('nextOlderCursor', () => {
  it('returns the oldest id of a full page (there may be more older messages)', () => {
    // DESC ids: newest → oldest. The last element is the oldest.
    const descIds = Array.from({ length: THREAD_MESSAGE_PAGE_SIZE }, (_, i) => `m${i}`)
    expect(nextOlderCursor(descIds, THREAD_MESSAGE_PAGE_SIZE)).toBe(
      `m${THREAD_MESSAGE_PAGE_SIZE - 1}`,
    )
  })

  it('returns null for a partial page (start of history reached)', () => {
    const descIds = ['m0', 'm1', 'm2']
    expect(nextOlderCursor(descIds, THREAD_MESSAGE_PAGE_SIZE)).toBeNull()
  })

  it('returns null for an empty page', () => {
    expect(nextOlderCursor([], THREAD_MESSAGE_PAGE_SIZE)).toBeNull()
  })

  it('uses the provided page size, not the default', () => {
    expect(nextOlderCursor(['a', 'b'], 2)).toBe('b')
    expect(nextOlderCursor(['a', 'b'], 3)).toBeNull()
  })
})
