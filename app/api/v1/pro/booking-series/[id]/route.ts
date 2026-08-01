// app/api/v1/pro/booking-series/[id]/route.ts
//
// K19 (Phase 8) — read one recurring appointment back.
//
// The API twin of `/pro/bookings/series/[id]`; both call
// `loadProBookingSeriesDetail`, so the page and the wire cannot disagree about
// what a series is.
//
// 🔴 NOT gated on `recurringAppointmentsEnabled()`, unlike the create route, and
// that asymmetry is deliberate: a series that already exists must stay readable
// (and stoppable — see the sibling cancel route) after the switch goes off, or
// disabling the feature strands live appointments on the pro's calendar with no
// surface to end them. The gate here is DATA: while the feature has never run,
// this pro has no series, so every id 404s.
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import { loadProBookingSeriesDetail } from '@/lib/booking/series/detail'
import type { ProBookingSeriesDetailDTO } from '@/lib/dto/proBookingSeries'
import { asTrimmedString } from '@/lib/guards'
import { safeError, safeLogMeta } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ROUTE = 'GET /api/v1/pro/booking-series/[id]'

export async function GET(_req: Request, ctx: RouteContext) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const params = await resolveRouteParams(ctx)
    const seriesId = asTrimmedString(params.id)

    if (!seriesId) {
      return jsonFail(404, 'Not found.', { code: 'NOT_FOUND' })
    }

    const series = await loadProBookingSeriesDetail({
      professionalId: auth.professionalId,
      seriesId,
    })

    // Missing and not-yours are the same answer.
    if (!series) {
      return jsonFail(404, 'Not found.', { code: 'NOT_FOUND' })
    }

    const body: ProBookingSeriesDetailDTO = series

    return jsonOk(body, 200)
  } catch (error: unknown) {
    console.error(`${ROUTE} error`, {
      error: safeError(error),
      meta: safeLogMeta({ route: ROUTE }),
    })
    return jsonFail(500, 'Internal server error')
  }
}
