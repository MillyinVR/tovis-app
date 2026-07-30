import { describe, expect, it } from 'vitest'
import { BookingSource, ClientRelationshipLabel } from '@prisma/client'

import {
  CLIENT_RELATIONSHIP_LABELS,
  RELATIONSHIP_BADGE_SELECT,
  deriveClientRelationshipLabel,
  deriveRelationshipBadge,
  parseRelationshipBadgeWire,
} from '@/lib/booking/relationshipLabel'

describe('deriveClientRelationshipLabel (write-time)', () => {
  it('maps the full request×history matrix (D1: RNR is a real fourth cell)', () => {
    const cases: Array<{
      source: BookingSource
      establishedBookingCount: number
      expected: ClientRelationshipLabel
    }> = [
      { source: BookingSource.REQUESTED, establishedBookingCount: 0, expected: ClientRelationshipLabel.NR },
      { source: BookingSource.DISCOVERY, establishedBookingCount: 0, expected: ClientRelationshipLabel.NNR },
      { source: BookingSource.REQUESTED, establishedBookingCount: 3, expected: ClientRelationshipLabel.RR },
      { source: BookingSource.DISCOVERY, establishedBookingCount: 3, expected: ClientRelationshipLabel.RNR },
    ]

    for (const { source, establishedBookingCount, expected } of cases) {
      expect(
        deriveClientRelationshipLabel({
          source,
          establishedBookingCount,
          proCreated: false,
        }),
      ).toBe(expected)
    }
  })

  it('an aftercare rebook is RR regardless of the count passed', () => {
    // The finalize resolver short-circuits before counting for aftercare, so
    // the helper must not depend on the count there.
    expect(
      deriveClientRelationshipLabel({
        source: BookingSource.AFTERCARE,
        establishedBookingCount: 0,
        proCreated: false,
      }),
    ).toBe(ClientRelationshipLabel.RR)
  })

  it('never guesses: IMPORTED history is UNKNOWN, not NNR', () => {
    // The DoD case: a pro importing a book of loyal regulars must not open the
    // app to a wall of "non-request". BookingSource defaults to DISCOVERY, which
    // was never a signal for imported rows.
    expect(
      deriveClientRelationshipLabel({
        source: BookingSource.IMPORTED,
        establishedBookingCount: 0,
        proCreated: false,
      }),
    ).toBe(ClientRelationshipLabel.UNKNOWN)
  })

  it('never guesses: pro-created rows are UNKNOWN even though they carry source DISCOVERY', () => {
    expect(
      deriveClientRelationshipLabel({
        source: BookingSource.DISCOVERY,
        establishedBookingCount: 5,
        proCreated: true,
      }),
    ).toBe(ClientRelationshipLabel.UNKNOWN)
  })
})

describe('deriveRelationshipBadge (read-time)', () => {
  it('reads ONLY the snapshot column — the select is pinned to it', () => {
    // The snapshot rule made structural: if the badge ever grows a dependency
    // on live history (read-time derivation by the back door), this select has
    // to widen and this test fails.
    expect(Object.keys(RELATIONSHIP_BADGE_SELECT)).toEqual([
      'clientRelationshipLabel',
    ])
  })

  it('maps the stored value even when the pair history has since grown', () => {
    // A first booking stamped NR must still read NR after the client's second
    // and third bookings exist. Under read-time derivation the row would
    // reclassify as RR here — deriveRelationshipBadge cannot: its input type
    // carries no history at all.
    const badge = deriveRelationshipBadge({
      clientRelationshipLabel: ClientRelationshipLabel.NR,
    })

    expect(badge.kind).toBe(ClientRelationshipLabel.NR)
    expect(badge.label).toBe('NR')
    expect(badge.significant).toBe(true)
  })

  it('UNKNOWN alone is insignificant (no chip on unclassified history)', () => {
    for (const kind of CLIENT_RELATIONSHIP_LABELS) {
      expect(deriveRelationshipBadge({ clientRelationshipLabel: kind }).significant).toBe(
        kind !== ClientRelationshipLabel.UNKNOWN,
      )
    }
  })

  it('marks carry a plain-words description for tooltips/AT', () => {
    for (const kind of CLIENT_RELATIONSHIP_LABELS) {
      const badge = deriveRelationshipBadge({ clientRelationshipLabel: kind })
      expect(badge.description.length).toBeGreaterThan(0)
      expect(badge.label.length).toBeGreaterThan(0)
    }
  })
})

describe('parseRelationshipBadgeWire', () => {
  it('rebuilds the full badge from a bare known kind', () => {
    const parsed = parseRelationshipBadgeWire({ kind: 'RNR' })

    expect(parsed).toEqual(
      deriveRelationshipBadge({
        clientRelationshipLabel: ClientRelationshipLabel.RNR,
      }),
    )
  })

  it('ignores a wire payload trying to restyle a known kind', () => {
    // Presentation is reconstructed from the canonical table — a payload
    // cannot ship its own tone/label for a mark.
    const parsed = parseRelationshipBadgeWire({
      kind: 'RR',
      label: 'VIP',
      tone: 'danger',
      significant: false,
    })

    expect(parsed?.label).toBe('RR')
    expect(parsed?.tone).toBe('neutral')
    expect(parsed?.significant).toBe(true)
  })

  it('returns null for unknown kinds and malformed values', () => {
    expect(parseRelationshipBadgeWire({ kind: 'VIP' })).toBeNull()
    expect(parseRelationshipBadgeWire('NR')).toBeNull()
    expect(parseRelationshipBadgeWire(null)).toBeNull()
    expect(parseRelationshipBadgeWire(undefined)).toBeNull()
    expect(parseRelationshipBadgeWire({})).toBeNull()
  })
})
