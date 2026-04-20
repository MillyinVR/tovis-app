// lib/looks/access.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LookPostStatus,
  LookPostVisibility,
  ModerationStatus,
  VerificationStatus,
} from '@prisma/client'

const mocks = vi.hoisted(() => ({
  getViewerFollowState: vi.fn(),
}))

vi.mock('@/lib/follows', () => ({
  getViewerFollowState: mocks.getViewerFollowState,
}))

import { loadLookAccess, lookAccessSelect } from './access'

function makeDb() {
  return {
    lookPost: {
      findUnique: vi.fn(),
    },
  }
}

describe('lib/looks/access.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null when the look does not exist', async () => {
    const db = makeDb()
    db.lookPost.findUnique.mockResolvedValue(null)

    const result = await loadLookAccess(db as never, {
      lookPostId: 'look_1',
      viewerClientId: 'client_1',
      viewerProfessionalId: null,
    })

    expect(db.lookPost.findUnique).toHaveBeenCalledWith({
      where: { id: 'look_1' },
      select: lookAccessSelect,
    })
    expect(result).toBeNull()
    expect(mocks.getViewerFollowState).not.toHaveBeenCalled()
  })

  it('marks the viewer as owner when professional ids match', async () => {
    const db = makeDb()
    db.lookPost.findUnique.mockResolvedValue({
      id: 'look_1',
      professionalId: 'pro_1',
      status: LookPostStatus.PUBLISHED,
      visibility: LookPostVisibility.PUBLIC,
      moderationStatus: ModerationStatus.APPROVED,
      saveCount: 3,
      professional: {
        id: 'pro_1',
        verificationStatus: VerificationStatus.APPROVED,
      },
    })

    const result = await loadLookAccess(db as never, {
      lookPostId: 'look_1',
      viewerClientId: 'client_1',
      viewerProfessionalId: 'pro_1',
    })

    expect(result).toEqual({
      look: {
        id: 'look_1',
        professionalId: 'pro_1',
        status: LookPostStatus.PUBLISHED,
        visibility: LookPostVisibility.PUBLIC,
        moderationStatus: ModerationStatus.APPROVED,
        saveCount: 3,
        professional: {
          id: 'pro_1',
          verificationStatus: VerificationStatus.APPROVED,
        },
      },
      isOwner: true,
      viewerFollowsProfessional: false,
    })
    expect(mocks.getViewerFollowState).not.toHaveBeenCalled()
  })

  it('loads follow state for a non-owner viewer', async () => {
    const db = makeDb()
    db.lookPost.findUnique.mockResolvedValue({
      id: 'look_1',
      professionalId: 'pro_2',
      status: LookPostStatus.PUBLISHED,
      visibility: LookPostVisibility.FOLLOWERS_ONLY,
      moderationStatus: ModerationStatus.APPROVED,
      saveCount: 7,
      professional: {
        id: 'pro_2',
        verificationStatus: VerificationStatus.APPROVED,
      },
    })
    mocks.getViewerFollowState.mockResolvedValue(true)

    const result = await loadLookAccess(db as never, {
      lookPostId: 'look_1',
      viewerClientId: 'client_1',
      viewerProfessionalId: 'pro_1',
    })

    expect(mocks.getViewerFollowState).toHaveBeenCalledWith(db, {
      viewerClientId: 'client_1',
      professionalId: 'pro_2',
    })

    expect(result).toEqual({
      look: {
        id: 'look_1',
        professionalId: 'pro_2',
        status: LookPostStatus.PUBLISHED,
        visibility: LookPostVisibility.FOLLOWERS_ONLY,
        moderationStatus: ModerationStatus.APPROVED,
        saveCount: 7,
        professional: {
          id: 'pro_2',
          verificationStatus: VerificationStatus.APPROVED,
        },
      },
      isOwner: false,
      viewerFollowsProfessional: true,
    })
  })
})