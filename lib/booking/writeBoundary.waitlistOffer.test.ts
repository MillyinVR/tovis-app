// lib/booking/writeBoundary.waitlistOffer.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WaitlistOfferStatus, WaitlistStatus } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  prismaTransaction: vi.fn(),
  txWaitlistOfferFindUnique: vi.fn(),
  txWaitlistOfferUpdate: vi.fn(),
  txWaitlistEntryUpdateMany: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: mocks.prismaTransaction,
  },
}))

import { declineClientWaitlistOffer } from './writeBoundary'
import { isBookingError } from './errors'

const tx = {
  waitlistOffer: {
    findUnique: mocks.txWaitlistOfferFindUnique,
    update: mocks.txWaitlistOfferUpdate,
  },
  waitlistEntry: {
    updateMany: mocks.txWaitlistEntryUpdateMany,
  },
}

function makeOffer(
  overrides?: Partial<{
    id: string
    status: WaitlistOfferStatus
    clientId: string
    waitlistEntryId: string
  }>,
) {
  return {
    id: overrides?.id ?? 'offer_1',
    status: overrides?.status ?? WaitlistOfferStatus.PENDING,
    clientId: overrides?.clientId ?? 'client_1',
    waitlistEntryId: overrides?.waitlistEntryId ?? 'entry_1',
  }
}

async function expectBookingError(
  promise: Promise<unknown>,
  code: string,
): Promise<void> {
  await promise.then(
    () => {
      throw new Error(`expected bookingError ${code} but resolved`)
    },
    (error: unknown) => {
      expect(isBookingError(error)).toBe(true)
      if (isBookingError(error)) expect(error.code).toBe(code)
    },
  )
}

describe('declineClientWaitlistOffer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.prismaTransaction.mockImplementation(
      async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
    )
    mocks.txWaitlistOfferUpdate.mockResolvedValue({})
    mocks.txWaitlistEntryUpdateMany.mockResolvedValue({ count: 1 })
  })

  it('404s (no leak) when the offer is missing', async () => {
    mocks.txWaitlistOfferFindUnique.mockResolvedValueOnce(null)

    await expectBookingError(
      declineClientWaitlistOffer({ offerId: 'offer_1', clientId: 'client_1' }),
      'WAITLIST_OFFER_NOT_FOUND',
    )
    expect(mocks.txWaitlistOfferUpdate).not.toHaveBeenCalled()
  })

  it('404s when the offer belongs to another client', async () => {
    mocks.txWaitlistOfferFindUnique.mockResolvedValueOnce(
      makeOffer({ clientId: 'other_client' }),
    )

    await expectBookingError(
      declineClientWaitlistOffer({ offerId: 'offer_1', clientId: 'client_1' }),
      'WAITLIST_OFFER_NOT_FOUND',
    )
  })

  it('409s when the offer is not pending', async () => {
    mocks.txWaitlistOfferFindUnique.mockResolvedValueOnce(
      makeOffer({ status: WaitlistOfferStatus.ACCEPTED }),
    )

    await expectBookingError(
      declineClientWaitlistOffer({ offerId: 'offer_1', clientId: 'client_1' }),
      'WAITLIST_OFFER_NOT_PENDING',
    )
    expect(mocks.txWaitlistOfferUpdate).not.toHaveBeenCalled()
  })

  it('declines the offer and returns the entry to ACTIVE', async () => {
    mocks.txWaitlistOfferFindUnique.mockResolvedValueOnce(makeOffer())

    const result = await declineClientWaitlistOffer({
      offerId: 'offer_1',
      clientId: 'client_1',
    })

    expect(result).toEqual({ ok: true })

    expect(mocks.txWaitlistOfferUpdate).toHaveBeenCalledWith({
      where: { id: 'offer_1' },
      data: expect.objectContaining({ status: WaitlistOfferStatus.DECLINED }),
    })

    // Only a still-NOTIFIED entry is flipped back to ACTIVE (never a BOOKED one).
    expect(mocks.txWaitlistEntryUpdateMany).toHaveBeenCalledWith({
      where: { id: 'entry_1', status: WaitlistStatus.NOTIFIED },
      data: { status: WaitlistStatus.ACTIVE },
    })
  })
})
