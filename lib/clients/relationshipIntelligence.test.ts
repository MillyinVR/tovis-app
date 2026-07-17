// lib/clients/relationshipIntelligence.test.ts
import { describe, expect, it } from 'vitest'

import {
  computeRelationshipIntelligence,
  daysLeftInWindow,
  formatCadence,
  formatRelationshipIntelligence,
  type IntelBooking,
  type RelationshipIntelligenceInput,
} from './relationshipIntelligence'

const DAY_MS = 24 * 60 * 60 * 1000
// Local-component construction so weekday/birthday math (which reads local date
// parts) is independent of the runner's timezone.
const NOW = new Date(2026, 5, 21, 18, 0, 0) // Sun Jun 21 2026, 18:00 local

function daysAgo(n: number): Date {
  return new Date(NOW.getTime() - n * DAY_MS)
}

function booking(overrides: Partial<IntelBooking>): IntelBooking {
  return {
    status: 'COMPLETED',
    scheduledFor: daysAgo(0),
    createdAt: daysAgo(0),
    finishedAt: null,
    professionalId: 'pro1',
    amount: 100,
    timeZone: 'UTC',
    ...overrides,
  }
}

function input(
  bookings: IntelBooking[],
  overrides: Partial<RelationshipIntelligenceInput> = {},
): RelationshipIntelligenceInput {
  return {
    bookings,
    proId: 'pro1',
    now: NOW,
    reviewCount: 0,
    noteCount: 0,
    referredCount: 0,
    wasReferred: false,
    dateOfBirth: null,
    preferredContactMethod: null,
    ...overrides,
  }
}

describe('computeRelationshipIntelligence — lifetime value', () => {
  it('sums completed-visit amounts with-you vs platform-wide', () => {
    const result = computeRelationshipIntelligence(
      input([
        booking({ professionalId: 'pro1', amount: 100 }),
        booking({ professionalId: 'pro2', amount: 50 }),
        // CANCELLED never counts toward value.
        booking({ professionalId: 'pro1', amount: 999, status: 'CANCELLED' }),
        // Falls back to subtotal-coerced amount; null contributes 0.
        booking({ professionalId: 'pro1', amount: null }),
      ]),
    )
    expect(result.lifetimeValue.platform).toBe(150)
    expect(result.lifetimeValue.withYou).toBe(100)
    expect(result.completedVisits).toBe(3)
    expect(result.completedVisitsWithYou).toBe(2)
  })
})

describe('computeRelationshipIntelligence — cadence & lead time', () => {
  it('averages the gap between consecutive completed visits', () => {
    const result = computeRelationshipIntelligence(
      input([
        booking({ scheduledFor: daysAgo(42) }),
        booking({ scheduledFor: daysAgo(28) }),
        booking({ scheduledFor: daysAgo(14) }),
      ]),
    )
    expect(result.cadenceDays).toBe(14)
    expect(formatCadence(result.cadenceDays)).toBe('~every 2 wks')
  })

  it('null cadence with fewer than two completed visits', () => {
    const result = computeRelationshipIntelligence(
      input([booking({ scheduledFor: daysAgo(14) })]),
    )
    expect(result.cadenceDays).toBeNull()
    expect(formatCadence(null)).toBeNull()
  })

  it('averages lead time, ignoring negative (post-dated created) rows', () => {
    const result = computeRelationshipIntelligence(
      input([
        booking({ createdAt: daysAgo(40), scheduledFor: daysAgo(30) }), // 10d
        booking({ createdAt: daysAgo(24), scheduledFor: daysAgo(20) }), // 4d
      ]),
    )
    expect(result.avgLeadTimeDays).toBe(7)
  })
})

describe('computeRelationshipIntelligence — patterns', () => {
  it('reports the most common weekday and time band of completed visits', () => {
    const result = computeRelationshipIntelligence(
      input([
        // 2026-06-06 and 2026-06-13 are Saturdays; morning hours in UTC.
        booking({ scheduledFor: new Date(Date.UTC(2026, 5, 6, 9, 0, 0)) }),
        booking({ scheduledFor: new Date(Date.UTC(2026, 5, 13, 10, 0, 0)) }),
        booking({ scheduledFor: new Date(Date.UTC(2026, 5, 10, 14, 0, 0)) }),
      ]),
    )
    expect(result.preferredDay).toBe('Saturday')
    expect(result.preferredTimeOfDay).toBe('Morning')
  })

  it('buckets weekday and time band in the visit timezone, not the server zone', () => {
    // 2026-06-07 03:00 UTC is still Saturday 2026-06-06, 20:00 (evening) in
    // America/Los_Angeles (UTC-7). Reading UTC parts would mislabel it as
    // Sunday morning — this locks in the timezone-aware bucketing.
    const scheduledFor = new Date(Date.UTC(2026, 5, 7, 3, 0, 0))
    const result = computeRelationshipIntelligence(
      input([
        booking({ scheduledFor, timeZone: 'America/Los_Angeles' }),
        booking({ scheduledFor, timeZone: 'America/Los_Angeles' }),
      ]),
    )
    expect(result.preferredDay).toBe('Saturday')
    expect(result.preferredTimeOfDay).toBe('Evening')
  })

  it('counts cancellations separately from value', () => {
    const result = computeRelationshipIntelligence(
      input([
        booking({ status: 'CANCELLED' }),
        booking({ status: 'CANCELLED' }),
        booking({ status: 'COMPLETED' }),
      ]),
    )
    expect(result.cancelCount).toBe(2)
  })
})

describe('computeRelationshipIntelligence — retention risk', () => {
  it('flags lapsed clients past 1.5× their usual interval with nothing booked', () => {
    const result = computeRelationshipIntelligence(
      input([
        booking({ scheduledFor: daysAgo(70) }),
        booking({ scheduledFor: daysAgo(49) }), // cadence ~21d, last visit 49d ago
      ]),
    )
    expect(result.retentionRisk).toBe(true)
    expect(result.flags.map((f) => f.key)).toContain('retention-risk')
  })

  it('does NOT flag retention risk when an upcoming booking exists', () => {
    const result = computeRelationshipIntelligence(
      input([
        booking({ scheduledFor: daysAgo(70) }),
        booking({ scheduledFor: daysAgo(42) }),
        booking({
          status: 'ACCEPTED',
          scheduledFor: new Date(NOW.getTime() + 5 * DAY_MS),
        }),
      ]),
    )
    expect(result.hasUpcoming).toBe(true)
    expect(result.retentionRisk).toBe(false)
    expect(result.flags.map((f) => f.key)).not.toContain('retention-risk')
  })
})

describe('computeRelationshipIntelligence — smart flags', () => {
  it('flags low-review-no-note only when a review exists and no notes', () => {
    const withFlag = computeRelationshipIntelligence(
      input([booking({})], { reviewCount: 1, noteCount: 0 }),
    )
    expect(withFlag.flags.map((f) => f.key)).toContain('low-review-no-note')

    const noFlag = computeRelationshipIntelligence(
      input([booking({})], { reviewCount: 1, noteCount: 2 }),
    )
    expect(noFlag.flags.map((f) => f.key)).not.toContain('low-review-no-note')
  })

  it('flags birthday within 14 days', () => {
    // NOW is 2026-06-21; a birthday on June 28 is 7 days away.
    const result = computeRelationshipIntelligence(
      input([booking({})], { dateOfBirth: new Date(1990, 5, 28) }),
    )
    expect(result.daysUntilBirthday).toBe(7)
    expect(result.flags.map((f) => f.key)).toContain('birthday-soon')
  })

  it('does not flag a birthday more than 14 days out', () => {
    const result = computeRelationshipIntelligence(
      input([booking({})], { dateOfBirth: new Date(1990, 7, 1) }),
    )
    expect(result.flags.map((f) => f.key)).not.toContain('birthday-soon')
  })

  it('flags referred-people with correct pluralization', () => {
    const one = computeRelationshipIntelligence(
      input([booking({})], { referredCount: 1 }),
    )
    expect(one.flags.find((f) => f.key === 'referred-people')?.label).toBe(
      'Referred 1 person',
    )
    const many = computeRelationshipIntelligence(
      input([booking({})], { referredCount: 3 }),
    )
    expect(many.flags.find((f) => f.key === 'referred-people')?.label).toBe(
      'Referred 3 people',
    )
  })
})

describe('daysLeftInWindow', () => {
  it('rounds up partial days and floors at zero', () => {
    expect(daysLeftInWindow(new Date(NOW.getTime() + 3.2 * DAY_MS), NOW)).toBe(4)
    expect(daysLeftInWindow(new Date(NOW.getTime() - DAY_MS), NOW)).toBe(0)
  })
})

describe('formatRelationshipIntelligence', () => {
  it('formats every tile from a populated relationship', () => {
    const intel = computeRelationshipIntelligence(
      input(
        [
          booking({
            professionalId: 'pro1',
            amount: 120,
            createdAt: daysAgo(78),
            scheduledFor: daysAgo(70),
          }),
          booking({
            professionalId: 'pro2',
            amount: 80,
            createdAt: daysAgo(64),
            scheduledFor: daysAgo(56),
          }),
          booking({
            professionalId: 'pro1',
            amount: 60,
            createdAt: daysAgo(50),
            scheduledFor: daysAgo(42),
          }),
          booking({ status: 'CANCELLED', amount: 999 }),
        ],
        { preferredContactMethod: 'text' },
      ),
    )
    const labels = formatRelationshipIntelligence(intel, 'Referred by a client')

    // Money is server-formatted so native never re-implements it.
    expect(labels.lifetimeValue.value).toBe('$180')
    expect(labels.lifetimeValue.hint).toBe('$260 platform-wide')
    expect(labels.visits.value).toBe('2')
    expect(labels.visits.hint).toBe('3 platform-wide')
    // Consecutive visits 14 days apart → "~every 2 wks"; lead time 8 days.
    expect(labels.cadence.value).toBe('~every 2 wks')
    expect(labels.cadence.hint).toBe('42 days since last visit')
    expect(labels.leadTime.value).toBe('8 days ahead')
    expect(labels.pattern.hint).toBe('1 cancelled')
    // Last visit 42d ago is past 1.5× the 14d cadence, nothing booked → at risk.
    expect(labels.rebooking.value).toBe('At risk')
    expect(labels.preferredContactMethod).toBe('text')
    expect(labels.referralSource).toBe('Referred by a client')
  })

  it('renders em-dash placeholders and null hints when data is thin', () => {
    const intel = computeRelationshipIntelligence(input([]))
    const labels = formatRelationshipIntelligence(intel, null)

    expect(labels.lifetimeValue.value).toBe('$0')
    expect(labels.cadence.value).toBe('—')
    expect(labels.cadence.hint).toBeNull()
    expect(labels.leadTime.value).toBe('—')
    expect(labels.leadTime.hint).toBeNull()
    expect(labels.pattern.value).toBe('—')
    expect(labels.pattern.hint).toBeNull()
    // No prior visit → not "Lapsing", not "At risk".
    expect(labels.rebooking.value).toBe('—')
    expect(labels.referralSource).toBeNull()
    expect(labels.flags).toEqual([])
  })

  it('shows a birthday hint on the rebooking tile within 30 days', () => {
    const intel = computeRelationshipIntelligence(
      input([booking({ scheduledFor: daysAgo(5) })], {
        dateOfBirth: new Date(2000, NOW.getMonth(), NOW.getDate() + 10),
      }),
    )
    const labels = formatRelationshipIntelligence(intel, null)
    expect(labels.rebooking.hint).toBe('Birthday in 10d')
  })
})
