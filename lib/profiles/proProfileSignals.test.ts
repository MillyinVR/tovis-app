// lib/profiles/proProfileSignals.test.ts
//
// Pins Tori's 2026-08-15 call: the urgency/availability chips render on a
// BRAND-NEW pro and on nobody else. The book bar's availability line is a
// separate thing and stays available to every pro — it sits after the work,
// which is why the frame keeps it there.

import { describe, expect, it } from 'vitest'

import { LOOK_BADGE_THRESHOLDS } from '@/lib/looks/badges/engine'
import { resolveProProfileSignals } from './proProfileSignals'

const NOW = new Date('2026-08-15T12:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY_MS)
}

function freshAvailability(openingInDays: number) {
  return {
    // Start-of-local-day instant, so a same-day opening floors to 0.
    nextOpeningDate: new Date(NOW.getTime() + openingInDays * DAY_MS),
    fullness14d: 0.4,
    computedAt: NOW,
  }
}

describe('resolveProProfileSignals — chips', () => {
  it('gives an ESTABLISHED pro no chips at all', () => {
    const signals = resolveProProfileSignals({
      availability: freshAvailability(0),
      accountCreatedAt: daysAgo(LOOK_BADGE_THRESHOLDS.newToPlatformMaxDays + 1),
      brandName: 'Tovis',
      now: NOW,
    })

    // Not a missing read — the availability line below is populated from the
    // very same signal. The chips are absent by design.
    expect(signals.chips).toEqual([])
    expect(signals.availabilityLine).toBe('Available today')
  })

  it('gives a BRAND-NEW pro the availability chip and "New to {brand}"', () => {
    const signals = resolveProProfileSignals({
      availability: freshAvailability(0),
      accountCreatedAt: daysAgo(3),
      brandName: 'Tovis',
      now: NOW,
    })

    expect(signals.chips).toEqual([
      { kind: 'AVAILABLE_SOON', label: 'Available today' },
      { kind: 'NEW_TO_PLATFORM', label: 'New to Tovis' },
    ])
  })

  it('white-labels the platform chip from the tenant brand', () => {
    const signals = resolveProProfileSignals({
      availability: null,
      accountCreatedAt: daysAgo(3),
      brandName: 'Glow Collective',
      now: NOW,
    })

    expect(signals.chips).toEqual([
      { kind: 'NEW_TO_PLATFORM', label: 'New to Glow Collective' },
    ])
  })

  it('drops the availability chip when the pro has no opening in the horizon', () => {
    const signals = resolveProProfileSignals({
      // No stat row = booked out (or unscheduled) over the scan horizon.
      availability: null,
      accountCreatedAt: daysAgo(3),
      brandName: 'Tovis',
      now: NOW,
    })

    expect(signals.chips.map((chip) => chip.kind)).toEqual(['NEW_TO_PLATFORM'])
    expect(signals.availabilityLine).toBeNull()
  })

  it('refuses a STALE availability row rather than rendering old urgency', () => {
    const signals = resolveProProfileSignals({
      availability: {
        nextOpeningDate: NOW,
        fullness14d: 0.4,
        // Well past the engine's availability TTL.
        computedAt: daysAgo(2),
      },
      accountCreatedAt: daysAgo(3),
      brandName: 'Tovis',
      now: NOW,
    })

    expect(signals.availabilityLine).toBeNull()
    expect(signals.chips.map((chip) => chip.kind)).toEqual(['NEW_TO_PLATFORM'])
  })
})

describe('resolveProProfileSignals — the book bar line', () => {
  it('uses the engine’s coarse wording, not an exact hour', () => {
    const tomorrow = resolveProProfileSignals({
      availability: freshAvailability(1),
      accountCreatedAt: daysAgo(500),
      brandName: 'Tovis',
      now: NOW,
    })
    expect(tomorrow.availabilityLine).toBe('Available tomorrow')

    const later = resolveProProfileSignals({
      availability: freshAvailability(4),
      accountCreatedAt: daysAgo(500),
      brandName: 'Tovis',
      now: NOW,
    })
    expect(later.availabilityLine).toBe('Available in 4 days')
  })

  it('stays silent beyond the engine’s horizon', () => {
    const signals = resolveProProfileSignals({
      availability: freshAvailability(
        LOOK_BADGE_THRESHOLDS.availableSoonMaxDays + 1,
      ),
      accountCreatedAt: daysAgo(500),
      brandName: 'Tovis',
      now: NOW,
    })

    expect(signals.availabilityLine).toBeNull()
  })
})
