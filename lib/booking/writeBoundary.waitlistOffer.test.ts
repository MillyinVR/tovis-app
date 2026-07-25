// lib/booking/writeBoundary.waitlistOffer.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WaitlistOfferStatus, WaitlistStatus } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  withLockedProfessionalTransaction: vi.fn(),
  preWaitlistOfferFindUnique: vi.fn(),
  txWaitlistOfferFindUnique: vi.fn(),
  txWaitlistOfferUpdate: vi.fn(),
  txWaitlistEntryUpdateMany: vi.fn(),
  txBookingHoldDeleteMany: vi.fn(),
  bumpScheduleVersion: vi.fn(),
  preWaitlistEntryFindUnique: vi.fn(),
  txWaitlistEntryFindUnique: vi.fn(),
  txWaitlistEntryUpdate: vi.fn(),
  txWaitlistOfferFindMany: vi.fn(),
  txWaitlistOfferUpdateMany: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    waitlistOffer: { findUnique: mocks.preWaitlistOfferFindUnique },
    waitlistEntry: { findUnique: mocks.preWaitlistEntryFindUnique },
  },
}))

// Declining removes occupancy (F14: it releases the slot the offer reserved), so
// it runs under the professional's schedule lock like every other booking/hold
// transition rather than a bare $transaction.
vi.mock('@/lib/booking/scheduleTransaction', () => ({
  withLockedProfessionalTransaction: mocks.withLockedProfessionalTransaction,
  withLockedClientOwnedBookingTransaction: vi.fn(),
}))

vi.mock('@/lib/booking/cacheVersion', () => ({
  bumpScheduleVersion: mocks.bumpScheduleVersion,
  bumpScheduleConfigVersion: vi.fn(),
}))

import {
  cancelClientWaitlistEntry,
  declineClientWaitlistOffer,
} from './writeBoundary'
import { isBookingError } from './errors'

const tx = {
  waitlistOffer: {
    findUnique: mocks.txWaitlistOfferFindUnique,
    update: mocks.txWaitlistOfferUpdate,
    findMany: mocks.txWaitlistOfferFindMany,
    updateMany: mocks.txWaitlistOfferUpdateMany,
  },
  waitlistEntry: {
    updateMany: mocks.txWaitlistEntryUpdateMany,
    findUnique: mocks.txWaitlistEntryFindUnique,
    update: mocks.txWaitlistEntryUpdate,
  },
  bookingHold: {
    deleteMany: mocks.txBookingHoldDeleteMany,
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
    professionalId: 'pro_1',
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
    mocks.withLockedProfessionalTransaction.mockImplementation(
      async (
        _professionalId: string,
        run: (ctx: { tx: typeof tx; now: Date }) => Promise<unknown>,
      ) => run({ tx, now: new Date() }),
    )
    // Both reads serve the same row by default; a test that needs them to differ
    // overrides the locked one.
    mocks.preWaitlistOfferFindUnique.mockResolvedValue(makeOffer())
    mocks.txWaitlistOfferFindUnique.mockResolvedValue(makeOffer())
    mocks.txWaitlistOfferUpdate.mockResolvedValue({})
    mocks.txWaitlistEntryUpdateMany.mockResolvedValue({ count: 1 })
    mocks.txBookingHoldDeleteMany.mockResolvedValue({ count: 1 })
  })

  it('404s (no leak) when the offer is missing', async () => {
    mocks.preWaitlistOfferFindUnique.mockResolvedValueOnce(null)

    await expectBookingError(
      declineClientWaitlistOffer({ offerId: 'offer_1', clientId: 'client_1' }),
      'WAITLIST_OFFER_NOT_FOUND',
    )
    expect(mocks.txWaitlistOfferUpdate).not.toHaveBeenCalled()
    // Nothing is even locked for an offer that does not exist.
    expect(mocks.withLockedProfessionalTransaction).not.toHaveBeenCalled()
  })

  it('404s when the offer belongs to another client', async () => {
    mocks.preWaitlistOfferFindUnique.mockResolvedValueOnce(
      makeOffer({ clientId: 'other_client' }),
    )

    await expectBookingError(
      declineClientWaitlistOffer({ offerId: 'offer_1', clientId: 'client_1' }),
      'WAITLIST_OFFER_NOT_FOUND',
    )
  })

  // The pre-lock read only decides WHOSE schedule to lock; ownership and status
  // are re-checked under the lock, so a row that changed in between is refused.
  it('409s when the offer stopped being pending before the lock', async () => {
    mocks.txWaitlistOfferFindUnique.mockResolvedValueOnce(
      makeOffer({ status: WaitlistOfferStatus.ACCEPTED }),
    )

    await expectBookingError(
      declineClientWaitlistOffer({ offerId: 'offer_1', clientId: 'client_1' }),
      'WAITLIST_OFFER_NOT_PENDING',
    )
    expect(mocks.txWaitlistOfferUpdate).not.toHaveBeenCalled()
    // …and the slot it reserved is left alone: a non-pending offer is not this
    // call's to release.
    expect(mocks.txBookingHoldDeleteMany).not.toHaveBeenCalled()
  })

  it('declines the offer, releases its slot, and returns the entry to ACTIVE', async () => {
    const result = await declineClientWaitlistOffer({
      offerId: 'offer_1',
      clientId: 'client_1',
    })

    expect(result).toEqual({ ok: true })

    expect(mocks.txWaitlistOfferUpdate).toHaveBeenCalledWith({
      where: { id: 'offer_1' },
      data: expect.objectContaining({ status: WaitlistOfferStatus.DECLINED }),
    })

    // F14: the reservation goes back on the market with the offer.
    expect(mocks.txBookingHoldDeleteMany).toHaveBeenCalledWith({
      where: { waitlistOfferId: 'offer_1' },
    })

    // Only a still-NOTIFIED entry is flipped back to ACTIVE (never a BOOKED one).
    expect(mocks.txWaitlistEntryUpdateMany).toHaveBeenCalledWith({
      where: { id: 'entry_1', status: WaitlistStatus.NOTIFIED },
      data: { status: WaitlistStatus.ACTIVE },
    })

    // The freed slot has to reappear in cached availability.
    expect(mocks.bumpScheduleVersion).toHaveBeenCalledWith('pro_1')
  })
})

// B4 — leaving the waitlist is the one event that can orphan a reservation, so
// it withdraws the offer and hands the slot back in the same transaction.
describe('cancelClientWaitlistEntry', () => {
  const ENTRY = {
    id: 'entry_1',
    clientId: 'client_1',
    professionalId: 'pro_1',
    status: WaitlistStatus.NOTIFIED,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.withLockedProfessionalTransaction.mockImplementation(
      async (
        _professionalId: string,
        run: (ctx: { tx: typeof tx; now: Date }) => Promise<unknown>,
      ) => run({ tx, now: new Date() }),
    )
    mocks.preWaitlistEntryFindUnique.mockResolvedValue(ENTRY)
    mocks.txWaitlistEntryFindUnique.mockResolvedValue(ENTRY)
    mocks.txWaitlistEntryUpdate.mockResolvedValue({ id: 'entry_1' })
    // One live offer for the entry by default.
    mocks.txWaitlistOfferFindMany.mockResolvedValue([{ id: 'offer_1' }])
    mocks.txWaitlistOfferUpdateMany.mockResolvedValue({ count: 1 })
    mocks.txBookingHoldDeleteMany.mockResolvedValue({ count: 1 })
  })

  it('withdraws the live offer, releases its hold, and cancels the entry', async () => {
    const result = await cancelClientWaitlistEntry({
      entryId: 'entry_1',
      clientId: 'client_1',
    })

    expect(result).toEqual({ cancelled: true, releasedOffers: 1 })

    expect(mocks.txWaitlistOfferUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ['offer_1'] } },
      data: expect.objectContaining({ status: WaitlistOfferStatus.CANCELLED }),
    })
    expect(mocks.txBookingHoldDeleteMany).toHaveBeenCalledWith({
      where: { waitlistOfferId: { in: ['offer_1'] } },
    })
    expect(mocks.txWaitlistEntryUpdate).toHaveBeenCalledWith({
      where: { id: 'entry_1' },
      data: { status: WaitlistStatus.CANCELLED },
      select: { id: true },
    })

    // The freed slot has to reappear in cached availability — and the bump runs
    // AFTER the transaction, since Redis is not transactional (B2).
    expect(mocks.bumpScheduleVersion).toHaveBeenCalledWith('pro_1')
    const [bumpOrder] = mocks.bumpScheduleVersion.mock.invocationCallOrder
    const [updateOrder] = mocks.txWaitlistEntryUpdate.mock.invocationCallOrder
    if (bumpOrder === undefined || updateOrder === undefined) {
      throw new Error('expected both the entry update and the cache bump to run')
    }
    expect(bumpOrder).toBeGreaterThan(updateOrder)
  })

  // B2's own bug, one card later: "succeeded" is not "changed". An entry with no
  // live offer frees no time, so bumping there would evict the availability
  // cache on caller-controlled input.
  it('cancels an entry with no live offer WITHOUT bumping the cache', async () => {
    mocks.txWaitlistOfferFindMany.mockResolvedValueOnce([])

    const result = await cancelClientWaitlistEntry({
      entryId: 'entry_1',
      clientId: 'client_1',
    })

    expect(result).toEqual({ cancelled: true, releasedOffers: 0 })
    expect(mocks.txWaitlistEntryUpdate).toHaveBeenCalled()
    expect(mocks.txBookingHoldDeleteMany).not.toHaveBeenCalled()
    expect(mocks.bumpScheduleVersion).not.toHaveBeenCalled()
  })

  it('is idempotent on an already-cancelled entry, writing nothing', async () => {
    mocks.txWaitlistEntryFindUnique.mockResolvedValueOnce({
      ...ENTRY,
      status: WaitlistStatus.CANCELLED,
    })

    const result = await cancelClientWaitlistEntry({
      entryId: 'entry_1',
      clientId: 'client_1',
    })

    expect(result).toEqual({ cancelled: false, releasedOffers: 0 })
    expect(mocks.txWaitlistEntryUpdate).not.toHaveBeenCalled()
    expect(mocks.txWaitlistOfferUpdateMany).not.toHaveBeenCalled()
    expect(mocks.bumpScheduleVersion).not.toHaveBeenCalled()
  })

  // The status can change between the pre-lock read and the lock (the client
  // confirms an offer in another tab), which is why it is re-read inside.
  it('refuses an entry that became BOOKED before the lock, with its own code', async () => {
    mocks.txWaitlistEntryFindUnique.mockResolvedValueOnce({
      ...ENTRY,
      status: WaitlistStatus.BOOKED,
    })

    await expectBookingError(
      cancelClientWaitlistEntry({ entryId: 'entry_1', clientId: 'client_1' }),
      'WAITLIST_ENTRY_ALREADY_BOOKED',
    )
    expect(mocks.txWaitlistEntryUpdate).not.toHaveBeenCalled()
    expect(mocks.txBookingHoldDeleteMany).not.toHaveBeenCalled()
  })

  it('404s (no leak) for a missing or foreign entry, without locking', async () => {
    mocks.preWaitlistEntryFindUnique.mockResolvedValueOnce(null)
    await expectBookingError(
      cancelClientWaitlistEntry({ entryId: 'entry_1', clientId: 'client_1' }),
      'WAITLIST_ENTRY_NOT_FOUND',
    )

    mocks.preWaitlistEntryFindUnique.mockResolvedValueOnce({
      ...ENTRY,
      clientId: 'other_client',
    })
    await expectBookingError(
      cancelClientWaitlistEntry({ entryId: 'entry_1', clientId: 'client_1' }),
      'WAITLIST_ENTRY_NOT_FOUND',
    )

    expect(mocks.withLockedProfessionalTransaction).not.toHaveBeenCalled()
  })
})
