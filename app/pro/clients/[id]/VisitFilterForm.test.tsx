// app/pro/clients/[id]/VisitFilterForm.test.tsx
//
// Proves the controls submit the SHARED chart params. Status and "only with me"
// used to be two of seven values in a `bookingFilter` select applied as a JS
// pass over the already-loaded rows; they are now `?status=` / `?withMe=`, the
// same pair the native chart API takes, which `chartBookingWhere` turns into a
// real Prisma `where`. If a control's `name` drifts, the filter silently stops
// narrowing and the view hands back every visit.
import { render, screen } from '@testing-library/react'
import { BookingStatus } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))

import { CHART_BOOKING_FILTER_NONE } from '@/lib/clients/chartBookingSelect'
import type { ChartBookingFilter } from '@/lib/clients/chartBookingSelect'
import type { VisitFilter } from '@/lib/clients/chartVisitFilters'

import VisitFilterForm from './VisitFilterForm'

const CLEAR_HREF = '/pro/clients/client_1?view=chart&tab=history'

function renderForm(args: {
  chartFilter?: ChartBookingFilter
  visitFilter?: VisitFilter
  bookingQ?: string
} = {}) {
  const { container } = render(
    <VisitFilterForm
      clearHref={CLEAR_HREF}
      visitFilter={args.visitFilter ?? 'ALL'}
      chartFilter={args.chartFilter ?? CHART_BOOKING_FILTER_NONE}
      bookingQ={args.bookingQ ?? ''}
    />,
  )

  const form = container.querySelector('form')
  if (!form) throw new Error('no form rendered')
  return form
}

/** What the browser would actually put on the URL when Apply is pressed. */
function submittedQuery(form: HTMLFormElement): URLSearchParams {
  const params = new URLSearchParams()
  for (const [key, value] of new FormData(form).entries()) {
    params.append(key, String(value))
  }
  return params
}

describe('VisitFilterForm', () => {
  it('submits the shared server params, not an in-memory filter name', () => {
    const form = renderForm({
      chartFilter: { status: BookingStatus.COMPLETED, withMe: true },
    })
    const query = submittedQuery(form)

    expect(query.get('status')).toBe(BookingStatus.COMPLETED)
    expect(query.get('withMe')).toBe('1')
  })

  it('keeps the pro on the chart’s visits view when a filter is applied', () => {
    const query = submittedQuery(renderForm())

    expect(query.get('view')).toBe('chart')
    expect(query.get('tab')).toBe('history')
  })

  it('omits status entirely when no status was chosen', () => {
    // An empty `status` is what `parseChartBookingFilter` reads as "no
    // narrowing"; it must never submit a made-up sentinel.
    const query = submittedQuery(renderForm())

    expect(query.get('status')).toBe('')
  })

  it('omits withMe when the box is unchecked, as an unchecked box does', () => {
    const query = submittedQuery(
      renderForm({ chartFilter: { status: null, withMe: false } }),
    )

    expect(query.has('withMe')).toBe(false)
  })

  it('offers only the statuses the retired select had, labelled not raw', () => {
    renderForm()

    // `labelForBookingStatus` owns the copy — a raw enum here is the B10 bug.
    expect(screen.getByRole('option', { name: 'Completed' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Cancelled' })).toBeTruthy()
    expect(screen.queryByRole('option', { name: /COMPLETED/ })).toBeNull()
  })

  it('still carries the axes Prisma cannot answer, and the search text', () => {
    const query = submittedQuery(
      renderForm({ visitFilter: 'UPCOMING', bookingQ: 'balayage' }),
    )

    expect(query.get('bookingFilter')).toBe('UPCOMING')
    expect(query.get('q')).toBe('balayage')
  })

  it('offers Clear once anything is narrowed — including by a server param alone', () => {
    // The regression this guards: the old form checked `bookingFilter !== ALL`,
    // which is now blind to a status/with-me filter.
    for (const filter of [
      { status: BookingStatus.COMPLETED, withMe: false },
      { status: null, withMe: true },
    ] satisfies ChartBookingFilter[]) {
      const { unmount } = render(
        <VisitFilterForm
          clearHref={CLEAR_HREF}
          visitFilter="ALL"
          chartFilter={filter}
          bookingQ=""
        />,
      )
      expect(screen.getByRole('link', { name: 'Clear' }).getAttribute('href')).toBe(
        CLEAR_HREF,
      )
      unmount()
    }
  })

  it('hides Clear when nothing is narrowed', () => {
    renderForm()
    expect(screen.queryByRole('link', { name: 'Clear' })).toBeNull()
  })
})
