// lib/booking/trustSignals.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest'

// Hoisted so the module factories below can close over them (the repo's
// standard prisma-stub shape — see lib/messagesResolve.test.ts).
const mocks = vi.hoisted(() => ({
  prisma: {
    professionalProfile: { findUnique: vi.fn() },
    booking: { count: vi.fn() },
    review: { aggregate: vi.fn() },
  },
  getProNoShowSettings: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }))
vi.mock('@/lib/noShowProtection/settings', () => ({
  getProNoShowSettings: mocks.getProNoShowSettings,
}))

import {
  loadBookingTrustSignals,
  MIN_BOOKED_COUNT_TO_SHOW,
} from './trustSignals'

function given(args: {
  verificationStatus?: string | null
  completed?: number
  ratingAvg?: number | null
  ratingCount?: number
}): void {
  mocks.prisma.professionalProfile.findUnique.mockResolvedValue(
    args.verificationStatus === null
      ? null
      : { verificationStatus: args.verificationStatus ?? 'APPROVED' },
  )
  mocks.prisma.booking.count.mockResolvedValue(args.completed ?? 0)
  mocks.prisma.review.aggregate.mockResolvedValue({
    _avg: { rating: args.ratingAvg ?? null },
    _count: { _all: args.ratingCount ?? 0 },
  })
}

describe('loadBookingTrustSignals', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getProNoShowSettings.mockResolvedValue({
      enabled: true,
      chargeLateCancel: true,
      cancelWindowHours: 24,
    })
  })

  it('reports a verified, well-reviewed pro', async () => {
    given({ completed: 412, ratingAvg: 4.8, ratingCount: 96 })

    await expect(loadBookingTrustSignals('pro_1')).resolves.toEqual({
      verified: true,
      completedBookings: 412,
      rating: { average: 4.8, count: 96 },
      freeCancellationHours: 24,
    })
  })

  // The chip is a reassurance. Below the floor the number argues the opposite,
  // so it is withheld rather than shown small.
  it('withholds a booked count below the floor', async () => {
    given({ completed: MIN_BOOKED_COUNT_TO_SHOW - 1 })

    const result = await loadBookingTrustSignals('pro_1')

    expect(result.completedBookings).toBeNull()
  })

  it('shows the count at exactly the floor', async () => {
    given({ completed: MIN_BOOKED_COUNT_TO_SHOW })

    const result = await loadBookingTrustSignals('pro_1')

    expect(result.completedBookings).toBe(MIN_BOOKED_COUNT_TO_SHOW)
  })

  it('has no rating until at least one review exists', async () => {
    given({ ratingAvg: null, ratingCount: 0 })

    const result = await loadBookingTrustSignals('pro_1')

    expect(result.rating).toBeNull()
  })

  it.each(['REJECTED', 'NEEDS_INFO'])(
    'does not call a %s pro verified',
    async (status) => {
      given({ verificationStatus: status })

      const result = await loadBookingTrustSignals('pro_1')

      expect(result.verified).toBe(false)
    },
  )

  it('treats a missing pro as unverified rather than throwing', async () => {
    given({ verificationStatus: null })

    const result = await loadBookingTrustSignals('pro_1')

    expect(result.verified).toBe(false)
  })

  // ⚠️ Both switches matter. A pro can run no-show fees and still let clients
  // cancel free at any time; either one off means there is no window to state,
  // and the chip becomes the stronger "Free cancellation".
  it.each([
    { enabled: false, chargeLateCancel: true },
    { enabled: true, chargeLateCancel: false },
    { enabled: false, chargeLateCancel: false },
  ])('has no cancellation window when %o', async (settings) => {
    given({})
    mocks.getProNoShowSettings.mockResolvedValue({
      ...settings,
      cancelWindowHours: 24,
    })

    const result = await loadBookingTrustSignals('pro_1')

    expect(result.freeCancellationHours).toBeNull()
  })

  it('survives a no-show settings lookup that throws', async () => {
    given({ completed: 50 })
    mocks.getProNoShowSettings.mockRejectedValue(new Error('boom'))

    const result = await loadBookingTrustSignals('pro_1')

    expect(result.freeCancellationHours).toBeNull()
    expect(result.completedBookings).toBe(50)
  })
})
