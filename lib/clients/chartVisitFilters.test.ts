import { describe, expect, it } from 'vitest'

import { BookingStatus } from '@prisma/client'

import { CHART_BOOKING_SELECT } from '@/lib/clients/chartBookingSelect'
import {
  CHART_VISIT_SELECT,
  VISIT_FILTERS,
  VISIT_STATUS_CHOICES,
  normalizeVisitFilter,
  resolveVisitChartFilter,
  retiredVisitFilterParams,
  visitMatchesFilter,
} from '@/lib/clients/chartVisitFilters'

const NOW = new Date('2026-08-27T12:00:00.000Z')

function row(overrides: { serviceId?: string; scheduledFor?: Date } = {}) {
  return {
    serviceId: overrides.serviceId ?? 'svc-1',
    scheduledFor: overrides.scheduledFor ?? new Date('2026-01-01T00:00:00.000Z'),
  }
}

describe('CHART_VISIT_SELECT', () => {
  it('is the shared chart select plus the one column the web view adds', () => {
    for (const column of Object.keys(CHART_BOOKING_SELECT)) {
      expect(CHART_VISIT_SELECT).toHaveProperty(column)
    }
    // MATCHES_MY_SERVICES compares against the pro's offering list, and the
    // native chart doesn't offer that axis — hence the extra column here rather
    // than in the shared select.
    expect(CHART_VISIT_SELECT).toHaveProperty('serviceId', true)
  })
})

describe('normalizeVisitFilter', () => {
  it('accepts every advertised filter, case-insensitively', () => {
    for (const filter of VISIT_FILTERS) {
      expect(normalizeVisitFilter(filter)).toBe(filter)
      expect(normalizeVisitFilter(filter.toLowerCase())).toBe(filter)
      expect(normalizeVisitFilter(` ${filter} `)).toBe(filter)
    }
  })

  it('falls back to ALL for junk, and for the values that MOVED to the server', () => {
    for (const raw of [undefined, null, '', 'nonsense', 'COMPLETED', 'WITH_ME']) {
      expect(normalizeVisitFilter(raw)).toBe('ALL')
    }
  })
})

describe('retiredVisitFilterParams', () => {
  // The load-bearing case: these three used to be `bookingFilter` values applied
  // in memory and are now the shared `?status=` / `?withMe=` params. A saved link
  // carrying the OLD spelling must still narrow — falling back to "all visits"
  // would hand the pro every booking under a heading that says completed.
  it('maps each retired value onto the axis that answers it now', () => {
    expect(retiredVisitFilterParams('WITH_ME')).toEqual({ withMe: true })
    expect(retiredVisitFilterParams('COMPLETED')).toEqual({
      status: BookingStatus.COMPLETED,
    })
    expect(retiredVisitFilterParams('CANCELLED')).toEqual({
      status: BookingStatus.CANCELLED,
    })
  })

  it('is case- and whitespace-insensitive, like the select that emitted it', () => {
    expect(retiredVisitFilterParams(' with_me ')).toEqual({ withMe: true })
  })

  it('returns null for a value this view still handles, and for junk', () => {
    for (const raw of [...VISIT_FILTERS, undefined, null, '', 'nonsense']) {
      expect(retiredVisitFilterParams(raw)).toBeNull()
    }
  })
})

describe('resolveVisitChartFilter', () => {
  it('passes the explicit params through untouched', () => {
    expect(
      resolveVisitChartFilter({
        parsed: { status: BookingStatus.NO_SHOW, withMe: true },
        retired: null,
      }),
    ).toEqual({ status: BookingStatus.NO_SHOW, withMe: true })
  })

  it('adopts a retired value when nothing explicit was given', () => {
    expect(
      resolveVisitChartFilter({
        parsed: { status: null, withMe: false },
        retired: { status: BookingStatus.COMPLETED },
      }),
    ).toEqual({ status: BookingStatus.COMPLETED, withMe: false })

    expect(
      resolveVisitChartFilter({
        parsed: { status: null, withMe: false },
        retired: { withMe: true },
      }),
    ).toEqual({ status: null, withMe: true })
  })

  it('lets the explicit status win over a stale one riding along in the URL', () => {
    // The control the pro just used submits `?status=`; a `bookingFilter` left
    // over in a bookmarked link must not override it.
    expect(
      resolveVisitChartFilter({
        parsed: { status: BookingStatus.CANCELLED, withMe: false },
        retired: { status: BookingStatus.COMPLETED },
      }),
    ).toEqual({ status: BookingStatus.CANCELLED, withMe: false })
  })

  it('keeps with-me on when either source asks for it', () => {
    expect(
      resolveVisitChartFilter({
        parsed: { status: null, withMe: true },
        retired: { status: BookingStatus.COMPLETED },
      }),
    ).toEqual({ status: BookingStatus.COMPLETED, withMe: true })
  })
})

describe('VISIT_STATUS_CHOICES', () => {
  it('offers exactly the statuses the retired select already had', () => {
    expect([...VISIT_STATUS_CHOICES]).toEqual([
      BookingStatus.COMPLETED,
      BookingStatus.CANCELLED,
    ])
  })

  it('names real BookingStatus members', () => {
    for (const status of VISIT_STATUS_CHOICES) {
      expect(Object.values(BookingStatus)).toContain(status)
    }
  })
})

describe('visitMatchesFilter', () => {
  it('ALL keeps everything', () => {
    expect(
      visitMatchesFilter(row(), { filter: 'ALL', myServiceIds: [], now: NOW }),
    ).toBe(true)
  })

  it('MATCHES_MY_SERVICES keeps only the pro’s own offerings', () => {
    expect(
      visitMatchesFilter(row({ serviceId: 'svc-1' }), {
        filter: 'MATCHES_MY_SERVICES',
        myServiceIds: ['svc-1', 'svc-2'],
        now: NOW,
      }),
    ).toBe(true)

    expect(
      visitMatchesFilter(row({ serviceId: 'svc-9' }), {
        filter: 'MATCHES_MY_SERVICES',
        myServiceIds: ['svc-1'],
        now: NOW,
      }),
    ).toBe(false)
  })

  it('splits UPCOMING/PAST at `now`, with the boundary counting as upcoming', () => {
    const before = new Date(NOW.getTime() - 1)
    const after = new Date(NOW.getTime() + 1)

    for (const [scheduledFor, upcoming] of [
      [before, false],
      [NOW, true],
      [after, true],
    ] as const) {
      expect(
        visitMatchesFilter(row({ scheduledFor }), {
          filter: 'UPCOMING',
          myServiceIds: [],
          now: NOW,
        }),
      ).toBe(upcoming)

      expect(
        visitMatchesFilter(row({ scheduledFor }), {
          filter: 'PAST',
          myServiceIds: [],
          now: NOW,
        }),
      ).toBe(!upcoming)
    }
  })

  it('no longer answers the axes Prisma owns — status and with-me are not here', () => {
    // Guard against them creeping back as an in-memory pass: `chartBookingWhere`
    // is the only place those two narrow, on both surfaces.
    expect(VISIT_FILTERS).not.toContain('COMPLETED')
    expect(VISIT_FILTERS).not.toContain('CANCELLED')
    expect(VISIT_FILTERS).not.toContain('WITH_ME')
  })
})
