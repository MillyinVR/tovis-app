// app/api/v1/calendar/ics/[token]/route.ts
//
// Public, no-auth ICS download for a single booking, authorized by a stateless
// signed token (see lib/calendar/bookingInvite). This is the endpoint the "Add
// to Apple/Outlook calendar" links in email/SMS notifications point at — it must
// work without a login and for not-yet-claimed clients. The signature scopes
// access to exactly the booking the token was minted for; there is no booking-id
// enumeration surface here.
import { NextResponse } from 'next/server'

import { pickString } from '@/app/api/_utils/pick'
import { jsonFail } from '@/app/api/_utils/responses'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import { getBrandForTenantContext } from '@/lib/brand/forTenant'
import {
  buildCalendarInvite,
  loadBookingForCalendar,
  resolveBookingCalendarEvent,
  verifyBookingCalendarToken,
} from '@/lib/calendar/bookingInvite'
import { resolveTenantContextForRequest } from '@/lib/tenant/requestContext'

export const dynamic = 'force-dynamic'

export async function GET(req: Request, ctx: RouteContext<{ token: string }>) {
  try {
    const { token: rawToken } = await resolveRouteParams(ctx)
    const token = pickString(rawToken)
    if (!token) {
      return jsonFail(400, 'Missing token.')
    }

    const bookingId = verifyBookingCalendarToken(token)
    if (!bookingId) {
      return jsonFail(404, 'Calendar invite not found.')
    }

    const booking = await loadBookingForCalendar(bookingId)
    if (!booking) {
      return jsonFail(404, 'Calendar invite not found.')
    }

    // Public link: a missing street address just omits LOCATION rather than
    // failing the whole invite (strictLocation: false).
    const resolved = resolveBookingCalendarEvent(booking, { strictLocation: false })
    if (!resolved.ok) {
      return jsonFail(resolved.status, resolved.error)
    }

    const tenantContext = await resolveTenantContextForRequest(req)
    const brand = getBrandForTenantContext(tenantContext)

    const ics = buildCalendarInvite({
      event: resolved.event,
      brandName: brand.displayName,
    })

    return new NextResponse(ics, {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar; method=REQUEST; charset=utf-8',
        'Content-Disposition': `attachment; filename="tovis-booking-${booking.id}.ics"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    console.error('GET /api/v1/calendar/ics/[token] error', error)
    return jsonFail(500, 'Failed to generate calendar invite.')
  }
}
