import { ModerationStatus, ViralServiceRequestStatus } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockPrisma = vi.hoisted(() => ({
  viralServiceRequest: { findFirst: vi.fn() },
}))

vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }))

import { PUBLICLY_LISTABLE_PRO_STATUSES } from '@/lib/proTrustState'

import {
  CLIENT_VIRAL_LOOK_PRO_LIMIT,
  LIVE_VIRAL_REQUEST_WHERE,
  OFFERING_PRO_OFFER_WHERE,
  loadLiveViralLookForClient,
  offeringProCountSelect,
} from './liveLooks'

const OFFERED_AT = new Date('2026-09-11T09:00:00.000Z')

describe('LIVE_VIRAL_REQUEST_WHERE', () => {
  it('is approved, moderation-approved and not removed', () => {
    expect(LIVE_VIRAL_REQUEST_WHERE).toEqual({
      status: ViralServiceRequestStatus.APPROVED,
      moderationStatus: ModerationStatus.APPROVED,
      removedAt: null,
    })
  })
})

describe('OFFERING_PRO_OFFER_WHERE', () => {
  // Pinned by VALUE, not by identity. Other suites assert "the count uses this
  // constant", and that assertion is vacuous unless something here says what
  // the constant actually contains.
  it('excludes withdrawn offers', () => {
    expect(OFFERING_PRO_OFFER_WHERE.withdrawnAt).toBeNull()
  })

  it('excludes pros the marketplace will not list', () => {
    expect(OFFERING_PRO_OFFER_WHERE.professional).toMatchObject({
      verificationStatus: { in: PUBLICLY_LISTABLE_PRO_STATUSES },
    })
    // The whole point of the filter: the statuses an admin used to say no.
    expect(PUBLICLY_LISTABLE_PRO_STATUSES).not.toContain('REJECTED')
    expect(PUBLICLY_LISTABLE_PRO_STATUSES).not.toContain('NEEDS_INFO')
  })

  it('is the predicate the shared _count fragment counts by', () => {
    expect(offeringProCountSelect).toEqual({
      select: { proOffers: { where: OFFERING_PRO_OFFER_WHERE } },
    })
  })
})

describe('loadLiveViralLookForClient', () => {
  beforeEach(() => {
    mockPrisma.viralServiceRequest.findFirst.mockReset()
  })

  function args() {
    return mockPrisma.viralServiceRequest.findFirst.mock.calls[0]?.[0]
  }

  it('returns null for a look that is not live, so the page 404s', async () => {
    mockPrisma.viralServiceRequest.findFirst.mockResolvedValue(null)
    await expect(loadLiveViralLookForClient('viral_1')).resolves.toBeNull()
  })

  it('scopes the read to a LIVE look of that id', async () => {
    mockPrisma.viralServiceRequest.findFirst.mockResolvedValue(null)
    await loadLiveViralLookForClient('viral_1')

    expect(args().where).toEqual({ id: 'viral_1', ...LIVE_VIRAL_REQUEST_WHERE })
  })

  it('lists and counts by the SAME predicate, so the two cannot disagree', async () => {
    mockPrisma.viralServiceRequest.findFirst.mockResolvedValue(null)
    await loadLiveViralLookForClient('viral_1')

    const select = args().select
    expect(select.proOffers.where).toEqual(OFFERING_PRO_OFFER_WHERE)
    expect(select._count).toEqual(offeringProCountSelect)
    expect(select.proOffers.take).toBe(CLIENT_VIRAL_LOOK_PRO_LIMIT)
  })

  // §3 of the handoff: the submitter's attachment is evidence for the admin
  // queue. Only an admin-chosen cover publishes.
  it("never selects the submitter's own media", async () => {
    mockPrisma.viralServiceRequest.findFirst.mockResolvedValue(null)
    await loadLiveViralLookForClient('viral_1')

    expect(args().select).not.toHaveProperty('mediaUrlsJson')
    expect(args().select.coverImageUrl).toBe(true)
  })

  it('resolves the pro name through the privacy-aware formatter', async () => {
    mockPrisma.viralServiceRequest.findFirst.mockResolvedValue({
      id: 'viral_1',
      name: 'Wolf Cut',
      sourceUrl: null,
      coverImageUrl: null,
      approvedAt: null,
      requestedCategory: { name: 'Hair' },
      proOffers: [
        {
          createdAt: OFFERED_AT,
          professional: {
            id: 'pro_1',
            businessName: null,
            firstName: 'Mara',
            lastName: 'Quinn',
            handle: 'mara',
            // A pro who asked to be shown by their real name gets it; a pro on
            // the default BUSINESS_NAME mode would not.
            nameDisplay: 'REAL_NAME',
            avatarUrl: null,
            professionType: null,
            location: 'Portland',
            isPremium: false,
          },
        },
      ],
      _count: { proOffers: 1 },
    })

    const look = await loadLiveViralLookForClient('viral_1')

    expect(look?.pros).toEqual([
      {
        id: 'pro_1',
        name: 'Mara Quinn',
        handle: 'mara',
        avatarUrl: null,
        professionType: null,
        location: 'Portland',
        isPremium: false,
        offeredAt: OFFERED_AT,
      },
    ])
    // The count is the TOTAL, not the length of a capped list.
    expect(look?.offeringProCount).toBe(1)
  })

  it('reports the true total even when the list is capped', async () => {
    mockPrisma.viralServiceRequest.findFirst.mockResolvedValue({
      id: 'viral_1',
      name: 'Wolf Cut',
      sourceUrl: null,
      coverImageUrl: null,
      approvedAt: null,
      requestedCategory: null,
      proOffers: [],
      _count: { proOffers: 91 },
    })

    const look = await loadLiveViralLookForClient('viral_1')
    expect(look?.offeringProCount).toBe(91)
    expect(look?.categoryName).toBeNull()
  })
})
