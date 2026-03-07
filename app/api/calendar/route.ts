// app/api/calendar/route.ts
import { NextResponse } from 'next/server'
import { Role, BookingStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { isValidIanaTimeZone, sanitizeTimeZone, getZonedParts } from '@/lib/timeZone'
import { pickString } from '@/app/api/_utils/pick'
import { normalizeEmail } from '@/app/api/_utils/email'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { jsonFail } from '@/app/api/_utils/responses'

export const dynamic = 'force-dynamic'

type JsonObject = Record<string, unknown>

function isRecord(v: unknown): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function icsEscape(value: string) {
  return String(value)
    .replace(/\r/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
}

function foldIcsLine(line: string) {
  const maxLen = 75
  if (line.length <= maxLen) return line

  const parts: string[] = []
  let remaining = line

  while (remaining.length > maxLen) {
    parts.push(remaining.slice(0, maxLen))
    remaining = ` ${remaining.slice(maxLen)}`
  }

  parts.push(remaining)
  return parts.join('\r\n')
}

function joinIcsLines(lines: Array<string | null | undefined>) {
  return (
    lines
      .filter((line): line is string => typeof line === 'string' && line.length > 0)
      .map(foldIcsLine)
      .join('\r\n') + '\r\n'
  )
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
  const fullName = `${first} ${last}`.trim()
  return fullName || 'Client'
}

function pickFormattedAddress(snapshot: unknown): string | null {
  if (!isRecord(snapshot)) return null
  const raw = snapshot.formattedAddress
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null
}

function clampDurationMinutes(v: unknown, fallback: number) {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  const x = Math.trunc(n)
  return Math.max(1, Math.min(12 * 60, x))
}

function requireBookingTimeZone(raw: unknown): { ok: true; timeZone: string } | { ok: false; error: string } {
  const s = typeof raw === 'string' ? raw.trim() : ''
  if (!s) {
    return {
      ok: false,
      error: 'This booking is missing a timezone. The professional must set a valid IANA timezone for their location.',
    }
  }

  const cleaned = sanitizeTimeZone(s, 'UTC') || ''
  if (!cleaned || !isValidIanaTimeZone(cleaned)) {
    return {
      ok: false,
      error: 'This booking has an invalid timezone. The professional must set a valid IANA timezone for their location.',
    }
  }

  return { ok: true, timeZone: cleaned }
}

function looksLikeRealLocation(s: string) {
  const value = s.trim()
  if (!value) return false

  const upper = value.toUpperCase()
  if (upper === 'N/A' || upper === 'NA' || upper === 'NONE' || upper === 'UNKNOWN') return false
  if (upper.includes('ONLINE') || upper.includes('VIRTUAL')) return false

  return true
}

function requireBookingLocation(args: {
  locationType: unknown
  locationAddressSnapshot: unknown
  professionalLocation: unknown
}): { ok: true; location: string | null } | { ok: false; error: string } {
  const type = typeof args.locationType === 'string' ? args.locationType.trim().toUpperCase() : ''

  const snapshotAddress = pickFormattedAddress(args.locationAddressSnapshot)
  const professionalLocation =
    typeof args.professionalLocation === 'string' && looksLikeRealLocation(args.professionalLocation)
      ? args.professionalLocation.trim()
      : null

  if (type !== 'SALON') {
    return { ok: true, location: snapshotAddress ?? professionalLocation }
  }

  if (snapshotAddress) return { ok: true, location: snapshotAddress }
  if (professionalLocation) return { ok: true, location: professionalLocation }

  return {
    ok: false,
    error:
      'This salon booking is missing a location address. The professional must set a formatted address for the booking/location before a calendar invite can be generated.',
  }
}

function isAllowedRole(role: Role) {
  return role === Role.CLIENT || role === Role.PRO || role === Role.ADMIN
}

export async function GET(req: Request) {
  try {
    const auth = await requireUser()
    if (!auth.ok) return auth.res

    const user = auth.user
    if (!isAllowedRole(user.role)) {
      return jsonFail(403, 'Forbidden.')
    }

    const { searchParams } = new URL(req.url)
    const bookingId = pickString(searchParams.get('bookingId'))
    if (!bookingId) {
      return jsonFail(400, 'Missing bookingId.')
    }

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        status: true,
        clientId: true,
        professionalId: true,
        scheduledFor: true,
        totalDurationMinutes: true,
        locationType: true,
        locationTimeZone: true,
        locationAddressSnapshot: true,
        professional: {
          select: {
            id: true,
            businessName: true,
            location: true,
            user: { select: { email: true } },
          },
        },
        service: {
          select: { name: true },
        },
        client: {
          select: {
            firstName: true,
            lastName: true,
            user: { select: { email: true } },
          },
        },
      },
    })

    if (!booking) {
      return jsonFail(404, 'Booking not found.')
    }

    if (booking.status === BookingStatus.CANCELLED) {
      return jsonFail(409, 'Cancelled bookings do not have calendar invites.')
    }

    const isClient = Boolean(user.clientProfile?.id && booking.clientId === user.clientProfile.id)
    const isPro = Boolean(user.professionalProfile?.id && booking.professionalId === user.professionalProfile.id)
    const isAdmin = user.role === Role.ADMIN

    if (!isAdmin && !isClient && !isPro) {
      return jsonFail(403, 'Forbidden.')
    }

    const startUtc = new Date(booking.scheduledFor)
    if (!Number.isFinite(startUtc.getTime())) {
      return jsonFail(500, 'Booking has an invalid scheduled time.')
    }

    const durationMinutes = clampDurationMinutes(booking.totalDurationMinutes, 60)
    const endUtc = new Date(startUtc.getTime() + durationMinutes * 60_000)

    const tzRes = requireBookingTimeZone(booking.locationTimeZone)
    if (!tzRes.ok) {
      return jsonFail(409, tzRes.error)
    }
    const appointmentTz = tzRes.timeZone

    const locRes = requireBookingLocation({
      locationType: booking.locationType,
      locationAddressSnapshot: booking.locationAddressSnapshot,
      professionalLocation: booking.professional?.location,
    })
    if (!locRes.ok) {
      return jsonFail(409, locRes.error)
    }
    const location = locRes.location

    const serviceName = booking.service?.name || 'Appointment'
    const proName = booking.professional?.businessName || booking.professional?.user?.email || 'Professional'
    const title = `${serviceName} with ${proName}`

    const description = [
      `Service: ${serviceName}`,
      `Professional: ${proName}`,
      location ? `Location: ${location}` : null,
      `Booking ID: ${booking.id}`,
    ]
      .filter(Boolean)
      .join('\n')

    const uid = `${booking.id}@tovis`
    const dtstamp = toICSDateUtc(new Date())
    const dtStartLocal = toICSDateInTimeZone(startUtc, appointmentTz)
    const dtEndLocal = toICSDateInTimeZone(endUtc, appointmentTz)

    const proEmail = normalizeEmail(booking.professional?.user?.email)
    const clientEmail = normalizeEmail(booking.client?.user?.email)

    const organizerLine = proEmail
      ? `ORGANIZER;CN=${icsEscape(proName)}:mailto:${icsEscape(proEmail)}`
      : null

    const attendeeLine = clientEmail
      ? `ATTENDEE;CN=${icsEscape(clientDisplayName(booking.client))};ROLE=REQ-PARTICIPANT;RSVP=FALSE:mailto:${icsEscape(
          clientEmail,
        )}`
      : null

    const ics = joinIcsLines([
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
    ])

    return new NextResponse(ics, {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar; method=REQUEST; charset=utf-8',
        'Content-Disposition': `attachment; filename="tovis-booking-${booking.id}.ics"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (e) {
    console.error('GET /api/calendar error', e)
    return jsonFail(500, 'Failed to generate calendar invite.')
  }
}