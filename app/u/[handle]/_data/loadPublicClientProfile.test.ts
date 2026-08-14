// app/u/[handle]/_data/loadPublicClientProfile.test.ts
//
// §19c divergence (a) — client-authored looks are created PENDING_REVIEW, so the
// public /u/[handle] grid must require moderationStatus APPROVED or it exposes
// looks before a human approves them. Locks that gate into the query, plus the
// sibling gate on the Boards panel (SHARED + not admin-hidden), which is the
// second thing this page publishes to strangers.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BoardVisibility,
  LookPostStatus,
  LookPostVisibility,
  ModerationStatus,
} from '@prisma/client'

const mocks = vi.hoisted(() => {
  const clientProfile = { findUnique: vi.fn() }
  const booking = { groupBy: vi.fn() }
  return { clientProfile, booking, prisma: { clientProfile, booking } }
})

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }))
vi.mock('@/lib/media/renderUrls', () => ({
  renderMediaUrlsBatch: vi.fn(async (items: unknown[]) =>
    items.map(() => ({ renderUrl: null, renderThumbUrl: null })),
  ),
}))

import { loadPublicClientProfile } from './loadPublicClientProfile'

/** A minimal public profile row — no looks, no boards. */
function profileRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'client_1',
    handle: 'ada',
    avatarUrl: null,
    publicBio: null,
    publicCity: null,
    isPublicProfile: true,
    creatorStat: null,
    _count: { followers: 0, following: 0 },
    authoredLooks: [],
    boards: [],
    ...overrides,
  }
}

describe('loadPublicClientProfile (§19c — public exposure gates)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.booking.groupBy.mockResolvedValue([])
  })

  it('only queries PUBLISHED + PUBLIC + APPROVED, published, non-removed authored looks', async () => {
    mocks.clientProfile.findUnique.mockResolvedValue(profileRow())

    await loadPublicClientProfile('ada')

    expect(mocks.clientProfile.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          authoredLooks: expect.objectContaining({
            // Shared with the pro portfolio via `publicLookVisibilityWhere`, so
            // the two surfaces cannot drift on what "public" means. That clause
            // additionally requires `publishedAt` — stricter than this grid used
            // to be, and selecting the same rows, since every publish write
            // stamps it.
            where: {
              status: LookPostStatus.PUBLISHED,
              visibility: LookPostVisibility.PUBLIC,
              moderationStatus: ModerationStatus.APPROVED,
              publishedAt: { not: null },
              removedAt: null,
            },
          }),
        }),
      }),
    )
  })

  it('only queries SHARED, non-hidden boards', async () => {
    mocks.clientProfile.findUnique.mockResolvedValue(profileRow())

    await loadPublicClientProfile('ada')

    expect(mocks.clientProfile.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          boards: expect.objectContaining({
            // A PRIVATE board must never be listed just because its owner opened
            // their profile, and an admin-hidden board must stay hidden — the
            // same gate the standalone public board page applies.
            where: { visibility: BoardVisibility.SHARED, hiddenAt: null },
          }),
        }),
      }),
    )
  })

  it('reports an unscored creator as untiered rather than as tier zero', async () => {
    mocks.clientProfile.findUnique.mockResolvedValue(profileRow())

    const data = await loadPublicClientProfile('ada')

    expect(data?.standing).toEqual({ tier: 'NONE', topPercent: null, city: null })
  })

  it('turns a scored percentile into the "top N%" figure', async () => {
    mocks.clientProfile.findUnique.mockResolvedValue(
      profileRow({
        publicCity: 'Brooklyn',
        creatorStat: { tier: 'TASTEMAKER', savePercentile: 96 },
      }),
    )

    const data = await loadPublicClientProfile('ada')

    expect(data?.standing).toEqual({
      tier: 'TASTEMAKER',
      topPercent: 4,
      city: 'Brooklyn',
    })
  })

  it('returns null (404) for a client without a public profile', async () => {
    mocks.clientProfile.findUnique.mockResolvedValue(
      profileRow({ isPublicProfile: false }),
    )

    expect(await loadPublicClientProfile('ada')).toBeNull()
  })
})
