import { describe, expect, it } from 'vitest'

import { BookingStatus } from '@prisma/client'

import { RELATIONSHIP_BADGE_SELECT } from '@/lib/booking/relationshipLabel'
import {
  CHART_BOOKING_FILTER_NONE,
  CHART_BOOKING_HISTORY_TAKE,
  CHART_BOOKING_SELECT,
  chartBookingWhere,
  chartNoShowCountWhere,
  isChartBookingFilterActive,
  parseChartBookingFilter,
} from '@/lib/clients/chartBookingSelect'

// The chart's booking history is read by TWO surfaces — the web page and the
// native API — and they used to keep two hand-copied selects. They drifted: the
// API's copy never gained K5's `clientRelationshipLabel`, so the NR/NNR/RR/RNR
// mark rendered on web and could not exist on device at all. These pin the
// shared select's job so the same omission can't happen again silently.

describe('CHART_BOOKING_SELECT', () => {
  it('carries the relationship-badge snapshot column', () => {
    for (const column of Object.keys(RELATIONSHIP_BADGE_SELECT)) {
      expect(CHART_BOOKING_SELECT).toHaveProperty(column, true)
    }
  })

  it('carries the columns relationship intelligence derives from', () => {
    // computeRelationshipIntelligence reads lead time (scheduledFor − createdAt),
    // completion, ownership and money off these rows; dropping one degrades the
    // chart's tiles silently rather than failing.
    for (const column of [
      'scheduledFor',
      'createdAt',
      'finishedAt',
      'professionalId',
      'totalAmount',
      'subtotalSnapshot',
      'locationTimeZone',
      'status',
    ]) {
      expect(CHART_BOOKING_SELECT).toHaveProperty(column, true)
    }
  })

  it('does not select the client-relationship inputs it must never re-derive from', () => {
    // The mark is a per-booking SNAPSHOT. If this select ever grew `source` or a
    // history count, a read surface could start deriving the label live — which
    // is exactly what makes a third booking rewrite the first one's mark.
    expect(CHART_BOOKING_SELECT).not.toHaveProperty('source')
    expect(CHART_BOOKING_SELECT).not.toHaveProperty('discoveryProvenance')
  })
})

// The history filter these two surfaces now share. Web faked both axes in
// memory and the API had neither, so a device could only ever show everything.

function read(params: Record<string, string>) {
  return (key: string) => params[key]
}

describe('parseChartBookingFilter', () => {
  it('narrows nothing when no params are given', () => {
    const result = parseChartBookingFilter(read({}))
    expect(result).toEqual({ ok: true, filter: CHART_BOOKING_FILTER_NONE })
    expect(isChartBookingFilterActive(CHART_BOOKING_FILTER_NONE)).toBe(false)
  })

  it('accepts a status in any case, and the usual truthy spellings of withMe', () => {
    expect(parseChartBookingFilter(read({ status: 'completed' }))).toEqual({
      ok: true,
      filter: { status: BookingStatus.COMPLETED, withMe: false },
    })
    for (const truthy of ['true', '1', 'yes', 'on']) {
      expect(parseChartBookingFilter(read({ withMe: truthy }))).toEqual({
        ok: true,
        filter: { status: null, withMe: true },
      })
    }
    expect(parseChartBookingFilter(read({ withMe: 'false' })).ok).toBe(true)
    expect(
      parseChartBookingFilter(read({ withMe: 'false' })),
    ).toEqual({ ok: true, filter: { status: null, withMe: false } })
  })

  it('REFUSES an unknown status rather than silently returning everything', () => {
    // A caller that typo'd COMPLETED and got the whole history back would be
    // told this client completed visits they cancelled.
    const result = parseChartBookingFilter(read({ status: 'COMPLTED' }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('COMPLTED')
  })

  it('recognizes every status Prisma defines — no hand-copied list', () => {
    for (const status of Object.values(BookingStatus)) {
      expect(parseChartBookingFilter(read({ status }))).toEqual({
        ok: true,
        filter: { status, withMe: false },
      })
    }
  })
})

describe('chartBookingWhere', () => {
  const ids = { clientId: 'client_1', proId: 'pro_1' }

  it('is client-scoped and nothing else by default', () => {
    expect(chartBookingWhere({ ...ids, filter: CHART_BOOKING_FILTER_NONE })).toEqual({
      clientId: 'client_1',
    })
  })

  it('pushes both axes into the query when asked', () => {
    expect(
      chartBookingWhere({
        ...ids,
        filter: { status: BookingStatus.COMPLETED, withMe: true },
      }),
    ).toEqual({
      clientId: 'client_1',
      status: BookingStatus.COMPLETED,
      professionalId: 'pro_1',
    })
  })

  it('never drops the client scope, whatever the filter says', () => {
    for (const filter of [
      { status: BookingStatus.NO_SHOW, withMe: false },
      { status: null, withMe: true },
    ]) {
      expect(chartBookingWhere({ ...ids, filter }).clientId).toBe('client_1')
    }
  })
})

describe('CHART_BOOKING_HISTORY_TAKE', () => {
  it('is one ceiling for both surfaces', () => {
    // It was 2000 on web and 500 on the API: the same chart, silently truncated
    // shorter on device with nothing to say so.
    expect(CHART_BOOKING_HISTORY_TAKE).toBe(2000)
  })
})

describe('chartNoShowCountWhere', () => {
  // Both the web chart's header stat and the API's `noShowCount` read this. The
  // scope is the whole point: "has this client no-showed?" is a question about
  // the CLIENT, so an answer narrowed to the viewing pro would read as "never"
  // for someone who has stood up five other pros.
  it('is scoped to the client and the NO_SHOW status only', () => {
    expect(chartNoShowCountWhere({ clientId: 'client-1' })).toEqual({
      clientId: 'client-1',
      status: BookingStatus.NO_SHOW,
    })
  })

  it('never narrows by professional', () => {
    expect(chartNoShowCountWhere({ clientId: 'client-1' })).not.toHaveProperty(
      'professionalId',
    )
  })
})
