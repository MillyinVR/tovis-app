// lib/booking/resolveDiscoveryFinalize.sourceLook.test.ts
//
// Focused coverage for remix attribution: resolveDiscoveryFinalize must surface
// the validated sourceLookPostId (the trust boundary for remix attribution).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BookingSource,
  LookPostStatus,
  ModerationStatus,
} from '@prisma/client'

const mocks = vi.hoisted(() => ({
  lookPostFindUnique: vi.fn(),
  mediaAssetFindUnique: vi.fn(),
  attributionEventFindFirst: vi.fn(),
  bookingCount: vi.fn(),
  proClientInviteCount: vi.fn(),
  messageThreadCount: vi.fn(),
  paymentSettingsFindUnique: vi.fn(),
  subscriptionFindUnique: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    lookPost: { findUnique: mocks.lookPostFindUnique },
    mediaAsset: { findUnique: mocks.mediaAssetFindUnique },
    attributionEvent: { findFirst: mocks.attributionEventFindFirst },
    booking: { count: mocks.bookingCount },
    proClientInvite: { count: mocks.proClientInviteCount },
    messageThread: { count: mocks.messageThreadCount },
    professionalPaymentSettings: { findUnique: mocks.paymentSettingsFindUnique },
    professionalSubscription: { findUnique: mocks.subscriptionFindUnique },
  },
}))

import { resolveDiscoveryFinalize } from './resolveDiscoveryFinalize'

const BASE = {
  clientId: 'client_1',
  clientUserId: null,
  professionalId: 'pro_1',
  source: BookingSource.DISCOVERY,
  aftercare: false,
}

describe('resolveDiscoveryFinalize — sourceLookPostId (remix attribution)', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((m) => m.mockReset())
    mocks.attributionEventFindFirst.mockResolvedValue(null)
    mocks.bookingCount.mockResolvedValue(0)
    mocks.proClientInviteCount.mockResolvedValue(0)
    mocks.messageThreadCount.mockResolvedValue(0)
    mocks.paymentSettingsFindUnique.mockResolvedValue(null)
    mocks.subscriptionFindUnique.mockResolvedValue(null)
  })

  it('returns the validated lookPostId when the look is owned + published + approved', async () => {
    mocks.lookPostFindUnique.mockResolvedValue({
      professionalId: 'pro_1',
      status: LookPostStatus.PUBLISHED,
      moderationStatus: ModerationStatus.APPROVED,
    })

    const result = await resolveDiscoveryFinalize({
      ...BASE,
      lookPostId: 'look_42',
      mediaId: null,
    })

    expect(result.sourceLookPostId).toBe('look_42')
  })

  it('returns null when the look belongs to a different pro (not a valid remix source)', async () => {
    mocks.lookPostFindUnique.mockResolvedValue({
      professionalId: 'pro_OTHER',
      status: LookPostStatus.PUBLISHED,
      moderationStatus: ModerationStatus.APPROVED,
    })

    const result = await resolveDiscoveryFinalize({
      ...BASE,
      lookPostId: 'look_42',
      mediaId: null,
    })

    expect(result.sourceLookPostId).toBeNull()
  })

  it('returns null for a media-only booking (no LookPost)', async () => {
    mocks.mediaAssetFindUnique.mockResolvedValue({ professionalId: 'pro_1' })

    const result = await resolveDiscoveryFinalize({
      ...BASE,
      lookPostId: null,
      mediaId: 'media_9',
    })

    expect(result.sourceLookPostId).toBeNull()
  })

  it('returns null for an aftercare booking (short-circuit, never a remix)', async () => {
    const result = await resolveDiscoveryFinalize({
      ...BASE,
      aftercare: true,
      lookPostId: 'look_42',
      mediaId: null,
    })

    expect(result.sourceLookPostId).toBeNull()
    expect(mocks.lookPostFindUnique).not.toHaveBeenCalled()
  })
})
