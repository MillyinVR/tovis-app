// app/api/v1/client/priority-offer/route.test.ts

import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  LastMinuteOfferType,
  LastMinuteRecipientStatus,
} from '@prisma/client'

const mocks = vi.hoisted(() => ({
  jsonOk: vi.fn((body: unknown, status = 200) => ({ ok: true, status, body })),
  requireClient: vi.fn(),
  findMany: vi.fn(),
  pickProfessionalPublicDisplayName: vi.fn(() => 'Ava Pro'),
  professionalProfileHref: vi.fn((id: string) => `/professionals/${id}`),
  pickRecipientTierPlan: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: { lastMinuteRecipient: { findMany: mocks.findMany } },
}))

vi.mock('@/app/api/_utils', () => ({
  jsonOk: mocks.jsonOk,
  requireClient: mocks.requireClient,
}))

vi.mock('@/lib/privacy/professionalDisplayName', () => ({
  pickProfessionalPublicDisplayName: mocks.pickProfessionalPublicDisplayName,
}))

vi.mock('@/lib/profiles/profileHrefs', () => ({
  professionalProfileHref: mocks.professionalProfileHref,
}))

vi.mock('@/lib/lastMinute/pickTierPlan', () => ({
  pickRecipientTierPlan: mocks.pickRecipientTierPlan,
}))

import { GET } from './route'

function makeRow(overrides?: {
  services?: Array<{ serviceId: string | null; offeringId: string | null; service: { name: string } }>
}) {
  return {
    id: 'recip_1',
    status: LastMinuteRecipientStatus.PRIORITY_OFFERED,
    priorityExpiresAt: new Date('2026-07-10T18:00:00.000Z'),
    priorityOrder: 1,
    notifiedTier: 'WAITLIST',
    firstMatchedTier: 'WAITLIST',
    opening: {
      id: 'opening_1',
      startAt: new Date('2026-07-10T17:00:00.000Z'),
      endAt: new Date('2026-07-10T18:00:00.000Z'),
      note: null,
      timeZone: 'America/Los_Angeles',
      locationType: 'SALON',
      professional: {
        id: 'pro_1',
        businessName: 'Ava Studio',
        firstName: 'Ava',
        lastName: 'Pro',
        handle: 'ava',
        nameDisplay: 'FULL',
        avatarUrl: null,
      },
      services: overrides?.services ?? [
        { serviceId: 'svc_1', offeringId: 'off_1', service: { name: 'Balayage' } },
      ],
      tierPlans: [],
    },
  }
}

describe('GET /api/v1/client/priority-offer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.jsonOk.mockImplementation((body: unknown, status = 200) => ({ ok: true, status, body }))
    mocks.professionalProfileHref.mockImplementation((id: string) => `/professionals/${id}`)
    mocks.pickProfessionalPublicDisplayName.mockReturnValue('Ava Pro')
    mocks.requireClient.mockResolvedValue({ ok: true, clientId: 'client_1' })
    mocks.pickRecipientTierPlan.mockReturnValue({
      offerType: LastMinuteOfferType.PERCENT_OFF,
      percentOff: 20,
      amountOff: null,
      freeAddOnService: null,
    })
  })

  // Read the mapped offers off the mocked `jsonOk({ offers }, 200)` call so we
  // never have to cast the route's real `Response` return type.
  function offersFromLastCall(): Array<Record<string, unknown>> {
    const [payload] = mocks.jsonOk.mock.calls[0]!
    return (payload as { offers: Array<Record<string, unknown>> }).offers
  }

  it('returns the auth response when requireClient fails', async () => {
    const authRes = { ok: false, status: 401 }
    mocks.requireClient.mockResolvedValueOnce({ ok: false, res: authRes })

    const result: unknown = await GET()

    expect(result).toBe(authRes)
    expect(mocks.findMany).not.toHaveBeenCalled()
  })

  it('exposes flat professionalId/serviceId/offeringId from the primary service', async () => {
    mocks.findMany.mockResolvedValueOnce([makeRow()])

    await GET()
    const offer = offersFromLastCall()[0]!

    expect(offer.recipientId).toBe('recip_1')
    expect(offer.professionalId).toBe('pro_1')
    expect(offer.serviceId).toBe('svc_1')
    expect(offer.offeringId).toBe('off_1')
    // The LastMinuteOpening id a native claim finalizes with (same id claimHref embeds).
    expect(offer.openingId).toBe('opening_1')
    // The web-facing hrefs still ship alongside the flat ids.
    expect(offer.proHref).toBe('/professionals/pro_1')
    expect(offer.claimHref).toContain('/offerings/off_1')
    expect(offer.incentiveLabel).toBe('20% off')
  })

  it('nulls serviceId/offeringId when the opening has no services', async () => {
    mocks.findMany.mockResolvedValueOnce([makeRow({ services: [] })])

    await GET()
    const offer = offersFromLastCall()[0]!

    expect(offer.professionalId).toBe('pro_1')
    expect(offer.serviceId).toBeNull()
    expect(offer.offeringId).toBeNull()
  })
})
