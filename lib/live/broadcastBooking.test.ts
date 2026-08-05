// lib/live/broadcastBooking.test.ts
//
// broadcastBookingChange() promises two things that its ~16 call sites rely on
// without re-checking:
//
//   1. It NEVER throws. Every call site invokes it AFTER the write has
//      committed, and most sit inside a route-level try/catch that turns any
//      throw into a 500. A throw here would therefore report failure for a
//      booking that actually exists — the client retries, and the pro sees a
//      duplicate. Fail-open is not a nicety, it is the contract.
//   2. It resolves BOTH parties — the booking's pro and its client — so a
//      decision reaches the salon computer, the pro's phone, and the client's
//      own devices.
//
// Neither was covered before. These tests are the contract.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  bookingFindUnique: vi.fn(),
  broadcastChange: vi.fn(),
  safeError: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    booking: { findUnique: mocks.bookingFindUnique },
  },
}))

vi.mock('./broadcastAudience', () => ({
  broadcastChange: mocks.broadcastChange,
}))

vi.mock('@/lib/security/logging', () => ({
  safeError: mocks.safeError,
}))

import { broadcastBookingChange } from './broadcastBooking'

describe('broadcastBookingChange', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    mocks.safeError.mockImplementation((error: unknown) => String(error))
    mocks.broadcastChange.mockResolvedValue(undefined)
    mocks.bookingFindUnique.mockResolvedValue({
      professionalId: 'pro_1',
      client: { userId: 'user_client_1' },
    })
  })

  it('notifies the booking pro AND the booking client', async () => {
    await broadcastBookingChange('bk_1', 'consultation')

    expect(mocks.bookingFindUnique).toHaveBeenCalledWith({
      where: { id: 'bk_1' },
      select: {
        professionalId: true,
        client: { select: { userId: true } },
      },
    })

    expect(mocks.broadcastChange).toHaveBeenCalledWith({
      topic: 'consultation',
      professionalId: 'pro_1',
      userIds: ['user_client_1'],
    })
  })

  it('still notifies the pro when the client has no linked user account', async () => {
    // A pro-created booking for a walk-in has a client row with no user. The
    // pro must still hear about it — dropping the whole ping because one party
    // is unreachable would strand the surface this feature exists to refresh.
    mocks.bookingFindUnique.mockResolvedValueOnce({
      professionalId: 'pro_1',
      client: { userId: null },
    })

    await broadcastBookingChange('bk_1', 'bookings')

    expect(mocks.broadcastChange).toHaveBeenCalledWith({
      topic: 'bookings',
      professionalId: 'pro_1',
      userIds: [null],
    })
  })

  it('does not broadcast for a booking that does not exist', async () => {
    mocks.bookingFindUnique.mockResolvedValueOnce(null)

    await expect(
      broadcastBookingChange('bk_missing', 'bookings'),
    ).resolves.toBeUndefined()

    expect(mocks.broadcastChange).not.toHaveBeenCalled()
  })

  it('never throws when the booking lookup fails', async () => {
    mocks.bookingFindUnique.mockRejectedValueOnce(new Error('db down'))

    await expect(
      broadcastBookingChange('bk_1', 'bookings'),
    ).resolves.toBeUndefined()

    expect(mocks.broadcastChange).not.toHaveBeenCalled()
  })

  it('never throws when the broadcast itself fails', async () => {
    // The write has already committed by the time we get here. A transport
    // failure must cost freshness, never the caller's 2xx.
    mocks.broadcastChange.mockRejectedValueOnce(new Error('realtime down'))

    await expect(
      broadcastBookingChange('bk_1', 'bookings'),
    ).resolves.toBeUndefined()
  })
})
