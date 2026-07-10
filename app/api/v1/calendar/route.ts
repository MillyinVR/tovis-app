// app/api/v1/calendar/route.ts
import { NextResponse } from 'next/server'
import { Role } from '@prisma/client'

import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { pickString } from '@/app/api/_utils/pick'
import { jsonFail } from '@/app/api/_utils/responses'
import {
  buildCalendarInvite,
  loadBookingForCalendar,
  resolveBookingCalendarEvent,
} from '@/lib/calendar/bookingInvite'
import { getBrandForTenantContext } from '@/lib/brand/forTenant'
import { resolveTenantContextForRequest } from '@/lib/tenant/requestContext'

export const dynamic = 'force-dynamic'

function isAllowedRole(role: Role): boolean {
  return role === Role.CLIENT || role === Role.PRO || role === Role.ADMIN
}

function canAccessBooking(args: {
  role: Role
  userClientId: string | null | undefined
  userProfessionalId: string | null | undefined
  bookingClientId: string | null
  bookingProfessionalId: string | null
}): boolean {
  if (args.role === Role.ADMIN) return true
  if (args.userClientId && args.userClientId === args.bookingClientId) return true
  if (
    args.userProfessionalId &&
    args.userProfessionalId === args.bookingProfessionalId
  ) {
    return true
  }
  return false
}

export async function GET(req: Request) {
  try {
    const auth = await requireUser()
    if (!auth.ok) return auth.res

    const user = auth.user
    if (!isAllowedRole(user.role)) {
      return jsonFail(403, 'Forbidden.')
    }

    const url = new URL(req.url)
    const bookingId = pickString(url.searchParams.get('bookingId'))
    if (!bookingId) {
      return jsonFail(400, 'Missing bookingId.')
    }

    const booking = await loadBookingForCalendar(bookingId)
    if (!booking) {
      return jsonFail(404, 'Booking not found.')
    }

    const hasAccess = canAccessBooking({
      role: user.role,
      userClientId: user.clientProfile?.id,
      userProfessionalId: user.professionalProfile?.id,
      bookingClientId: booking.clientId,
      bookingProfessionalId: booking.professionalId,
    })

    if (!hasAccess) {
      return jsonFail(403, 'Forbidden.')
    }

    const resolved = resolveBookingCalendarEvent(booking, { strictLocation: true })
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
    console.error('GET /api/v1/calendar error', error)
    return jsonFail(500, 'Failed to generate calendar invite.')
  }
}
