// lib/viralRequests/proLibrary.test.ts
//
// The pro side of viral looks, at the level only this module can answer: WHICH
// rows a pro is allowed to see and act on, and what an offer means.
//
// The sharpest assertions here are about the two ways this feature could go
// back to lying:
//
//   1. the offering count must EXCLUDE withdrawn pros — an unfiltered count is
//      exactly the bug (`_count.approvalFanOuts`) this model was added to fix,
//      one table over;
//   2. a pro must not be able to opt into a look they were never matched to —
//      the fan-out is the only thing that ever established relevance, and a
//      pro-supplied id is not evidence of it.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ModerationStatus, ViralServiceRequestStatus } from '@prisma/client'

const mockPrisma = vi.hoisted(() => ({
  viralServiceRequest: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
  },
  viralRequestProOffer: {
    upsert: vi.fn(),
    updateMany: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }))

import { LIVE_VIRAL_REQUEST_WHERE, OFFERING_PRO_OFFER_WHERE } from './liveLooks'
import {
  loadProViralRequestLibrary,
  offerViralRequestAsPro,
  toProViralRequestEntry,
  withdrawViralRequestOfferAsPro,
} from './proLibrary'

const APPROVED_AT = new Date('2026-09-10T12:00:00.000Z')
const OFFERED_AT = new Date('2026-09-11T09:00:00.000Z')

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'viral_1',
    name: 'Wolf Cut',
    sourceUrl: 'https://www.tiktok.com/@x/video/1',
    approvedAt: APPROVED_AT,
    coverImageUrl: null,
    requestedCategory: { id: 'cat_1', name: 'Hair' },
    proOffers: [],
    _count: { proOffers: 0 },
    ...overrides,
  }
}

describe('the live predicate', () => {
  // Pinned rather than described: a pro must not be offered a look a client
  // cannot see. It now LIVES in ./liveLooks and the client home composes the
  // same constant, so "identical" is enforced by the import rather than by two
  // copies agreeing — this test pins the value itself.
  it('is approved, moderation-approved and not removed', () => {
    expect(LIVE_VIRAL_REQUEST_WHERE).toEqual({
      status: ViralServiceRequestStatus.APPROVED,
      moderationStatus: ModerationStatus.APPROVED,
      removedAt: null,
    })
  })
})

describe('toProViralRequestEntry', () => {
  it('reports no offer when the pro has none', () => {
    const entry = toProViralRequestEntry(row())
    expect(entry.offering).toBe(false)
    expect(entry.offeredAt).toBeNull()
  })

  it('reports an active offer, and keeps the date they FIRST said yes', () => {
    const entry = toProViralRequestEntry(
      row({ proOffers: [{ withdrawnAt: null, createdAt: OFFERED_AT }], _count: { proOffers: 1 } }),
    )
    expect(entry.offering).toBe(true)
    expect(entry.offeredAt).toEqual(OFFERED_AT)
    expect(entry.offeringProCount).toBe(1)
  })

  // 🔴 A withdrawn row still EXISTS (the pair is unique, so withdrawal stamps
  // rather than deletes). Reading `proOffers.length > 0` would call a pro who
  // backed out an active offer.
  it('does not treat a withdrawn row as offering', () => {
    const entry = toProViralRequestEntry(
      row({
        proOffers: [{ withdrawnAt: new Date('2026-09-12T00:00:00.000Z'), createdAt: OFFERED_AT }],
      }),
    )
    expect(entry.offering).toBe(false)
    expect(entry.offeredAt).toBeNull()
  })
})

describe('loadProViralRequestLibrary', () => {
  beforeEach(() => {
    for (const group of [mockPrisma.viralServiceRequest, mockPrisma.viralRequestProOffer]) {
      for (const fn of Object.values(group)) fn.mockReset()
    }
  })

  it('scopes to looks this pro was MATCHED to, newest approval first', async () => {
    mockPrisma.viralServiceRequest.findMany.mockResolvedValue([row()])

    const entries = await loadProViralRequestLibrary('pro_1')

    expect(entries).toHaveLength(1)
    expect(entries[0]?.name).toBe('Wolf Cut')

    const args = mockPrisma.viralServiceRequest.findMany.mock.calls[0]?.[0]
    // 🔴 Without the fan-out clause this becomes a platform-wide feed of every
    // approved look, which is not what a pro was told about.
    expect(args.where.approvalFanOuts).toEqual({ some: { professionalId: 'pro_1' } })
    expect(args.where.status).toBe(ViralServiceRequestStatus.APPROVED)
    expect(args.where.removedAt).toBeNull()
    expect(args.orderBy).toEqual({ approvedAt: 'desc' })
  })

  // 🔴 The count the client home's "N pros now offer this" will finally mean.
  // An unfiltered count reproduces the original defect against a new table.
  it('counts by the SHARED offering predicate, and scopes the offer read to this pro', async () => {
    mockPrisma.viralServiceRequest.findMany.mockResolvedValue([])
    await loadProViralRequestLibrary('pro_1')

    const select = mockPrisma.viralServiceRequest.findMany.mock.calls[0]?.[0].select
    // Identity with the constant, not a re-spelling of it: the pro's count and
    // the client's count are the same number or the two surfaces disagree.
    expect(select._count.select.proOffers).toEqual({
      where: OFFERING_PRO_OFFER_WHERE,
    })
    expect(select.proOffers.where).toEqual({ professionalId: 'pro_1' })
  })

  // The submitter's attachment is evidence in the admin queue. A pro surface
  // has no more business loading it than a client surface does.
  it('never selects the submitter\'s own media', async () => {
    mockPrisma.viralServiceRequest.findMany.mockResolvedValue([])
    await loadProViralRequestLibrary('pro_1')

    const select = mockPrisma.viralServiceRequest.findMany.mock.calls[0]?.[0].select
    expect(select).not.toHaveProperty('mediaUrlsJson')
    expect(select.coverImageUrl).toBe(true)
  })
})

describe('offering and withdrawing', () => {
  beforeEach(() => {
    for (const group of [mockPrisma.viralServiceRequest, mockPrisma.viralRequestProOffer]) {
      for (const fn of Object.values(group)) fn.mockReset()
    }
    mockPrisma.viralRequestProOffer.upsert.mockResolvedValue({ id: 'offer_1' })
    mockPrisma.viralRequestProOffer.updateMany.mockResolvedValue({ count: 1 })
  })

  function matched() {
    mockPrisma.viralServiceRequest.findFirst.mockResolvedValue({
      id: 'viral_1',
      approvalFanOuts: [{ id: 'fanout_1' }],
    })
  }

  it('opts a matched pro in, idempotently', async () => {
    matched()
    mockPrisma.viralServiceRequest.findUnique.mockResolvedValue(
      row({ proOffers: [{ withdrawnAt: null, createdAt: OFFERED_AT }], _count: { proOffers: 1 } }),
    )

    const result = await offerViralRequestAsPro({
      professionalId: 'pro_1',
      viralRequestId: 'viral_1',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.entry.offering).toBe(true)
    expect(result.entry.offeringProCount).toBe(1)

    const upsert = mockPrisma.viralRequestProOffer.upsert.mock.calls[0]?.[0]
    // A second tap re-activates the same row. `createdAt` is NOT reset — it is
    // when this pro first said yes, and the client list orders on it.
    expect(upsert.update).toEqual({ withdrawnAt: null })
    expect(upsert.where.viralServiceRequestId_professionalId).toEqual({
      viralServiceRequestId: 'viral_1',
      professionalId: 'pro_1',
    })
  })

  // 🔴 The authorization check. The fan-out is the ONLY thing that made this
  // look relevant to this pro; an id in the URL is not evidence of anything.
  it('refuses a pro who was never matched, and writes nothing', async () => {
    mockPrisma.viralServiceRequest.findFirst.mockResolvedValue({
      id: 'viral_1',
      approvalFanOuts: [],
    })

    const result = await offerViralRequestAsPro({
      professionalId: 'pro_other',
      viralRequestId: 'viral_1',
    })

    expect(result).toEqual({ ok: false, reason: 'NOT_MATCHED' })
    expect(mockPrisma.viralRequestProOffer.upsert).not.toHaveBeenCalled()
  })

  it('refuses a look that is not live, and writes nothing', async () => {
    mockPrisma.viralServiceRequest.findFirst.mockResolvedValue(null)

    const result = await offerViralRequestAsPro({
      professionalId: 'pro_1',
      viralRequestId: 'viral_gone',
    })

    expect(result).toEqual({ ok: false, reason: 'NOT_FOUND' })
    expect(mockPrisma.viralRequestProOffer.upsert).not.toHaveBeenCalled()

    // The gate must apply the live predicate, not just look the id up.
    const where = mockPrisma.viralServiceRequest.findFirst.mock.calls[0]?.[0].where
    expect(where.status).toBe(ViralServiceRequestStatus.APPROVED)
    expect(where.moderationStatus).toBe(ModerationStatus.APPROVED)
    expect(where.removedAt).toBeNull()
  })

  it('withdraws by STAMPING, never deleting, so the unique pair survives', async () => {
    matched()
    mockPrisma.viralServiceRequest.findUnique.mockResolvedValue(row())

    const result = await withdrawViralRequestOfferAsPro({
      professionalId: 'pro_1',
      viralRequestId: 'viral_1',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.entry.offering).toBe(false)

    const update = mockPrisma.viralRequestProOffer.updateMany.mock.calls[0]?.[0]
    expect(update.where.withdrawnAt).toBeNull()
    expect(update.data.withdrawnAt).toBeInstanceOf(Date)
    expect(mockPrisma.viralRequestProOffer).not.toHaveProperty('delete')
  })

  it('runs the same gate on withdraw as on offer', async () => {
    mockPrisma.viralServiceRequest.findFirst.mockResolvedValue({
      id: 'viral_1',
      approvalFanOuts: [],
    })

    const result = await withdrawViralRequestOfferAsPro({
      professionalId: 'pro_other',
      viralRequestId: 'viral_1',
    })

    expect(result).toEqual({ ok: false, reason: 'NOT_MATCHED' })
    expect(mockPrisma.viralRequestProOffer.updateMany).not.toHaveBeenCalled()
  })
})
