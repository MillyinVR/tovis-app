// lib/booking/writeBoundary.waitlistOffer.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  NotificationEventKey,
  WaitlistOfferStatus,
  WaitlistStatus,
} from '@prisma/client'

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
  txClientProfileFindUnique: vi.fn(),
  createProNotification: vi.fn(),
  prismaWaitlistOfferFindMany: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    waitlistOffer: {
      findUnique: mocks.preWaitlistOfferFindUnique,
      findMany: mocks.prismaWaitlistOfferFindMany,
    },
    waitlistEntry: { findUnique: mocks.preWaitlistEntryFindUnique },
  },
}))

vi.mock('@/lib/notifications/proNotifications', () => ({
  createProNotification: mocks.createProNotification,
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
  expireLapsedWaitlistOffers,
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
  clientProfile: {
    findUnique: mocks.txClientProfileFindUnique,
  },
}

const NOW = new Date('2026-03-04T18:00:00.000Z')

/**
 * A released/candidate offer row, in the shape
 * `RELEASED_WAITLIST_OFFER_SELECT` returns. `expiresAt` defaults to the FUTURE:
 * the tests that matter here turn on live-vs-lapsed, so the default must be one
 * of them rather than a null that quietly satisfies neither reading.
 */
function makeReleasedOffer(overrides?: {
  id?: string
  expiresAt?: Date | null
  startsAt?: Date
}) {
  return {
    id: overrides?.id ?? 'offer_1',
    startsAt: overrides?.startsAt ?? new Date('2026-03-05T21:00:00.000Z'),
    expiresAt:
      overrides?.expiresAt === undefined
        ? new Date('2026-03-05T19:00:00.000Z')
        : overrides.expiresAt,
    location: { timeZone: 'America/Los_Angeles' },
    professional: { timeZone: 'America/Los_Angeles' },
  }
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
    // Fixed clock: live-vs-lapsed is the whole subject below, so `now` cannot be
    // the wall clock.
    mocks.withLockedProfessionalTransaction.mockImplementation(
      async (
        _professionalId: string,
        run: (ctx: { tx: typeof tx; now: Date }) => Promise<unknown>,
      ) => run({ tx, now: NOW }),
    )
    mocks.txWaitlistEntryUpdate.mockResolvedValue({ id: 'entry_1' })
    // One live offer for the entry by default.
    mocks.txWaitlistOfferFindMany.mockResolvedValue([makeReleasedOffer()])
    mocks.txWaitlistOfferUpdateMany.mockResolvedValue({ count: 1 })
    mocks.txBookingHoldDeleteMany.mockResolvedValue({ count: 1 })
    mocks.txClientProfileFindUnique.mockResolvedValue({
      firstName: 'Maya',
      lastName: 'Okonkwo',
    })
    mocks.createProNotification.mockResolvedValue({ id: 'notif_1' })
  })

  it('withdraws the live offer, releases its hold, and cancels the entry', async () => {
    const result = await cancelClientWaitlistEntry({
      entryId: 'entry_1',
      clientId: 'client_1',
    })

    expect(result).toEqual({
      cancelled: true,
      releasedOffers: 1,
      notifiedProfessional: true,
    })

    expect(mocks.txWaitlistOfferUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ['offer_1'] } },
      data: expect.objectContaining({ status: WaitlistOfferStatus.CANCELLED }),
    })

    // The pro's slot just came back. They are the only person who can re-offer
    // it, so they are told — in the same transaction as the withdrawal.
    expect(mocks.createProNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        tx,
        professionalId: 'pro_1',
        eventKey: NotificationEventKey.WAITLIST_CLIENT_LEFT,
        title: 'Maya Okonkwo left your waitlist',
        dedupeKey: 'WAITLIST_CLIENT_LEFT:entry_1',
      }),
    )
    // The copy names the concrete slot, in the LOCATION's zone (21:00Z on
    // 2026-03-05 is 1:00 PM in Los Angeles) — not the server's.
    const [notifyArgs] = mocks.createProNotification.mock.calls[0] ?? []
    expect(notifyArgs?.body).toBe(
      'Your Thu, Mar 5 at 1:00 PM slot is free to re-offer.',
    )
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

    expect(result).toEqual({
      cancelled: true,
      releasedOffers: 0,
      notifiedProfessional: false,
    })
    expect(mocks.txWaitlistEntryUpdate).toHaveBeenCalled()
    expect(mocks.txBookingHoldDeleteMany).not.toHaveBeenCalled()
    expect(mocks.bumpScheduleVersion).not.toHaveBeenCalled()
  })

  // The OTHER direction of the same decision, and the one a "notify on leave"
  // implementation gets wrong: leaving a waitlist you were never offered a time
  // on is SILENT. Tori's explicit call — the pro lost nothing and is being asked
  // nothing, so a notification would be pure noise.
  it('stays completely silent when the client leaves with NO offer pending', async () => {
    mocks.txWaitlistOfferFindMany.mockResolvedValueOnce([])

    await cancelClientWaitlistEntry({ entryId: 'entry_1', clientId: 'client_1' })

    expect(mocks.createProNotification).not.toHaveBeenCalled()
    // And it does not even read the client's name — there is no copy to build.
    expect(mocks.txClientProfileFindUnique).not.toHaveBeenCalled()
  })

  // An entry can be NOTIFIED with a PENDING offer that already timed out: the
  // hourly sweep has not reached it yet. Withdrawing it is still right (it is
  // PENDING), but it stopped being a promise when its countdown ran out, and the
  // expiry sweep owns telling that story. Notifying here too would report one
  // freed slot twice.
  it('withdraws an already-LAPSED pending offer but does NOT notify the pro', async () => {
    mocks.txWaitlistOfferFindMany.mockResolvedValueOnce([
      makeReleasedOffer({ expiresAt: new Date(NOW.getTime() - 60_000) }),
    ])

    const result = await cancelClientWaitlistEntry({
      entryId: 'entry_1',
      clientId: 'client_1',
    })

    // Still withdrawn, and its slot still handed back…
    expect(result).toEqual({
      cancelled: true,
      releasedOffers: 1,
      notifiedProfessional: false,
    })
    expect(mocks.txBookingHoldDeleteMany).toHaveBeenCalled()
    expect(mocks.bumpScheduleVersion).toHaveBeenCalledWith('pro_1')
    // …but no second telling.
    expect(mocks.createProNotification).not.toHaveBeenCalled()
  })

  // A legacy offer (written before F14) carries no expiry and never lapses, so
  // it is live and the pro IS told. This is the null case the two obvious
  // spellings of "expired" disagree on.
  it('treats an offer with a null expiresAt as live and notifies', async () => {
    mocks.txWaitlistOfferFindMany.mockResolvedValueOnce([
      makeReleasedOffer({ expiresAt: null }),
    ])

    const result = await cancelClientWaitlistEntry({
      entryId: 'entry_1',
      clientId: 'client_1',
    })

    expect(result.notifiedProfessional).toBe(true)
    expect(mocks.createProNotification).toHaveBeenCalledTimes(1)
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

    expect(result).toEqual({
      cancelled: false,
      releasedOffers: 0,
      notifiedProfessional: false,
    })
    expect(mocks.txWaitlistEntryUpdate).not.toHaveBeenCalled()
    expect(mocks.txWaitlistOfferUpdateMany).not.toHaveBeenCalled()
    expect(mocks.bumpScheduleVersion).not.toHaveBeenCalled()
    expect(mocks.createProNotification).not.toHaveBeenCalled()
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

// Nothing in the codebase ever wrote WaitlistOfferStatus.EXPIRED. The offer's
// countdown was enforced only defensively at confirm time, so a lapsed offer sat
// PENDING forever and — the part that actually hurt — its entry sat NOTIFIED
// forever, silently un-offerable.
describe('expireLapsedWaitlistOffers', () => {
  function makeCandidate(overrides?: {
    id?: string
    professionalId?: string
    waitlistEntryId?: string
    expiresAt?: Date | null
  }) {
    return {
      ...makeReleasedOffer({
        id: overrides?.id,
        expiresAt:
          overrides?.expiresAt === undefined
            ? new Date(NOW.getTime() - 60_000)
            : overrides.expiresAt,
      }),
      professionalId: overrides?.professionalId ?? 'pro_1',
      clientId: 'client_1',
      waitlistEntryId: overrides?.waitlistEntryId ?? 'entry_1',
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.withLockedProfessionalTransaction.mockImplementation(
      async (
        _professionalId: string,
        run: (ctx: { tx: typeof tx; now: Date }) => Promise<unknown>,
      ) => run({ tx, now: NOW }),
    )
    mocks.prismaWaitlistOfferFindMany.mockResolvedValue([makeCandidate()])
    // The claim succeeds by default; the race tests override it.
    mocks.txWaitlistOfferUpdateMany.mockResolvedValue({ count: 1 })
    mocks.txWaitlistEntryUpdateMany.mockResolvedValue({ count: 1 })
    mocks.txBookingHoldDeleteMany.mockResolvedValue({ count: 1 })
    mocks.txClientProfileFindUnique.mockResolvedValue({
      firstName: 'Maya',
      lastName: 'Okonkwo',
    })
    mocks.createProNotification.mockResolvedValue({ id: 'notif_1' })
  })

  // THE load-bearing assertion: an expired offer revives its entry.
  it('expires a lapsed offer, releases its hold, and revives the entry to ACTIVE', async () => {
    const result = await expireLapsedWaitlistOffers({ now: NOW })

    expect(result).toEqual({
      considered: 1,
      expired: 1,
      revivedEntries: 1,
      skipped: 0,
      failed: 0,
    })

    expect(mocks.txWaitlistOfferUpdateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'offer_1',
        status: WaitlistOfferStatus.PENDING,
      }),
      data: { status: WaitlistOfferStatus.EXPIRED, respondedAt: NOW },
    })

    // F14: the offer is over, so its reservation cannot outlive it.
    expect(mocks.txBookingHoldDeleteMany).toHaveBeenCalledWith({
      where: { waitlistOfferId: 'offer_1' },
    })

    // The client goes back on the pro's list — and ONLY from NOTIFIED, so an
    // entry that was rebooked or abandoned in the meantime is never dragged back.
    expect(mocks.txWaitlistEntryUpdateMany).toHaveBeenCalledWith({
      where: { id: 'entry_1', status: WaitlistStatus.NOTIFIED },
      data: { status: WaitlistStatus.ACTIVE },
    })

    expect(mocks.bumpScheduleVersion).toHaveBeenCalledWith('pro_1')
  })

  // The other half of the same assertion, and the one that would fail loudly if
  // the query used `expiresAt <= now` without excluding nulls or dropped the
  // status filter: a FRESH offer must not be touched.
  it('never claims a fresh offer — the query asks only for lapsed PENDING rows', async () => {
    const result = await expireLapsedWaitlistOffers({ now: NOW })

    const [findArgs] = mocks.prismaWaitlistOfferFindMany.mock.calls[0] ?? []
    expect(findArgs?.where).toEqual({
      status: WaitlistOfferStatus.PENDING,
      expiresAt: { not: null, lte: NOW },
    })
    expect(result.expired).toBe(1)
  })

  // A fresh offer that somehow reached the claim (the query returned it, then it
  // was re-offered) is refused BY THE CLAIM, not by the loop: the updateMany
  // carries the full predicate, so a count of 0 is the row saying "not yours".
  it('skips — and writes nothing — when the claim matches no row', async () => {
    mocks.txWaitlistOfferUpdateMany.mockResolvedValueOnce({ count: 0 })

    const result = await expireLapsedWaitlistOffers({ now: NOW })

    expect(result).toEqual({
      considered: 1,
      expired: 0,
      revivedEntries: 0,
      skipped: 1,
      failed: 0,
    })
    expect(mocks.txBookingHoldDeleteMany).not.toHaveBeenCalled()
    expect(mocks.txWaitlistEntryUpdateMany).not.toHaveBeenCalled()
    expect(mocks.createProNotification).not.toHaveBeenCalled()
    // Nothing changed, so nothing may evict the availability cache.
    expect(mocks.bumpScheduleVersion).not.toHaveBeenCalled()
  })

  it('tells the pro why the client is back, quietly and per-offer', async () => {
    await expireLapsedWaitlistOffers({ now: NOW })

    expect(mocks.createProNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        tx,
        professionalId: 'pro_1',
        eventKey: NotificationEventKey.WAITLIST_OFFER_EXPIRED,
        title: 'Maya Okonkwo didn’t respond',
        dedupeKey: 'WAITLIST_OFFER_EXPIRED:offer_1',
      }),
    )
    const [notifyArgs] = mocks.createProNotification.mock.calls[0] ?? []
    expect(notifyArgs?.body).toBe(
      'Your Thu, Mar 5 at 1:00 PM offer expired — they’re back on your list.',
    )
  })

  // An entry that moved on (BOOKED elsewhere, or the client left) is guarded by
  // the updateMany's status filter, so the offer still expires but no entry is
  // revived — and the two counters say so separately.
  it('expires the offer without reviving an entry that is no longer NOTIFIED', async () => {
    mocks.txWaitlistEntryUpdateMany.mockResolvedValueOnce({ count: 0 })

    const result = await expireLapsedWaitlistOffers({ now: NOW })

    expect(result.expired).toBe(1)
    expect(result.revivedEntries).toBe(0)
  })

  // [[continue-after-a-refusal-needs-its-own-transaction]] — one bad row must
  // not take the batch with it, which is only true because each row gets its own
  // locked transaction.
  it('carries on after a failing offer and counts it', async () => {
    mocks.prismaWaitlistOfferFindMany.mockResolvedValueOnce([
      makeCandidate({ id: 'offer_bad', waitlistEntryId: 'entry_bad' }),
      makeCandidate({ id: 'offer_good', waitlistEntryId: 'entry_good' }),
    ])
    mocks.withLockedProfessionalTransaction.mockImplementationOnce(async () => {
      throw new Error('deadlock detected')
    })

    const result = await expireLapsedWaitlistOffers({ now: NOW })

    expect(result).toEqual({
      considered: 2,
      expired: 1,
      revivedEntries: 1,
      skipped: 0,
      failed: 1,
    })
    // The survivor is the SECOND row, so the loop really did continue.
    expect(mocks.txWaitlistOfferUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'offer_good' }),
      }),
    )
  })

  it('reports an empty sweep as zeroes rather than touching anything', async () => {
    mocks.prismaWaitlistOfferFindMany.mockResolvedValueOnce([])

    const result = await expireLapsedWaitlistOffers({ now: NOW })

    expect(result).toEqual({
      considered: 0,
      expired: 0,
      revivedEntries: 0,
      skipped: 0,
      failed: 0,
    })
    expect(mocks.withLockedProfessionalTransaction).not.toHaveBeenCalled()
  })

  // A batch cap the caller cannot blow past: a wedged backlog must not turn one
  // cron tick into an unbounded job.
  it('clamps the batch size and takes the longest-stranded offers first', async () => {
    await expireLapsedWaitlistOffers({ now: NOW, limit: 100_000 })

    const [findArgs] = mocks.prismaWaitlistOfferFindMany.mock.calls[0] ?? []
    expect(findArgs?.take).toBe(1000)
    expect(findArgs?.orderBy).toEqual({ expiresAt: 'asc' })
  })
})
