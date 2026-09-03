// app/professionals/[id]/_data/loadProPublicProfileBase.test.ts
//
// The public profile (web page AND GET /api/v1/professionals/[id], which the
// iOS booking sheet reads) must ship the offering modes the pro can HOST, not
// the raw `offersInSalon` / `offersMobile` flags. The booking bootstrap narrows
// to hostable modes before placing anything, so a profile that ships the raw
// flags tells a client "In salon from $300" for a service the pro only travels
// for — and the iOS sheet, opening in SALON off that flag, is refused with
// MODE_NOT_SUPPORTED for a service that IS bookable (the founder's own feed,
// 2026-09-02: three locations, only the MOBILE_BASE bookable).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma, Role, VerificationStatus } from '@prisma/client'

const mocks = vi.hoisted(() => {
  const professionalProfile = { findUnique: vi.fn() }
  const review = { aggregate: vi.fn() }
  const professionalFavorite = { count: vi.fn(), findUnique: vi.fn() }
  const booking = { count: vi.fn() }
  const proFollow = { count: vi.fn() }
  const lookPost = { count: vi.fn() }
  const professionalServiceOffering = { findMany: vi.fn() }
  const professionalPaymentSettings = { findUnique: vi.fn() }
  const serviceFavorite = { findMany: vi.fn() }
  return {
    loadProLocationCapability: vi.fn(),
    prisma: {
      professionalProfile,
      review,
      professionalFavorite,
      booking,
      proFollow,
      lookPost,
      professionalServiceOffering,
      professionalPaymentSettings,
      serviceFavorite,
    },
  }
})

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }))

// The capability READ is mocked (it is a prisma query with its own tests in
// lib/offerings/locationCapability.test.ts); the narrowing RULE stays real.
vi.mock('@/lib/offerings/locationCapability', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/offerings/locationCapability')>()),
  loadProLocationCapability: mocks.loadProLocationCapability,
}))

vi.mock('@/lib/pro/entitlements', () => ({
  getProEntitlements: vi.fn(async () => []),
}))

vi.mock('@/lib/profiles/proProfileSignals', () => ({
  loadProProfileSignals: vi.fn(async () => ({})),
}))

vi.mock('@/lib/profiles/publicProfileMappers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/profiles/publicProfileMappers')>()),
  renderPublicProfileCoverUrl: vi.fn(async () => null),
  mapPublicProfileHeaderToDto: vi.fn(() => ({})),
}))

import { loadProPublicProfileBase } from './loadProPublicProfile'

const PRO_ID = 'pro_1'

function offeringRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'offering_1',
    professionalId: PRO_ID,
    serviceId: 'svc_1',
    title: null,
    description: null,
    customImageUrl: null,
    salonPriceStartingAt: new Prisma.Decimal('300.00'),
    salonDurationMinutes: 120,
    mobilePriceStartingAt: new Prisma.Decimal('300.00'),
    mobileDurationMinutes: 120,
    offersInSalon: true,
    offersMobile: true,
    isActive: true,
    service: { id: 'svc_1', name: 'Balayage', defaultImageUrl: null },
    ...overrides,
  }
}

async function load() {
  const result = await loadProPublicProfileBase({
    professionalId: PRO_ID,
    viewer: { id: 'client_user_1', role: Role.CLIENT },
    brandName: 'Brand',
  })
  if (result.kind !== 'ok') throw new Error(`unexpected result ${result.kind}`)
  return result.base
}

describe('loadProPublicProfileBase — offering modes are narrowed to hostable ones', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.prisma.professionalProfile.findUnique.mockResolvedValue({
      id: PRO_ID,
      userId: 'pro_user_1',
      verificationStatus: VerificationStatus.APPROVED,
      signatureMediaAssetId: null,
    })
    mocks.prisma.review.aggregate.mockResolvedValue({
      _count: { _all: 0 },
      _avg: { rating: null },
    })
    mocks.prisma.professionalFavorite.count.mockResolvedValue(0)
    mocks.prisma.professionalFavorite.findUnique.mockResolvedValue(null)
    mocks.prisma.booking.count.mockResolvedValue(0)
    mocks.prisma.proFollow.count.mockResolvedValue(0)
    mocks.prisma.lookPost.count.mockResolvedValue(0)
    mocks.prisma.professionalPaymentSettings.findUnique.mockResolvedValue(null)
    mocks.prisma.serviceFavorite.findMany.mockResolvedValue([])
    mocks.prisma.professionalServiceOffering.findMany.mockResolvedValue([
      offeringRow(),
    ])
  })

  it('asks for THIS pro’s location capability', async () => {
    mocks.loadProLocationCapability.mockResolvedValue({ salon: true, mobile: true })

    await load()

    expect(mocks.loadProLocationCapability).toHaveBeenCalledWith(PRO_ID)
  })

  it('drops the salon mode (flag, pricing line, price-from) when the pro has no bookable salon', async () => {
    mocks.loadProLocationCapability.mockResolvedValue({ salon: false, mobile: true })

    const base = await load()

    expect(base.offerings).toHaveLength(1)
    expect(base.offerings[0]).toMatchObject({
      offersInSalon: false,
      offersMobile: true,
    })
    // The pricing copy is derived from the SAME narrowed row — no salon line.
    const pricingCopy = base.offerings[0]?.pricingLines.join(' ') ?? ''
    expect(pricingCopy).not.toMatch(/salon/i)
    expect(pricingCopy).toMatch(/mobile/i)
    // And the raw rows handed to the page's sub-loaders are the narrowed ones.
    expect(base.offeringRows[0]).toMatchObject({
      offersInSalon: false,
      offersMobile: true,
    })
  })

  it('keeps both modes when the pro can host both', async () => {
    mocks.loadProLocationCapability.mockResolvedValue({ salon: true, mobile: true })

    const base = await load()

    expect(base.offerings[0]).toMatchObject({
      offersInSalon: true,
      offersMobile: true,
    })
  })

  it('never ADDS a mode the offering does not claim', async () => {
    mocks.prisma.professionalServiceOffering.findMany.mockResolvedValue([
      offeringRow({ offersMobile: false }),
    ])
    mocks.loadProLocationCapability.mockResolvedValue({ salon: true, mobile: true })

    const base = await load()

    expect(base.offerings[0]).toMatchObject({
      offersInSalon: true,
      offersMobile: false,
    })
  })
})
