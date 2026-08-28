// app/pro/clients/[id]/VisitFilterForm.tsx
import Link from 'next/link'

import { Button, buttonClassName } from '@/app/_components/ui'
import { labelForBookingStatus } from '@/lib/booking/statusLabel'
import {
  isChartBookingFilterActive,
  type ChartBookingFilter,
} from '@/lib/clients/chartBookingSelect'
import {
  VISIT_STATUS_CHOICES,
  type VisitFilter,
} from '@/lib/clients/chartVisitFilters'

// The visits view's controls.
//
// Was one seven-way `bookingFilter` select filtered in memory. The two axes the
// shared chart query can express are now their OWN params — `?status=` and
// `?withMe=`, the same pair the native chart API takes (#1017) — so a filtered
// visits URL narrows in Prisma and means the same thing on both surfaces. Only
// the axes with no `chartBookingWhere` equivalent are still a `bookingFilter`.
//
// Still a plain GET form: applying a filter is a navigation, so it re-renders
// server-side and the route's `loading.tsx` covers the wait.
export default function VisitFilterForm({
  clearHref,
  visitFilter,
  chartFilter,
  bookingQ,
}: {
  /** Where "Clear" goes — the page owns chart URL construction. */
  clearHref: string
  visitFilter: VisitFilter
  chartFilter: ChartBookingFilter
  bookingQ: string
}) {
  const isFiltered =
    Boolean(bookingQ) ||
    visitFilter !== 'ALL' ||
    isChartBookingFilterActive(chartFilter)

  return (
    <form
      className="flex flex-wrap items-center justify-end gap-2"
      method="GET"
      action=""
    >
      {/* Keep the chart/public mode + active tab when applying a filter. */}
      <input type="hidden" name="view" value="chart" />
      <input type="hidden" name="tab" value="history" />

      <div className="flex items-center gap-2">
        <label
          className="text-[11px] font-black text-textSecondary"
          htmlFor="status"
        >
          Status
        </label>

        <select
          id="status"
          name="status"
          defaultValue={chartFilter.status ?? ''}
          className="rounded-full border border-surfaceGlass/10 bg-bgPrimary px-3 py-2 text-[12px] font-black text-textPrimary"
        >
          <option value="">Any status</option>
          {VISIT_STATUS_CHOICES.map((status) => (
            <option key={status} value={status}>
              {labelForBookingStatus(status)}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-2">
        <label
          className="text-[11px] font-black text-textSecondary"
          htmlFor="bookingFilter"
        >
          View
        </label>

        <select
          id="bookingFilter"
          name="bookingFilter"
          defaultValue={visitFilter}
          className="rounded-full border border-surfaceGlass/10 bg-bgPrimary px-3 py-2 text-[12px] font-black text-textPrimary"
        >
          <option value="ALL">All visits</option>
          <option value="MATCHES_MY_SERVICES">Only services I offer</option>
          <option value="UPCOMING">Upcoming</option>
          <option value="PAST">Past</option>
        </select>
      </div>

      <label className="flex items-center gap-2 rounded-full border border-surfaceGlass/10 bg-bgPrimary px-3 py-2 text-[12px] font-black text-textPrimary">
        <input
          type="checkbox"
          name="withMe"
          value="1"
          defaultChecked={chartFilter.withMe}
          className="h-4 w-4 accent-accentPrimary"
        />
        Only with me
      </label>

      <div className="flex items-center gap-2">
        <label className="text-[11px] font-black text-textSecondary" htmlFor="q">
          Search
        </label>

        <input
          id="q"
          name="q"
          defaultValue={bookingQ}
          placeholder="Service, category, notes, status…"
          className="w-56 rounded-full border border-surfaceGlass/10 bg-bgPrimary px-3 py-2 text-[12px] font-semibold text-textPrimary placeholder:text-textSecondary/70"
        />
      </div>

      <Button type="submit" variant="primary" size="sm">
        Apply
      </Button>

      {isFiltered ? (
        <Link
          href={clearHref}
          className={buttonClassName({ variant: 'ghost', size: 'sm' })}
        >
          Clear
        </Link>
      ) : null}
    </form>
  )
}
