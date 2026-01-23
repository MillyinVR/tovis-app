// app/api/calendar/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sanitizeTimeZone, getZonedParts } from '@/lib/timeZone'

import { pickString } from '@/app/api/_utils/pick'
import { normalizeEmail } from '@/app/api/_utils/email'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { jsonFail } from '@/app/api/_utils/responses'

export const dynamic = 'force-dynamic'

function icsEscape(s: string) {
  return String(s)
    .replace(/\r/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
}

function toICSDateUtc(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    d.getUTCFullYear() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    'T' +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    'Z'
  )
}

function toICSDateInTimeZone(dUtc: Date, timeZone: string) {
  const pad = (n: number) => String(n).padStart(2, '0')
  const z = getZonedParts(dUtc, timeZone)
  return z.year + pad(z.month) + pad(z.day) + 'T' + pad(z.hour) + pad(z.minute) + pad(z.second)
}

function clientDisplayName(client: { firstName?: string | null; lastName?: string | null } | null) {
  const first = typeof client?.firstName === 'string' ? client.firstName.trim() : ''
  const last = typeof client?.lastName === 'string' ? client.lastName.trim() : ''
  const name = `${first} ${last}`.trim()
  return name || 'Client'
}

function pickFormattedAddress(snapshot: unknown): string | null {
  if (!snapshot || typeof snapshot !== 'object') return null
  const v = (snapshot as any)?.formattedAddress
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

export async function GET(req: Request) {
  try {
    const { user, res } = await requireUser()
    if (res) return res

    const role = String(user?.role || '').toUpperCase()
    const allowed = role === 'CLIENT' || role === 'PRO' || role === 'ADMIN'
    if (!allowed) return jsonFail(403, 'Forbidden')

    const { searchParams } = new URL(req.url)
    const bookingId = pickString(searchParams.get('bookingId'))
    if (!bookingId) return jsonFail(400, 'Missing bookingId')

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        clientId: true,
        professionalId: true,

        scheduledFor: true,
        totalDurationMinutes: true,

        locationTimeZone: true,
        locationAddressSnapshot: true,

        professional: {
          select: {
            id: true,
            businessName: true,
            location: true,
            timeZone: true,
            user: { select: { email: true } },
          },
        },
        service: { select: { name: true } },
        client: {
          select: {
            firstName: true,
            lastName: true,
            user: { select: { email: true } },
          },
        },
      },
    })

    if (!booking) return jsonFail(404, 'Booking not found')

    const isClient = Boolean(user.clientProfile?.id && booking.clientId === user.clientProfile.id)
    const isPro = Boolean(user.professionalProfile?.id && booking.professionalId === user.professionalProfile.id)
    const isAdmin = role === 'ADMIN'

    if (!isAdmin && !isClient && !isPro) return jsonFail(403, 'Forbidden')

    const startUtc = new Date(booking.scheduledFor)

    const minutesRaw = Number(booking.totalDurationMinutes ?? 60)
    const minutes = Number.isFinite(minutesRaw) ? Math.max(1, Math.min(12 * 60, minutesRaw)) : 60
    const endUtc = new Date(startUtc.getTime() + minutes * 60_000)

    const serviceName = booking.service?.name || 'Appointment'
    const proName = booking.professional?.businessName || booking.professional?.user?.email || 'Professional'
    const title = `${serviceName} with ${proName}`

    const location =
      pickFormattedAddress(booking.locationAddressSnapshot) ||
      (typeof booking.professional?.location === 'string' && booking.professional.location.trim()
        ? booking.professional.location.trim()
        : '')

    const description = [
      `Service: ${serviceName}`,
      `Professional: ${proName}`,
      location ? `Location: ${location}` : null,
      `Booking ID: ${booking.id}`,
    ]
      .filter(Boolean)
      .join('\n')

    const appointmentTz =
      sanitizeTimeZone(
        booking.locationTimeZone || booking.professional?.timeZone || 'America/Los_Angeles',
        'America/Los_Angeles',
      ) || 'America/Los_Angeles'

    const uid = `${booking.id}@tovis`
    const dtstamp = toICSDateUtc(new Date())

    const dtStartLocal = toICSDateInTimeZone(startUtc, appointmentTz)
    const dtEndLocal = toICSDateInTimeZone(endUtc, appointmentTz)

    const proEmail = normalizeEmail(booking.professional?.user?.email)
    const clientEmail = normalizeEmail(booking.client?.user?.email)

    const organizerLine = proEmail ? `ORGANIZER;CN=${icsEscape(proName)}:mailto:${icsEscape(proEmail)}` : null

    /**
     * PRIVACY NOTE:
     * Right now this includes the client's email when generating an ICS for the pro.
     * If you want "don't reveal contact info until access" more strictly,
     * you can conditionally include attendee only for the requester, e.g.
     *
     * - if (isClient) include proEmail
     * - if (isPro) include clientEmail only when booking.status is ACCEPTED/COMPLETED (etc)
     *
     * Keeping existing behavior for now.
     */
    const attendeeLine = clientEmail
      ? `ATTENDEE;CN=${icsEscape(clientDisplayName(booking.client))};ROLE=REQ-PARTICIPANT;RSVP=FALSE:mailto:${icsEscape(
          clientEmail,
        )}`
      : null

    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//TOVIS//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:REQUEST',
      `X-WR-TIMEZONE:${icsEscape(appointmentTz)}`,
      'BEGIN:VEVENT',
      `UID:${icsEscape(uid)}`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART;TZID=${icsEscape(appointmentTz)}:${dtStartLocal}`,
      `DTEND;TZID=${icsEscape(appointmentTz)}:${dtEndLocal}`,
      `SUMMARY:${icsEscape(title)}`,
      location ? `LOCATION:${icsEscape(location)}` : null,
      `DESCRIPTION:${icsEscape(description)}`,
      organizerLine,
      attendeeLine,
      'STATUS:CONFIRMED',
      'SEQUENCE:0',
      'END:VEVENT',
      'END:VCALENDAR',
      '',
    ]
      .filter(Boolean)
      .join('\r\n')

    return new NextResponse(ics, {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': `attachment; filename="tovis-booking-${booking.id}.ics"`,
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (e) {
    console.error('GET /api/calendar error', e)
    return jsonFail(500, 'Failed to generate calendar invite.')
  }
}
