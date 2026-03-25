// app/api/calendar/route.ts
import { NextResponse } from 'next/server'
import {
  BookingStatus,
  Prisma,
  Role,
  ServiceLocationType,
} from '@prisma/client'

import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { normalizeEmail } from '@/app/api/_utils/email'
import { pickString } from '@/app/api/_utils/pick'
import { jsonFail } from '@/app/api/_utils/responses'
import { prisma } from '@/lib/prisma'
import {
  getZonedParts,
  isValidIanaTimeZone,
  sanitizeTimeZone,
} from '@/lib/timeZone'

export const dynamic = 'force-dynamic'

type JsonRecord = Record<string, unknown>

type TimeZoneResult =
  | { ok: true; timeZone: string }
  | { ok: false; error: string }

type LocationResult =
  | { ok: true; location: string | null }
  | { ok: false; error: string }

const bookingCalendarSelect = {
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
      user: {
        select: {
          email: true,
        },
      },
    },
  },
  service: {
    select: {
      name: true,
    },
  },
  client: {
    select: {
      firstName: true,
      lastName: true,
      user: {
        select: {
          email: true,
        },
      },
    },
  },
} satisfies Prisma.BookingSelect

type BookingCalendarRow = Prisma.BookingGetPayload<{
  select: typeof bookingCalendarSelect
}>

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function escapeIcsText(value: string): string {
  return value
    .replace(/\r/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
}

function foldIcsLine(line: string): string {
  const maxLength = 75
  if (line.length <= maxLength) return line

  const parts: string[] = []
  let remaining = line

  while (remaining.length > maxLength) {
    parts.push(remaining.slice(0, maxLength))
    remaining = ` ${remaining.slice(maxLength)}`
  }

  parts.push(remaining)
  return parts.join('\r\n')
}

function buildIcs(lines: Array<string | null>): string {
  return (
    lines
      .filter((line): line is string => typeof line === 'string' && line.length > 0)
      .map(foldIcsLine)
      .join('\r\n') + '\r\n'
  )
}

function formatUtcForIcs(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')

  return (
    date.getUTCFullYear() +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    'T' +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds()) +
    'Z'
  )
}

function formatInTimeZoneForIcs(dateUtc: Date, timeZone: string): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  const zoned = getZonedParts(dateUtc, timeZone)

  return (
    zoned.year +
    pad(zoned.month) +
    pad(zoned.day) +
    'T' +
    pad(zoned.hour) +
    pad(zoned.minute) +
    pad(zoned.second)
  )
}

function getClientDisplayName(client: BookingCalendarRow['client']): string {
  const firstName =
    typeof client?.firstName === 'string' ? client.firstName.trim() : ''
  const lastName =
    typeof client?.lastName === 'string' ? client.lastName.trim() : ''
  const fullName = `${firstName} ${lastName}`.trim()

  return fullName || 'Client'
}

function getFormattedAddress(
  snapshot: Prisma.JsonValue | null | undefined,
): string | null {
  if (!isRecord(snapshot)) return null

  const formattedAddress = snapshot.formattedAddress
  if (typeof formattedAddress !== 'string') return null

  const trimmed = formattedAddress.trim()
  return trimmed ? trimmed : null
}

function clampDurationMinutes(
  value: number | null | undefined,
  fallbackMinutes: number,
): number {
  const numericValue = Number(value)
  if (!Number.isFinite(numericValue)) return fallbackMinutes

  const wholeMinutes = Math.trunc(numericValue)
  return Math.max(1, Math.min(12 * 60, wholeMinutes))
}

function requireBookingTimeZone(rawTimeZone: string | null): TimeZoneResult {
  const trimmed = typeof rawTimeZone === 'string' ? rawTimeZone.trim() : ''
  if (!trimmed) {
    return {
      ok: false,
      error:
        'This booking is missing a timezone. The professional must set a valid IANA timezone for their location.',
    }
  }

  const cleaned = sanitizeTimeZone(trimmed, 'UTC')
  if (!cleaned || !isValidIanaTimeZone(cleaned)) {
    return {
      ok: false,
      error:
        'This booking has an invalid timezone. The professional must set a valid IANA timezone for their location.',
    }
  }

  return { ok: true, timeZone: cleaned }
}

function looksLikeRealLocation(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return false

  const upper = trimmed.toUpperCase()
  if (upper === 'N/A' || upper === 'NA' || upper === 'NONE' || upper === 'UNKNOWN') {
    return false
  }
  if (upper.includes('ONLINE') || upper.includes('VIRTUAL')) {
    return false
  }

  return true
}

function requireBookingLocation(args: {
  locationType: ServiceLocationType | null
  locationAddressSnapshot: Prisma.JsonValue | null
  professionalLocation: string | null | undefined
}): LocationResult {
  const snapshotAddress = getFormattedAddress(args.locationAddressSnapshot)
  const professionalLocation =
    typeof args.professionalLocation === 'string' &&
    looksLikeRealLocation(args.professionalLocation)
      ? args.professionalLocation.trim()
      : null

  if (args.locationType !== ServiceLocationType.SALON) {
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

function buildTitle(booking: BookingCalendarRow): string {
  const serviceName = booking.service?.name?.trim() || 'Appointment'
  const professionalName =
    booking.professional?.businessName?.trim() ||
    booking.professional?.user?.email?.trim() ||
    'Professional'

  return `${serviceName} with ${professionalName}`
}

function buildDescription(args: {
  bookingId: string
  serviceName: string
  professionalName: string
  location: string | null
}): string {
  return [
    `Service: ${args.serviceName}`,
    `Professional: ${args.professionalName}`,
    args.location ? `Location: ${args.location}` : null,
    `Booking ID: ${args.bookingId}`,
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n')
}

function buildCalendarInvite(args: {
  booking: BookingCalendarRow
  appointmentTimeZone: string
  location: string | null
  startUtc: Date
  endUtc: Date
}): string {
  const serviceName = args.booking.service?.name?.trim() || 'Appointment'
  const professionalName =
    args.booking.professional?.businessName?.trim() ||
    args.booking.professional?.user?.email?.trim() ||
    'Professional'

  const title = buildTitle(args.booking)
  const description = buildDescription({
    bookingId: args.booking.id,
    serviceName,
    professionalName,
    location: args.location,
  })

  const organizerEmail = normalizeEmail(args.booking.professional?.user?.email)
  const clientEmail = normalizeEmail(args.booking.client?.user?.email)
  const clientName = getClientDisplayName(args.booking.client)

  const uid = `${args.booking.id}@tovis`
  const dtStamp = formatUtcForIcs(new Date())
  const dtStartLocal = formatInTimeZoneForIcs(
    args.startUtc,
    args.appointmentTimeZone,
  )
  const dtEndLocal = formatInTimeZoneForIcs(
    args.endUtc,
    args.appointmentTimeZone,
  )

  const organizerLine = organizerEmail
    ? `ORGANIZER;CN=${escapeIcsText(professionalName)}:mailto:${escapeIcsText(
        organizerEmail,
      )}`
    : null

  const attendeeLine = clientEmail
    ? `ATTENDEE;CN=${escapeIcsText(
        clientName,
      )};ROLE=REQ-PARTICIPANT;RSVP=FALSE:mailto:${escapeIcsText(clientEmail)}`
    : null

  return buildIcs([
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//TOVIS//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    `X-WR-TIMEZONE:${escapeIcsText(args.appointmentTimeZone)}`,
    'BEGIN:VEVENT',
    `UID:${escapeIcsText(uid)}`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART;TZID=${escapeIcsText(args.appointmentTimeZone)}:${dtStartLocal}`,
    `DTEND;TZID=${escapeIcsText(args.appointmentTimeZone)}:${dtEndLocal}`,
    `SUMMARY:${escapeIcsText(title)}`,
    args.location ? `LOCATION:${escapeIcsText(args.location)}` : null,
    `DESCRIPTION:${escapeIcsText(description)}`,
    organizerLine,
    attendeeLine,
    'STATUS:CONFIRMED',
    'SEQUENCE:0',
    'END:VEVENT',
    'END:VCALENDAR',
  ])
}

async function getBookingForCalendar(
  bookingId: string,
): Promise<BookingCalendarRow | null> {
  return prisma.booking.findUnique({
    where: { id: bookingId },
    select: bookingCalendarSelect,
  })
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

    const booking = await getBookingForCalendar(bookingId)
    if (!booking) {
      return jsonFail(404, 'Booking not found.')
    }

    if (booking.status === BookingStatus.CANCELLED) {
      return jsonFail(409, 'Cancelled bookings do not have calendar invites.')
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

    const startUtc = new Date(booking.scheduledFor)
    if (!Number.isFinite(startUtc.getTime())) {
      return jsonFail(500, 'Booking has an invalid scheduled time.')
    }

    const durationMinutes = clampDurationMinutes(
      booking.totalDurationMinutes,
      60,
    )
    const endUtc = new Date(startUtc.getTime() + durationMinutes * 60_000)

    const timeZoneResult = requireBookingTimeZone(booking.locationTimeZone)
    if (!timeZoneResult.ok) {
      return jsonFail(409, timeZoneResult.error)
    }

    const locationResult = requireBookingLocation({
      locationType: booking.locationType,
      locationAddressSnapshot: booking.locationAddressSnapshot,
      professionalLocation: booking.professional?.location,
    })
    if (!locationResult.ok) {
      return jsonFail(409, locationResult.error)
    }

    const ics = buildCalendarInvite({
      booking,
      appointmentTimeZone: timeZoneResult.timeZone,
      location: locationResult.location,
      startUtc,
      endUtc,
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
    console.error('GET /api/calendar error', error)
    return jsonFail(500, 'Failed to generate calendar invite.')
  }
}