import { describe, expect, it } from 'vitest'

import {
  rankFollowSuggestions,
  type SuggestionLikedLookRow,
} from './followSuggestions'

function row(
  author: SuggestionLikedLookRow['lookPost']['clientAuthor'],
): SuggestionLikedLookRow {
  return { lookPost: { clientAuthor: author } }
}

const alice = {
  id: 'client_alice',
  handle: 'alice',
  isPublicProfile: true,
  avatarUrl: 'https://cdn.example.com/alice.jpg',
}
const bob = {
  id: 'client_bob',
  handle: 'bob',
  isPublicProfile: true,
  avatarUrl: null,
}

describe('rankFollowSuggestions', () => {
  it('tallies public authors and orders by like volume', () => {
    const result = rankFollowSuggestions(
      [row(alice), row(bob), row(alice)],
      { excludeClientIds: [] },
    )

    expect(result).toEqual([
      {
        clientId: 'client_alice',
        handle: 'alice',
        avatarUrl: 'https://cdn.example.com/alice.jpg',
        likedLookCount: 2,
      },
      {
        clientId: 'client_bob',
        handle: 'bob',
        avatarUrl: null,
        likedLookCount: 1,
      },
    ])
  })

  it('breaks ties by handle for determinism', () => {
    const result = rankFollowSuggestions([row(bob), row(alice)], {
      excludeClientIds: [],
    })
    expect(result.map((s) => s.handle)).toEqual(['alice', 'bob'])
  })

  it('excludes the viewer and already-followed clients', () => {
    const result = rankFollowSuggestions([row(alice), row(bob)], {
      excludeClientIds: ['client_alice'],
    })
    expect(result.map((s) => s.clientId)).toEqual(['client_bob'])
  })

  it('drops private profiles, handleless authors, and pro-authored looks', () => {
    const result = rankFollowSuggestions(
      [
        row({ ...alice, isPublicProfile: false }),
        row({ ...bob, handle: null }),
        row(null), // pro-authored look → no clientAuthor
      ],
      { excludeClientIds: [] },
    )
    expect(result).toEqual([])
  })

  it('honours the limit', () => {
    const result = rankFollowSuggestions([row(alice), row(bob)], {
      excludeClientIds: [],
      limit: 1,
    })
    expect(result).toHaveLength(1)
    expect(result[0]?.handle).toBe('alice')
  })
})
