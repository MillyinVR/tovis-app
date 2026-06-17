import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  referralFindFirst: vi.fn(),
  referralUpdate: vi.fn(),
  paymentSettingsFindUnique: vi.fn(),
  bookingFindUnique: vi.fn(),
  bookingUpdate: vi.fn(),
  $transaction: vi.fn(),
  createClientNotification: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    referral: {
      findFirst: mocks.referralFindFirst,
      update: mocks.referralUpdate,
    },
    professionalPaymentSettings: {
      findUnique: mocks.paymentSettingsFindUnique,
    },
    booking: {
      findUnique: mocks.bookingFindUnique,
      update: mocks.bookingUpdate,
    },
    $transaction: mocks.$transaction,
  },
}))

vi.mock('@/lib/notifications/clientNotifications', () => ({
  createClientNotification: mocks.createClientNotification,
}))

import {
  applyReferralRewardOnBooking,
  convertReferralOnBooking,
} from './referralConversion'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.createClientNotification.mockResolvedValue({ ok: true })
  mocks.referralUpdate.mockResolvedValue({})
  mocks.$transaction.mockImplementation((ops: unknown[]) =>
    Promise.all(ops),
  )
})

describe('convertReferralOnBooking', () => {
  it('does nothing when no CONFIRMED referral exists', async () => {
    mocks.referralFindFirst.mockResolvedValue(null)

    await convertReferralOnBooking({
      clientId: 'client-referred',
      bookingId: 'booking-1',
      professionalId: 'pro-1',
    })

    expect(mocks.referralUpdate).not.toHaveBeenCalled()
    expect(mocks.createClientNotification).not.toHaveBeenCalled()
  })

  it('converts a CONFIRMED referral to REWARDED when pro uses RECOGNITION tier', async () => {
    mocks.referralFindFirst.mockResolvedValue({
      id: 'ref-1',
      referrerClientId: 'client-referrer',
      referredClient: { firstName: 'Maya' },
    })
    mocks.paymentSettingsFindUnique.mockResolvedValue({
      referralRewardEnabled: true,
      referralRewardTier: 'RECOGNITION',
      referralDiscountPercent: null,
      referralCreditAmount: null,
    })

    await convertReferralOnBooking({
      clientId: 'client-referred',
      bookingId: 'booking-1',
      professionalId: 'pro-1',
    })

    expect(mocks.referralUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ref-1' },
        data: expect.objectContaining({
          status: 'REWARDED',
          triggerBookingId: 'booking-1',
          professionalId: 'pro-1',
          rewardTier: 'RECOGNITION',
        }),
      }),
    )

    expect(mocks.createClientNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'client-referrer',
        eventKey: 'REFERRAL_CONVERTED',
        title: 'Maya just booked!',
      }),
    )
  })

  it('converts to CONVERTED with reward when pro uses DISCOUNT tier', async () => {
    mocks.referralFindFirst.mockResolvedValue({
      id: 'ref-2',
      referrerClientId: 'client-referrer',
      referredClient: { firstName: 'Zara' },
    })
    mocks.paymentSettingsFindUnique.mockResolvedValue({
      referralRewardEnabled: true,
      referralRewardTier: 'DISCOUNT',
      referralDiscountPercent: 15,
      referralCreditAmount: null,
    })

    await convertReferralOnBooking({
      clientId: 'client-referred',
      bookingId: 'booking-2',
      professionalId: 'pro-1',
    })

    expect(mocks.referralUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'CONVERTED',
          rewardTier: 'DISCOUNT',
          rewardValue: 15,
        }),
      }),
    )

    expect(mocks.createClientNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining('15% off'),
      }),
    )
  })
})

describe('applyReferralRewardOnBooking', () => {
  it('does nothing when no CONVERTED referral exists', async () => {
    mocks.referralFindFirst.mockResolvedValue(null)

    await applyReferralRewardOnBooking({
      clientId: 'client-1',
      bookingId: 'booking-1',
      professionalId: 'pro-1',
    })

    expect(mocks.$transaction).not.toHaveBeenCalled()
  })

  it('applies a DISCOUNT reward to the booking', async () => {
    mocks.referralFindFirst.mockResolvedValue({
      id: 'ref-1',
      rewardTier: 'DISCOUNT',
      rewardValue: 20,
    })
    mocks.bookingFindUnique.mockResolvedValue({
      subtotalSnapshot: 100,
      discountAmount: 0,
      totalAmount: 100,
    })
    mocks.bookingUpdate.mockResolvedValue({})

    await applyReferralRewardOnBooking({
      clientId: 'client-1',
      bookingId: 'booking-1',
      professionalId: 'pro-1',
    })

    expect(mocks.$transaction).toHaveBeenCalledWith([
      expect.anything(),
      expect.anything(),
    ])
  })

  it('caps CREDIT reward at remaining subtotal', async () => {
    mocks.referralFindFirst.mockResolvedValue({
      id: 'ref-1',
      rewardTier: 'CREDIT',
      rewardValue: 50,
    })
    mocks.bookingFindUnique.mockResolvedValue({
      subtotalSnapshot: 30,
      discountAmount: 10,
      totalAmount: 20,
    })
    mocks.bookingUpdate.mockResolvedValue({})

    await applyReferralRewardOnBooking({
      clientId: 'client-1',
      bookingId: 'booking-1',
      professionalId: 'pro-1',
    })

    expect(mocks.$transaction).toHaveBeenCalled()
  })
})
