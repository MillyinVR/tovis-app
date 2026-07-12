// app/u/[handle]/_data/loadPublicClientProfile.test.ts
//
// §19c divergence (a) — client-authored looks are created PENDING_REVIEW, so the
// public /u/[handle] grid must require moderationStatus APPROVED or it exposes
// looks before a human approves them. Locks the gate into the query.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LookPostStatus,
  LookPostVisibility,
  ModerationStatus,
} from '@prisma/client'

const mocks = vi.hoisted(() => {
  const clientProfile = { findUnique: vi.fn() }
  return { clientProfile, prisma: { clientProfile } }
})

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }))

import { loadPublicClientProfile } from './loadPublicClientProfile'

describe('loadPublicClientProfile (§19c — public looks grid moderation gate)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('only queries PUBLISHED + PUBLIC + APPROVED, non-removed authored looks', async () => {
    mocks.clientProfile.findUnique.mockResolvedValue({
      id: 'client_1',
      handle: 'ada',
      avatarUrl: null,
      publicBio: null,
      isPublicProfile: true,
      _count: { followers: 0, following: 0 },
      authoredLooks: [],
    })

    await loadPublicClientProfile('ada')

    expect(mocks.clientProfile.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          authoredLooks: expect.objectContaining({
            where: {
              status: LookPostStatus.PUBLISHED,
              visibility: LookPostVisibility.PUBLIC,
              moderationStatus: ModerationStatus.APPROVED,
              removedAt: null,
            },
          }),
        }),
      }),
    )
  })

  it('returns null (404) for a client without a public profile', async () => {
    mocks.clientProfile.findUnique.mockResolvedValue({
      id: 'client_1',
      handle: 'ada',
      avatarUrl: null,
      publicBio: null,
      isPublicProfile: false,
      _count: { followers: 0, following: 0 },
      authoredLooks: [],
    })

    expect(await loadPublicClientProfile('ada')).toBeNull()
  })
})
