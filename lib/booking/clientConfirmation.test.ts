// lib/booking/clientConfirmation.test.ts — K11 client-confirmation state.
//
// Pins the full timestamp→state matrix, the significance gate (NOT_REQUESTED
// renders nothing anywhere), the wire parser's non-throwing rules, and — the
// DoD's wording bar — that no attendance label reuses the word B10 gave to
// BookingStatus.ACCEPTED ("Confirmed").

import { describe, expect, it } from 'vitest'

import { BookingStatus } from '@prisma/client'

import {
  CLIENT_CONFIRMATION_SELECT,
  CLIENT_CONFIRMATION_STATES,
  deriveClientConfirmationBadge,
  deriveClientConfirmationState,
  parseClientConfirmationBadgeWire,
  type ClientConfirmationBookingRow,
} from './clientConfirmation'
import { BOOKING_STATUS_LABELS, labelForBookingStatus } from './statusLabel'

const T1 = new Date('2026-07-30T10:00:00.000Z')
const T2 = new Date('2026-07-30T11:00:00.000Z')

function row(
  overrides: Partial<ClientConfirmationBookingRow> = {},
): ClientConfirmationBookingRow {
  return {
    clientConfirmationRequestedAt: null,
    clientConfirmedAt: null,
    clientConfirmationDeclinedAt: null,
    ...overrides,
  }
}

describe('deriveClientConfirmationState', () => {
  it('all-null → NOT_REQUESTED (every booking until K12 ships writers)', () => {
    expect(deriveClientConfirmationState(row())).toBe('NOT_REQUESTED')
  })

  it('requested only → AWAITING_CLIENT', () => {
    expect(
      deriveClientConfirmationState(row({ clientConfirmationRequestedAt: T1 })),
    ).toBe('AWAITING_CLIENT')
  })

  it('confirmed → CLIENT_CONFIRMED (with or without a recorded request)', () => {
    expect(
      deriveClientConfirmationState(
        row({ clientConfirmationRequestedAt: T1, clientConfirmedAt: T2 }),
      ),
    ).toBe('CLIENT_CONFIRMED')
    // An answer with no recorded ask still shows the answer — hiding it would
    // be the lie, not the missing request.
    expect(
      deriveClientConfirmationState(row({ clientConfirmedAt: T1 })),
    ).toBe('CLIENT_CONFIRMED')
  })

  it('declined → DECLINED (with or without a recorded request)', () => {
    expect(
      deriveClientConfirmationState(
        row({
          clientConfirmationRequestedAt: T1,
          clientConfirmationDeclinedAt: T2,
        }),
      ),
    ).toBe('DECLINED')
    expect(
      deriveClientConfirmationState(row({ clientConfirmationDeclinedAt: T1 })),
    ).toBe('DECLINED')
  })

  it('both answers set → the LATEST wins; a tie breaks to confirmed', () => {
    expect(
      deriveClientConfirmationState(
        row({ clientConfirmedAt: T1, clientConfirmationDeclinedAt: T2 }),
      ),
    ).toBe('DECLINED')
    expect(
      deriveClientConfirmationState(
        row({ clientConfirmedAt: T2, clientConfirmationDeclinedAt: T1 }),
      ),
    ).toBe('CLIENT_CONFIRMED')
    expect(
      deriveClientConfirmationState(
        row({ clientConfirmedAt: T1, clientConfirmationDeclinedAt: T1 }),
      ),
    ).toBe('CLIENT_CONFIRMED')
  })
})

describe('deriveClientConfirmationBadge', () => {
  it('NOT_REQUESTED is the ONLY insignificant state — absence is the honest display', () => {
    expect(deriveClientConfirmationBadge(row())).toMatchObject({
      kind: 'NOT_REQUESTED',
      significant: false,
    })

    for (const kind of CLIENT_CONFIRMATION_STATES) {
      if (kind === 'NOT_REQUESTED') continue
      const badge = parseClientConfirmationBadgeWire({ kind })
      expect(badge?.significant).toBe(true)
    }
  })

  it('D3 words + tones per state', () => {
    expect(
      deriveClientConfirmationBadge(
        row({ clientConfirmationRequestedAt: T1 }),
      ),
    ).toEqual({
      kind: 'AWAITING_CLIENT',
      label: 'Awaiting client',
      description: 'Awaiting client confirmation',
      tone: 'pending',
      significant: true,
    })
    expect(
      deriveClientConfirmationBadge(row({ clientConfirmedAt: T1 })),
    ).toEqual({
      kind: 'CLIENT_CONFIRMED',
      label: 'Client confirmed',
      description: 'Client confirmed this appointment',
      tone: 'success',
      significant: true,
    })
    expect(
      deriveClientConfirmationBadge(row({ clientConfirmationDeclinedAt: T1 })),
    ).toEqual({
      kind: 'DECLINED',
      label: 'Declined',
      description: 'Client declined this appointment',
      tone: 'danger',
      significant: true,
    })
  })

  it('🔴 no attendance label is a bare booking-status label (B10 owns "Confirmed")', () => {
    // The DoD, as a pin rather than prose: ACCEPTED's canonical label —
    // and every other status label — must not collide with any attendance
    // label, or one word would mean two different facts on the same card.
    expect(labelForBookingStatus(BookingStatus.ACCEPTED)).toBe('Confirmed')

    const statusLabels = new Set(Object.values(BOOKING_STATUS_LABELS))
    for (const kind of CLIENT_CONFIRMATION_STATES) {
      const badge = parseClientConfirmationBadgeWire({ kind })
      expect(badge).not.toBeNull()
      expect(statusLabels.has(badge!.label)).toBe(false)
    }
  })
})

describe('CLIENT_CONFIRMATION_SELECT', () => {
  it('selects ONLY the three loop timestamps — never BookingStatus', () => {
    // Attendance and lifecycle are orthogonal facts; a select that grew a
    // dependency on `status` would let one leak into the other.
    expect(Object.keys(CLIENT_CONFIRMATION_SELECT).sort()).toEqual([
      'clientConfirmationDeclinedAt',
      'clientConfirmationRequestedAt',
      'clientConfirmedAt',
    ])
  })
})

describe('parseClientConfirmationBadgeWire', () => {
  it('reconstructs everything from kind — nothing trusted as sent', () => {
    const badge = parseClientConfirmationBadgeWire({
      kind: 'CLIENT_CONFIRMED',
      label: 'HACKED',
      description: 'HACKED',
      tone: 'danger',
      significant: false,
    })
    expect(badge).toEqual({
      kind: 'CLIENT_CONFIRMED',
      label: 'Client confirmed',
      description: 'Client confirmed this appointment',
      tone: 'success',
      significant: true,
    })
  })

  it('absent / malformed / unknown kind → null, never a made-up state', () => {
    expect(parseClientConfirmationBadgeWire(undefined)).toBeNull()
    expect(parseClientConfirmationBadgeWire(null)).toBeNull()
    expect(parseClientConfirmationBadgeWire('CLIENT_CONFIRMED')).toBeNull()
    expect(parseClientConfirmationBadgeWire({})).toBeNull()
    expect(parseClientConfirmationBadgeWire({ kind: 'MAYBE' })).toBeNull()
    expect(parseClientConfirmationBadgeWire({ kind: 42 })).toBeNull()
  })
})
