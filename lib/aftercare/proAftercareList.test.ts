// lib/aftercare/proAftercareList.test.ts
import { describe, expect, it } from 'vitest'
import { AftercareRebookMode, BookingCheckoutStatus } from '@prisma/client'

import {
  compareProAftercareCards,
  countProAftercareCards,
  deriveProAftercareCard,
  proAftercareHref,
  sortProAftercareCards,
  summarizeProAftercareCards,
  type ProAftercareRowInput,
} from './proAftercareList'

// Fixed "now" so relative stamps + overdue comparisons are deterministic.
const NOW = new Date('2026-06-23T17:00:00Z').getTime()
const TZ = 'America/Los_Angeles'

function row(overrides: Partial<ProAftercareRowInput> = {}): ProAftercareRowInput {
  return {
    id: 'afc_1',
    bookingId: 'bk_1',
    createdAt: new Date('2026-06-10T12:00:00Z'),
    draftSavedAt: null,
    sentToClientAt: null,
    rebookMode: AftercareRebookMode.NONE,
    rebookedFor: null,
    rebookWindowStart: null,
    rebookWindowEnd: null,
    scheduledFor: new Date('2026-06-18T20:00:00Z'),
    serviceName: 'Cut & Tonal Gloss',
    clientName: 'Priya Anand',
    timeZone: TZ,
    checkoutStatus: BookingCheckoutStatus.NOT_READY,
    nextBooking: null,
    ...overrides,
  }
}

describe('deriveProAftercareCard', () => {
  it('marks a saved-but-unsent summary as a draft with a Send action', () => {
    const card = deriveProAftercareCard(
      row({ draftSavedAt: new Date('2026-06-21T17:00:00Z') }),
      { now: NOW },
    )
    expect(card.status).toBe('draft')
    expect(card.action).toBe('send')
    expect(card.needsAction).toBe(true)
    expect(card.ago).toEqual({ verb: 'saved', value: '2d' })
    expect(card.href).toBe(proAftercareHref('bk_1'))
    expect(card.initials).toBe('PA')
    expect(card.bookingDateLabel).toBe('Jun 18')
  })

  it('marks a sent summary with a future recommended window as sent + recommended', () => {
    const card = deriveProAftercareCard(
      row({
        sentToClientAt: new Date('2026-06-20T17:00:00Z'),
        rebookMode: AftercareRebookMode.RECOMMENDED_WINDOW,
        rebookWindowStart: new Date('2026-08-01T12:00:00Z'),
        rebookWindowEnd: new Date('2026-08-08T12:00:00Z'),
      }),
      { now: NOW },
    )
    expect(card.status).toBe('sent')
    expect(card.action).toBe('nudge')
    expect(card.rebook).toEqual({ kind: 'recommended', value: 'Aug 1–8' })
    expect(card.ago).toEqual({ verb: 'sent', value: '3d' })
  })

  it('flags a sent summary whose recommended window is in the past as overdue', () => {
    const card = deriveProAftercareCard(
      row({
        sentToClientAt: new Date('2026-06-05T17:00:00Z'),
        rebookMode: AftercareRebookMode.RECOMMENDED_WINDOW,
        rebookWindowStart: new Date('2026-06-06T12:00:00Z'),
        rebookWindowEnd: new Date('2026-06-13T12:00:00Z'),
      }),
      { now: NOW },
    )
    expect(card.status).toBe('sent')
    expect(card.rebook?.kind).toBe('overdue')
    expect(card.rebook?.value).toBe('Jun 6–13')
  })

  it('uses a cross-month window label when the window spans months', () => {
    const card = deriveProAftercareCard(
      row({
        sentToClientAt: new Date('2026-06-20T17:00:00Z'),
        rebookMode: AftercareRebookMode.RECOMMENDED_WINDOW,
        rebookWindowStart: new Date('2026-08-28T12:00:00Z'),
        rebookWindowEnd: new Date('2026-09-03T12:00:00Z'),
      }),
      { now: NOW },
    )
    expect(card.rebook?.value).toBe('Aug 28 – Sep 3')
  })

  it('closes the loop as finished with a Next booking chip when a next booking is confirmed', () => {
    const card = deriveProAftercareCard(
      row({
        sentToClientAt: new Date('2026-06-15T17:00:00Z'),
        // Rebooking is gated on resolved payment, so a confirmed next booking
        // always coincides with a paid/waived checkout.
        checkoutStatus: BookingCheckoutStatus.PAID,
        rebookMode: AftercareRebookMode.BOOKED_NEXT_APPOINTMENT,
        rebookedFor: new Date('2026-08-12T18:00:00Z'),
        nextBooking: {
          scheduledFor: new Date('2026-08-12T18:00:00Z'),
          bookedAt: new Date('2026-06-22T17:00:00Z'),
        },
      }),
      { now: NOW },
    )
    expect(card.status).toBe('finished')
    expect(card.action).toBeNull()
    expect(card.needsAction).toBe(false)
    expect(card.rebook).toEqual({ kind: 'next', value: 'Aug 12' })
    expect(card.ago).toEqual({ verb: 'booked', value: '1d' })
  })

  it('marks a sent + paid summary as finished but keeps a rebook nudge when not yet rebooked', () => {
    const card = deriveProAftercareCard(
      row({
        sentToClientAt: new Date('2026-06-20T17:00:00Z'),
        checkoutStatus: BookingCheckoutStatus.PAID,
        rebookMode: AftercareRebookMode.RECOMMENDED_WINDOW,
        rebookWindowStart: new Date('2026-08-01T12:00:00Z'),
        rebookWindowEnd: new Date('2026-08-08T12:00:00Z'),
      }),
      { now: NOW },
    )
    expect(card.status).toBe('finished')
    // Loop is still open — payment is done but the client hasn't rebooked.
    expect(card.action).toBe('nudge')
    expect(card.needsAction).toBe(true)
    expect(card.rebook).toEqual({ kind: 'recommended', value: 'Aug 1–8' })
    // No confirmed booking yet, so the stamp reflects the send, not a "booked".
    expect(card.ago).toEqual({ verb: 'sent', value: '3d' })
  })

  it('treats a waived checkout the same as paid — finished', () => {
    const card = deriveProAftercareCard(
      row({
        sentToClientAt: new Date('2026-06-20T17:00:00Z'),
        checkoutStatus: BookingCheckoutStatus.WAIVED,
      }),
      { now: NOW },
    )
    expect(card.status).toBe('finished')
    expect(card.action).toBe('nudge')
  })

  it('keeps a sent summary as sent (not finished) while payment is still pending', () => {
    for (const checkoutStatus of [
      BookingCheckoutStatus.NOT_READY,
      BookingCheckoutStatus.READY,
      BookingCheckoutStatus.PARTIALLY_PAID,
    ]) {
      const card = deriveProAftercareCard(
        row({ sentToClientAt: new Date('2026-06-20T17:00:00Z'), checkoutStatus }),
        { now: NOW },
      )
      expect(card.status).toBe('sent')
      expect(card.action).toBe('nudge')
    }
  })

  it('keeps a paid-but-unsent summary as a draft — sending is still required', () => {
    const card = deriveProAftercareCard(
      row({
        draftSavedAt: new Date('2026-06-21T17:00:00Z'),
        checkoutStatus: BookingCheckoutStatus.PAID,
      }),
      { now: NOW },
    )
    expect(card.status).toBe('draft')
    expect(card.action).toBe('send')
  })

  it('shows no rebook chip when the mode is NONE', () => {
    const card = deriveProAftercareCard(
      row({ sentToClientAt: new Date('2026-06-20T17:00:00Z') }),
      { now: NOW },
    )
    expect(card.rebook).toBeNull()
  })
})

describe('counts + summary', () => {
  const cards = [
    deriveProAftercareCard(row({ id: 'd', draftSavedAt: new Date('2026-06-21T17:00:00Z') }), {
      now: NOW,
    }),
    deriveProAftercareCard(
      row({
        id: 's',
        sentToClientAt: new Date('2026-06-20T17:00:00Z'),
        rebookMode: AftercareRebookMode.RECOMMENDED_WINDOW,
        rebookWindowStart: new Date('2026-08-01T12:00:00Z'),
        rebookWindowEnd: new Date('2026-08-08T12:00:00Z'),
      }),
      { now: NOW },
    ),
    deriveProAftercareCard(
      row({
        id: 'o',
        sentToClientAt: new Date('2026-06-05T17:00:00Z'),
        rebookMode: AftercareRebookMode.RECOMMENDED_WINDOW,
        rebookWindowStart: new Date('2026-06-06T12:00:00Z'),
        rebookWindowEnd: new Date('2026-06-13T12:00:00Z'),
      }),
      { now: NOW },
    ),
    deriveProAftercareCard(
      row({
        id: 'f',
        sentToClientAt: new Date('2026-06-15T17:00:00Z'),
        checkoutStatus: BookingCheckoutStatus.PAID,
        nextBooking: {
          scheduledFor: new Date('2026-08-12T18:00:00Z'),
          bookedAt: new Date('2026-06-22T17:00:00Z'),
        },
      }),
      { now: NOW },
    ),
  ]

  it('counts each status bucket', () => {
    expect(countProAftercareCards(cards)).toEqual({ all: 4, draft: 1, sent: 2, finished: 1 })
  })

  it('summarizes drafts / awaiting / overdue', () => {
    expect(summarizeProAftercareCards(cards)).toEqual({
      drafts: 1,
      awaiting: 2,
      overdue: 1,
      hasOverdue: true,
    })
  })

  it('orders needs-action: drafts, then overdue, then awaiting, then finished', () => {
    const ordered = sortProAftercareCards(cards, 'needs').map((c) => c.id)
    expect(ordered).toEqual(['d', 'o', 's', 'f'])
  })

  it('orders recent purely by latest activity', () => {
    const ordered = sortProAftercareCards(cards, 'recent').map((c) => c.id)
    // draft saved 6-21, finished booked 6-22, sent 6-20, overdue sent 6-05
    expect(ordered).toEqual(['f', 'd', 's', 'o'])
  })

  it('compareProAftercareCards is a stable pairwise comparator', () => {
    const draft = cards.find((c) => c.id === 'd')
    const finished = cards.find((c) => c.id === 'f')
    if (!draft || !finished) throw new Error('fixture missing draft/finished card')
    expect(compareProAftercareCards(draft, finished, 'needs')).toBeLessThan(0)
    expect(compareProAftercareCards(finished, draft, 'needs')).toBeGreaterThan(0)
  })
})
