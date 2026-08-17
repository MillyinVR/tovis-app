// lib/credit/clientCredit.test.ts
//
// This is spendable money, so the cases that matter are the ones where the
// ledger would give a client something they did not earn, take something they
// did, or let one dollar be quoted onto two bills.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ClientCreditEntryKind,
  ClientCreditEntryStatus,
  Prisma,
} from '@prisma/client'

import {
  applyClientCreditForBooking,
  clientCreditSpendEnabled,
  CREATOR_CREDIT_RATE_PERCENT,
  creatorCreditCentsFor,
  findSpendableCheckoutBookingId,
  getClientCreditBalanceCents,
  getClientCreditSummary,
  getOfferableClientCreditBalanceCents,
  mintCreatorCreditOnCompletion,
  releaseClientCreditForBooking,
  reserveClientCreditForBooking,
} from './clientCredit'

const NOW = new Date('2026-08-17T12:00:00.000Z')

const money = (value: string) => new Prisma.Decimal(value)

/**
 * Pin ENABLE_CLIENT_CREDIT for a describe block, and put it back afterwards so
 * one block's rail state cannot leak into the next file's.
 */
function withCreditSpend(on: boolean) {
  let prior: string | undefined
  beforeEach(() => {
    prior = process.env.ENABLE_CLIENT_CREDIT
    if (on) process.env.ENABLE_CLIENT_CREDIT = '1'
    else delete process.env.ENABLE_CLIENT_CREDIT
  })
  afterEach(() => {
    if (prior === undefined) delete process.env.ENABLE_CLIENT_CREDIT
    else process.env.ENABLE_CLIENT_CREDIT = prior
  })
}

/** A ledger stand-in whose aggregate answers earned-then-spent, in call order. */
function ledgerWithBalance(earnedCents: number, spentCents: number) {
  return vi
    .fn()
    .mockResolvedValueOnce({ _sum: { amount: money((earnedCents / 100).toFixed(2)) } })
    .mockResolvedValueOnce({ _sum: { amount: money((spentCents / 100).toFixed(2)) } })
}

describe('creatorCreditCentsFor — Tori’s 3%', () => {
  it('is 3% of the service subtotal', () => {
    expect(CREATOR_CREDIT_RATE_PERCENT).toBe(3)
    // Her own worked example: a $250 booking mints $7.50.
    expect(creatorCreditCentsFor(25_000)).toBe(750)
  })

  it('rounds a fractional cent up, in the creator’s favour', () => {
    // 3% of $99.99 is $2.9997 — a third of a cent has to land somewhere, and
    // this is money the platform is giving away.
    expect(creatorCreditCentsFor(9_999)).toBe(300)
  })

  it('mints nothing from a bill with no services on it', () => {
    expect(creatorCreditCentsFor(0)).toBe(0)
    expect(creatorCreditCentsFor(-1)).toBe(0)
    expect(creatorCreditCentsFor(Number.NaN)).toBe(0)
    // 3% of 16 cents rounds to 0 — a zero-value ledger row is noise, not credit.
    expect(creatorCreditCentsFor(16)).toBe(0)
  })
})

describe('mintCreatorCreditOnCompletion — who earns, and who does not', () => {
  function tx(booking: unknown, created = { count: 1 }) {
    return {
      booking: { findUnique: vi.fn().mockResolvedValue(booking) },
      clientCreditEntry: { createMany: vi.fn().mockResolvedValue(created) },
    }
  }

  it('mints 3% of the service subtotal to the look’s author', async () => {
    const db = tx({
      id: 'b1',
      clientId: 'booker',
      serviceSubtotalSnapshot: money('250.00'),
      subtotalSnapshot: money('300.00'),
      sourceLookPostId: 'look-1',
      sourceLookPost: { clientAuthorId: 'creator' },
    })

    const result = await mintCreatorCreditOnCompletion(db as never, {
      bookingId: 'b1',
      now: NOW,
    })

    expect(result).toEqual({ mintedCents: 750, reason: 'MINTED' })
    const [args] = db.clientCreditEntry.createMany.mock.calls[0] as [
      { data: Array<Record<string, unknown>>; skipDuplicates: boolean },
    ]
    expect(args.data[0]).toMatchObject({
      clientId: 'creator',
      kind: ClientCreditEntryKind.EARNED_LOOK_BOOKING,
      status: ClientCreditEntryStatus.APPLIED,
      bookingId: 'b1',
      sourceLookPostId: 'look-1',
    })
    expect(String(args.data[0]?.amount)).toBe('7.5')
    // 🔴 The once-per-booking guarantee is the DATABASE's unique index, not a
    // read-then-write: this path runs from four call sites and would race itself.
    expect(args.skipDuplicates).toBe(true)
  })

  it('excludes products — it is the SERVICE subtotal', async () => {
    const db = tx({
      id: 'b1',
      clientId: 'booker',
      serviceSubtotalSnapshot: money('100.00'),
      subtotalSnapshot: money('500.00'), // service + a big product bill
      sourceLookPostId: 'look-1',
      sourceLookPost: { clientAuthorId: 'creator' },
    })

    expect(
      (await mintCreatorCreditOnCompletion(db as never, { bookingId: 'b1', now: NOW }))
        .mintedCents,
    ).toBe(300)
  })

  it('mints nothing when the creator booked their own look', async () => {
    const db = tx({
      id: 'b1',
      clientId: 'creator',
      serviceSubtotalSnapshot: money('250.00'),
      subtotalSnapshot: null,
      sourceLookPostId: 'look-1',
      sourceLookPost: { clientAuthorId: 'creator' },
    })

    expect(
      await mintCreatorCreditOnCompletion(db as never, { bookingId: 'b1', now: NOW }),
    ).toEqual({ mintedCents: 0, reason: 'SELF_BOOKING' })
    expect(db.clientCreditEntry.createMany).not.toHaveBeenCalled()
  })

  it('mints nothing for a booking made from a PRO-authored look', async () => {
    const db = tx({
      id: 'b1',
      clientId: 'booker',
      serviceSubtotalSnapshot: money('250.00'),
      subtotalSnapshot: null,
      sourceLookPostId: 'look-1',
      sourceLookPost: { clientAuthorId: null },
    })

    expect(
      (await mintCreatorCreditOnCompletion(db as never, { bookingId: 'b1', now: NOW }))
        .reason,
    ).toBe('NO_CREATOR')
  })

  it('mints nothing for a booking made from no look at all', async () => {
    const db = tx({
      id: 'b1',
      clientId: 'booker',
      serviceSubtotalSnapshot: money('250.00'),
      subtotalSnapshot: null,
      sourceLookPostId: null,
      sourceLookPost: null,
    })

    expect(
      (await mintCreatorCreditOnCompletion(db as never, { bookingId: 'b1', now: NOW }))
        .reason,
    ).toBe('NO_SOURCE_LOOK')
  })

  it('reports a second run as ALREADY_MINTED rather than minting again', async () => {
    const db = tx(
      {
        id: 'b1',
        clientId: 'booker',
        serviceSubtotalSnapshot: money('250.00'),
        subtotalSnapshot: null,
        sourceLookPostId: 'look-1',
        sourceLookPost: { clientAuthorId: 'creator' },
      },
      { count: 0 }, // the unique index refused the duplicate
    )

    expect(
      await mintCreatorCreditOnCompletion(db as never, { bookingId: 'b1', now: NOW }),
    ).toEqual({ mintedCents: 0, reason: 'ALREADY_MINTED' })
  })
})

describe('getClientCreditBalanceCents', () => {
  it('counts PENDING spends against the balance', async () => {
    const aggregate = ledgerWithBalance(3_000, 1_000)
    const balance = await getClientCreditBalanceCents(
      { clientCreditEntry: { aggregate } } as never,
      'c1',
    )

    expect(balance).toBe(2_000)
    // The spend side must count quoted-but-unpaid holds, or one dollar could be
    // quoted onto two bookings and both of them paid.
    const spentWhere = aggregate.mock.calls[1]?.[0] as { where: { status: unknown } }
    expect(spentWhere.where.status).toEqual({
      in: [ClientCreditEntryStatus.PENDING, ClientCreditEntryStatus.APPLIED],
    })
  })

  it('discounts the caller’s own reservation when asked', async () => {
    const aggregate = ledgerWithBalance(3_000, 0)
    await getClientCreditBalanceCents(
      { clientCreditEntry: { aggregate } } as never,
      'c1',
      { excludeBookingId: 'b1' },
    )

    const spentWhere = aggregate.mock.calls[1]?.[0] as {
      where: { bookingId?: unknown }
    }
    expect(spentWhere.where.bookingId).toEqual({ not: 'b1' })
  })

  it('floors at zero rather than rendering a negative balance', async () => {
    // Reachable only in the narrow window where a payment settles against a
    // reservation the sweep already released. Both rows are true; the READ is
    // what must not claim the client owes the platform money.
    const balance = await getClientCreditBalanceCents(
      { clientCreditEntry: { aggregate: ledgerWithBalance(1_000, 1_500) } } as never,
      'c1',
    )
    expect(balance).toBe(0)
  })
})

describe('reserveClientCreditForBooking', () => {
  // Every case in this block describes the rail OPEN. The master switch is
  // default-OFF (see the switch's own block below), so without this the whole
  // suite would pass by reserving nothing and prove none of it.
  withCreditSpend(true)

  function tx(args: {
    existing: unknown
    earnedCents: number
    spentCents: number
  }) {
    return {
      clientCreditEntry: {
        findUnique: vi.fn().mockResolvedValue(args.existing),
        aggregate: ledgerWithBalance(args.earnedCents, args.spentCents),
        create: vi.fn().mockResolvedValue({ id: 'e1' }),
        update: vi.fn().mockResolvedValue({ id: 'e1' }),
      },
    }
  }

  it('caps the reservation at what the bill can absorb', async () => {
    const db = tx({ existing: null, earnedCents: 3_000, spentCents: 0 })

    const reserved = await reserveClientCreditForBooking(db as never, {
      clientId: 'c1',
      bookingId: 'b1',
      maxApplicableCents: 1_200,
      now: NOW,
    })

    expect(reserved).toBe(1_200)
    expect(db.clientCreditEntry.create).toHaveBeenCalled()
  })

  it('caps the reservation at the balance', async () => {
    const db = tx({ existing: null, earnedCents: 500, spentCents: 0 })

    expect(
      await reserveClientCreditForBooking(db as never, {
        clientId: 'c1',
        bookingId: 'b1',
        maxApplicableCents: 25_000,
        now: NOW,
      }),
    ).toBe(500)
  })

  it('reserves nothing, and writes nothing, on an empty balance', async () => {
    const db = tx({ existing: null, earnedCents: 0, spentCents: 0 })

    expect(
      await reserveClientCreditForBooking(db as never, {
        clientId: 'c1',
        bookingId: 'b1',
        maxApplicableCents: 25_000,
        now: NOW,
      }),
    ).toBe(0)
    expect(db.clientCreditEntry.create).not.toHaveBeenCalled()
    expect(db.clientCreditEntry.update).not.toHaveBeenCalled()
  })

  it('releases a live hold when the bill can no longer absorb anything', async () => {
    const db = tx({
      existing: {
        id: 'e1',
        status: ClientCreditEntryStatus.PENDING,
        amount: money('10.00'),
      },
      earnedCents: 3_000,
      spentCents: 0,
    })

    expect(
      await reserveClientCreditForBooking(db as never, {
        clientId: 'c1',
        bookingId: 'b1',
        maxApplicableCents: 0,
        now: NOW,
      }),
    ).toBe(0)
    expect(db.clientCreditEntry.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: ClientCreditEntryStatus.RELEASED,
        }),
      }),
    )
  })

  it('🔴 never re-sizes a spend that already settled', async () => {
    const db = tx({
      existing: {
        id: 'e1',
        status: ClientCreditEntryStatus.APPLIED,
        amount: money('12.00'),
      },
      earnedCents: 0,
      spentCents: 0,
    })

    // That row is a payment that happened. Re-sizing it would rewrite history to
    // match a bill the client was never charged.
    expect(
      await reserveClientCreditForBooking(db as never, {
        clientId: 'c1',
        bookingId: 'b1',
        maxApplicableCents: 100,
        now: NOW,
      }),
    ).toBe(1_200)
    expect(db.clientCreditEntry.update).not.toHaveBeenCalled()
    expect(db.clientCreditEntry.create).not.toHaveBeenCalled()
  })

  it('restarts the hold’s clock when a checkout is re-quoted', async () => {
    const db = tx({
      existing: {
        id: 'e1',
        status: ClientCreditEntryStatus.PENDING,
        amount: money('5.00'),
      },
      earnedCents: 3_000,
      spentCents: 0,
    })

    await reserveClientCreditForBooking(db as never, {
      clientId: 'c1',
      bookingId: 'b1',
      maxApplicableCents: 2_000,
      now: NOW,
    })

    // The settlement sweep expires holds by age; a hold the client renewed
    // thirty seconds ago must not be handed back underneath them.
    expect(db.clientCreditEntry.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: ClientCreditEntryStatus.PENDING,
          createdAt: NOW,
        }),
      }),
    )
  })
})

describe('release / apply', () => {
  it('release only touches a PENDING hold', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 })
    await releaseClientCreditForBooking(
      { clientCreditEntry: { updateMany } } as never,
      { bookingId: 'b1', now: NOW },
    )

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        bookingId: 'b1',
        kind: ClientCreditEntryKind.SPENT_ON_BOOKING,
        status: ClientCreditEntryStatus.PENDING,
      },
      data: { status: ClientCreditEntryStatus.RELEASED, updatedAt: NOW },
    })
  })

  it('apply also promotes a RELEASED hold — the charge is a fact', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 })
    await applyClientCreditForBooking(
      { clientCreditEntry: { updateMany } } as never,
      { bookingId: 'b1', now: NOW },
    )

    // If the sweep handed a reservation back moments before a slow webhook
    // landed, the client was STILL charged the discounted bill.
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        bookingId: 'b1',
        kind: ClientCreditEntryKind.SPENT_ON_BOOKING,
        status: {
          in: [ClientCreditEntryStatus.PENDING, ClientCreditEntryStatus.RELEASED],
        },
      },
      data: { status: ClientCreditEntryStatus.APPLIED, updatedAt: NOW },
    })
  })
})

describe('getClientCreditSummary — the activity banner', () => {
  function db(balance: { earned: number; spent: number }, latest: unknown) {
    return {
      clientCreditEntry: {
        aggregate: ledgerWithBalance(balance.earned, balance.spent),
        findFirst: vi.fn().mockResolvedValue(latest),
      },
    }
  }

  it('renders nothing on a zero balance', async () => {
    // "$0.00 banked" under a currency glyph is a bright promise about nothing.
    expect(
      await getClientCreditSummary(db({ earned: 0, spent: 0 }, null) as never, 'c1'),
    ).toBeNull()
  })

  it('renders nothing once a balance has been fully spent', async () => {
    expect(
      await getClientCreditSummary(
        db({ earned: 1_000, spent: 1_000 }, null) as never,
        'c1',
      ),
    ).toBeNull()
  })

  it('names a publicly-addressable booker by handle', async () => {
    const summary = await getClientCreditSummary(
      db({ earned: 3_000, spent: 0 }, {
        amount: money('7.50'),
        createdAt: NOW,
        sourceLookPost: { caption: 'Lived-in blonde' },
        booking: { client: { handle: 'jade', isPublicProfile: true } },
      }) as never,
      'c1',
    )

    expect(summary?.balanceCents).toBe(3_000)
    expect(summary?.latestEarned).toEqual({
      amountCents: 750,
      lookName: 'Lived-in blonde',
      bookerHandle: 'jade',
      earnedAt: NOW,
    })
  })

  it('🔴 never names a private booker', async () => {
    const summary = await getClientCreditSummary(
      db({ earned: 3_000, spent: 0 }, {
        amount: money('7.50'),
        createdAt: NOW,
        sourceLookPost: { caption: 'Lived-in blonde' },
        booking: { client: { handle: 'jade', isPublicProfile: false } },
      }) as never,
      'c1',
    )

    // Same PII rule every activity row follows: named only when publicly
    // addressable, never by legal name.
    expect(summary?.latestEarned?.bookerHandle).toBeNull()
  })

  it('survives the look behind the credit being removed', async () => {
    const summary = await getClientCreditSummary(
      db({ earned: 3_000, spent: 0 }, {
        amount: money('7.50'),
        createdAt: NOW,
        sourceLookPost: null,
        booking: { client: { handle: null, isPublicProfile: true } },
      }) as never,
      'c1',
    )

    expect(summary?.latestEarned?.lookName).toBeNull()
    expect(summary?.latestEarned?.bookerHandle).toBeNull()
  })
})

// ── the master switch ────────────────────────────────────────────────────────
//
// The switch's job is asymmetric, and both halves matter: it must stop every
// route by which a client could SPEND, and must not touch money that has already
// been earned or already moved.

describe('clientCreditSpendEnabled — the parse', () => {
  withCreditSpend(false)

  it('is OFF when unset — the rail opens only by deliberate act', () => {
    expect(clientCreditSpendEnabled()).toBe(false)
  })

  it('is ON for the three affirmatives, whatever the casing or padding', () => {
    for (const value of ['1', 'true', 'yes', ' TRUE ', 'Yes']) {
      process.env.ENABLE_CLIENT_CREDIT = value
      expect(clientCreditSpendEnabled()).toBe(true)
    }
  })

  it('fails CLOSED on anything else, including a typo’d truthy value', () => {
    for (const value of ['', '  ', '0', 'false', 'no', 'ture', 'on', 'enabled']) {
      process.env.ENABLE_CLIENT_CREDIT = value
      expect(clientCreditSpendEnabled()).toBe(false)
    }
  })
})

describe('the switch OFF closes every route to a spend', () => {
  withCreditSpend(false)

  it('offers no balance — and does not even ask the ledger', async () => {
    const db = { clientCreditEntry: { aggregate: vi.fn() } }

    expect(
      await getOfferableClientCreditBalanceCents(db as never, 'c1'),
    ).toBe(0)
    expect(db.clientCreditEntry.aggregate).not.toHaveBeenCalled()
  })

  it('finds no spendable checkout, so the banner’s Use link cannot render', async () => {
    const db = { booking: { findFirst: vi.fn() } }

    expect(await findSpendableCheckoutBookingId(db as never, 'c1')).toBeNull()
    expect(db.booking.findFirst).not.toHaveBeenCalled()
  })

  it('reserves nothing even when the client has a balance and asked for it', async () => {
    const db = {
      clientCreditEntry: {
        findUnique: vi.fn().mockResolvedValue(null),
        aggregate: ledgerWithBalance(5_000, 0),
        create: vi.fn(),
        update: vi.fn(),
      },
    }

    expect(
      await reserveClientCreditForBooking(db as never, {
        clientId: 'c1',
        bookingId: 'b1',
        maxApplicableCents: 2_000,
        now: NOW,
      }),
    ).toBe(0)
    expect(db.clientCreditEntry.create).not.toHaveBeenCalled()
  })

  it('🔴 hands back a hold it had already taken, rather than stranding it', async () => {
    // The flip-off case. A client mid-checkout has balance reserved against
    // their bill; the switch closes. If this returned early instead of falling
    // through to the release, that money would sit PENDING — invisible to a
    // client who can no longer see the toggle — until the sweep's 72h TTL.
    const db = {
      clientCreditEntry: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'e1',
          status: ClientCreditEntryStatus.PENDING,
          amount: money('20.00'),
        }),
        aggregate: ledgerWithBalance(5_000, 2_000),
        create: vi.fn(),
        update: vi.fn().mockResolvedValue({ id: 'e1' }),
      },
    }

    expect(
      await reserveClientCreditForBooking(db as never, {
        clientId: 'c1',
        bookingId: 'b1',
        maxApplicableCents: 2_000,
        now: NOW,
      }),
    ).toBe(0)
    expect(db.clientCreditEntry.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: ClientCreditEntryStatus.RELEASED,
        }),
      }),
    )
  })
})

describe('the switch OFF leaves earned and settled money alone', () => {
  withCreditSpend(false)

  it('🔴 still MINTS — balances accrue honestly while the rail is shut', async () => {
    // Gating the earn path instead would silently under-credit every booking
    // that completed while the switch was off, with no record it happened.
    const db = {
      booking: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'b1',
          clientId: 'booker',
          serviceSubtotalSnapshot: money('250.00'),
          subtotalSnapshot: money('300.00'),
          sourceLookPostId: 'look-1',
          sourceLookPost: { clientAuthorId: 'creator' },
        }),
      },
      clientCreditEntry: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    }

    const result = await mintCreatorCreditOnCompletion(db as never, {
      bookingId: 'b1',
      now: NOW,
    })

    expect(result).toEqual({ mintedCents: 750, reason: 'MINTED' })
  })

  it('🔴 still reports the honest balance to the activity banner', async () => {
    // What a creator EARNED is theirs and is shown; only the invitation to
    // spend it goes away.
    const db = {
      clientCreditEntry: { aggregate: ledgerWithBalance(3_000, 0) },
    }

    expect(await getClientCreditBalanceCents(db as never, 'c1')).toBe(3_000)
  })

  it('🔴 still APPLIES a spend that already settled — the charge is a fact', async () => {
    const db = {
      clientCreditEntry: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    }

    expect(
      await applyClientCreditForBooking(db as never, {
        bookingId: 'b1',
        now: NOW,
      }),
    ).toBe(1)
  })
})
