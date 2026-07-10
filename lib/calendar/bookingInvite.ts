// lib/calendar/bookingInvite.ts
//
// Shared, timezone-correct calendar-invite building for a single booking.
// Consumed by:
//   - the authed download route      (app/api/v1/calendar/route.ts)
//   - the public token route          (app/api/v1/calendar/ics/[token]/route.ts)
//   - notification rendering          (email / SMS "Add to calendar" links)
//
// Timezone correctness (why this file emits a VTIMEZONE):
//   A booking is a single, non-recurring appointment that happens at the salon's
//   physical location at a fixed local wall-clock time. We anchor the event to
//   the salon's IANA timezone by emitting DTSTART/DTEND as floating local times
//   with a TZID *and* a self-contained VTIMEZONE component whose offset is the
//   real UTC offset in effect at the event instant (computed via
//   timeZoneOffsetMinutes — DST aware). Without the VTIMEZONE, strict/older
//   calendar clients can't resolve the TZID and fall back to UTC, which is how
//   appointments end up saved at the wrong time. The Google Calendar link makes
//   the same guarantee via the `ctz` parameter.
import { createHmac, timingSafeEqual } from 'node:crypto'

import { BookingStatus, Prisma, ServiceLocationType } from '@prisma/client'

import { readAppOriginFromEnv } from '@/lib/appUrl'
import { formatBookingServicesLabel } from '@/lib/booking/serviceLabel'
import { requireEnv } from '@/lib/env'
import { isRecord } from '@/lib/guards'
import { prisma } from '@/lib/prisma'
import { formatProfessionalPublicDisplayName } from '@/lib/privacy/professionalDisplayName'
import { normalizeEmail } from '@/lib/security/contactNormalization'
import {
  getZonedParts,
  isValidIanaTimeZone,
  sanitizeTimeZone,
  timeZoneOffsetMinutes,
} from '@/lib/timeZone'

export type TimeZoneResult =
  | { ok: true; timeZone: string }
  | { ok: false; error: string }

export type LocationResult =
  | { ok: true; location: string | null }
  | { ok: false; error: string }

export const bookingCalendarSelect = {
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
      firstName: true,
      lastName: true,
      handle: true,
      nameDisplay: true,
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
  serviceItems: {
    select: {
      itemType: true,
      sortOrder: true,
      service: { select: { name: true } },
    },
    orderBy: { sortOrder: 'asc' },
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

export type BookingCalendarRow = Prisma.BookingGetPayload<{
  select: typeof bookingCalendarSelect
}>

export function loadBookingForCalendar(
  bookingId: string,
): Promise<BookingCalendarRow | null> {
  return prisma.booking.findUnique({
    where: { id: bookingId },
    select: bookingCalendarSelect,
  })
}

// ── ICS text primitives (RFC 5545) ───────────────────────────────────────────

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

/** Basic-format local wall-clock (`YYYYMMDDTHHMMSS`) in the given timezone. */
export function formatLocalWallClockForIcs(dateUtc: Date, timeZone: string): string {
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

/**
 * ICS UTC-offset string (`±HHMM`) in effect at `atUtc` for `timeZone`.
 * `timeZoneOffsetMinutes` returns offset such that UTC = local + offset (so a
 * zone west of UTC is positive); ICS TZOFFSET is local − UTC, hence the negation.
 */
function icsUtcOffset(atUtc: Date, timeZone: string): string {
  const icsMinutes = -timeZoneOffsetMinutes(atUtc, timeZone)
  const sign = icsMinutes < 0 ? '-' : '+'
  const abs = Math.abs(icsMinutes)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${sign}${pad(Math.floor(abs / 60))}${pad(abs % 60)}`
}

/**
 * A minimal self-contained VTIMEZONE for a single, non-recurring appointment.
 * One STANDARD sub-component with no RRULE, carrying the real offset at the
 * booked instant, defines the TZID for every referenced time. We anchor on the
 * start offset (the booked wall-clock time); an appointment that literally
 * straddles a DST transition — extraordinarily rare given the ≤12h clamp — would
 * render its end an hour off, which we accept over the complexity of a full
 * transition table.
 */
function buildVTimeZone(timeZone: string, startUtc: Date): string[] {
  const offset = icsUtcOffset(startUtc, timeZone)
  return [
    'BEGIN:VTIMEZONE',
    `TZID:${escapeIcsText(timeZone)}`,
    'BEGIN:STANDARD',
    'DTSTART:19700101T000000',
    `TZOFFSETFROM:${offset}`,
    `TZOFFSETTO:${offset}`,
    'END:STANDARD',
    'END:VTIMEZONE',
  ]
}

// ── Booking → event field resolution ─────────────────────────────────────────

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

export function clampDurationMinutes(
  value: number | null | undefined,
  fallbackMinutes: number,
): number {
  const numericValue = Number(value)
  if (!Number.isFinite(numericValue)) return fallbackMinutes

  const wholeMinutes = Math.trunc(numericValue)
  return Math.max(1, Math.min(12 * 60, wholeMinutes))
}

export function requireBookingTimeZone(rawTimeZone: string | null): TimeZoneResult {
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

/**
 * Best-effort location string (snapshot address, else the pro's location).
 * Never fails — used where a calendar event is still worth generating without a
 * street address (notification links, mobile bookings).
 */
export function resolveBookingLocation(args: {
  locationType: ServiceLocationType | null
  locationAddressSnapshot: Prisma.JsonValue | null
  professionalLocation: string | null | undefined
}): string | null {
  const snapshotAddress = getFormattedAddress(args.locationAddressSnapshot)
  const professionalLocation =
    typeof args.professionalLocation === 'string' &&
    looksLikeRealLocation(args.professionalLocation)
      ? args.professionalLocation.trim()
      : null

  return snapshotAddress ?? professionalLocation
}

/**
 * Strict location resolution: a SALON booking must have a resolvable address.
 * Preserves the authed download route's 409 behavior.
 */
export function requireBookingLocation(args: {
  locationType: ServiceLocationType | null
  locationAddressSnapshot: Prisma.JsonValue | null
  professionalLocation: string | null | undefined
}): LocationResult {
  const location = resolveBookingLocation(args)

  if (args.locationType !== ServiceLocationType.SALON) {
    return { ok: true, location }
  }

  if (location) return { ok: true, location }

  return {
    ok: false,
    error:
      'This salon booking is missing a location address. The professional must set a formatted address for the booking/location before a calendar invite can be generated.',
  }
}

function resolveCalendarServiceName(booking: BookingCalendarRow): string {
  return formatBookingServicesLabel(
    (booking.serviceItems ?? []).map((item) => ({
      name: item.service?.name,
      itemType: item.itemType,
    })),
    booking.service?.name ?? null,
  )
}

function buildTitle(booking: BookingCalendarRow): string {
  const serviceName = resolveCalendarServiceName(booking)
  const professionalName = formatProfessionalPublicDisplayName(booking.professional)

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

// ── Normalized event (drives both the ICS and the Google URL) ─────────────────

export type BookingCalendarEvent = {
  bookingId: string
  startUtc: Date
  endUtc: Date
  timeZone: string
  title: string
  description: string
  location: string | null
  organizerName: string
  organizerEmail: string | null
  attendeeEmail: string | null
  attendeeName: string
}

/**
 * Resolve the fields needed for a calendar event. `strictLocation` gates the
 * salon-address requirement: the authed download route passes `true` (preserving
 * its 409); public / notification links pass `false` (a missing address just
 * omits LOCATION rather than dropping the whole invite).
 */
export function resolveBookingCalendarEvent(
  row: BookingCalendarRow,
  options: { strictLocation: boolean },
):
  | { ok: true; event: BookingCalendarEvent }
  | { ok: false; status: number; error: string } {
  if (row.status === BookingStatus.CANCELLED) {
    return {
      ok: false,
      status: 409,
      error: 'Cancelled bookings do not have calendar invites.',
    }
  }

  const startUtc = new Date(row.scheduledFor)
  if (!Number.isFinite(startUtc.getTime())) {
    return { ok: false, status: 500, error: 'Booking has an invalid scheduled time.' }
  }

  const timeZoneResult = requireBookingTimeZone(row.locationTimeZone)
  if (!timeZoneResult.ok) {
    return { ok: false, status: 409, error: timeZoneResult.error }
  }

  const locationArgs = {
    locationType: row.locationType,
    locationAddressSnapshot: row.locationAddressSnapshot,
    professionalLocation: row.professional?.location,
  }

  let location: string | null
  if (options.strictLocation) {
    const locationResult = requireBookingLocation(locationArgs)
    if (!locationResult.ok) {
      return { ok: false, status: 409, error: locationResult.error }
    }
    location = locationResult.location
  } else {
    location = resolveBookingLocation(locationArgs)
  }

  const durationMinutes = clampDurationMinutes(row.totalDurationMinutes, 60)
  const endUtc = new Date(startUtc.getTime() + durationMinutes * 60_000)

  const serviceName = resolveCalendarServiceName(row)
  const professionalName = formatProfessionalPublicDisplayName(row.professional)

  return {
    ok: true,
    event: {
      bookingId: row.id,
      startUtc,
      endUtc,
      timeZone: timeZoneResult.timeZone,
      title: buildTitle(row),
      description: buildDescription({
        bookingId: row.id,
        serviceName,
        professionalName,
        location,
      }),
      location,
      organizerName: professionalName,
      organizerEmail: normalizeEmail(row.professional?.user?.email),
      attendeeEmail: normalizeEmail(row.client?.user?.email),
      attendeeName: getClientDisplayName(row.client),
    },
  }
}

// ── ICS document ──────────────────────────────────────────────────────────────

export function buildCalendarInvite(args: {
  event: BookingCalendarEvent
  brandName: string
}): string {
  const { event } = args

  const organizerLine = event.organizerEmail
    ? `ORGANIZER;CN=${escapeIcsText(event.organizerName)}:mailto:${escapeIcsText(
        event.organizerEmail,
      )}`
    : null

  const attendeeLine = event.attendeeEmail
    ? `ATTENDEE;CN=${escapeIcsText(
        event.attendeeName,
      )};ROLE=REQ-PARTICIPANT;RSVP=FALSE:mailto:${escapeIcsText(event.attendeeEmail)}`
    : null

  const dtStartLocal = formatLocalWallClockForIcs(event.startUtc, event.timeZone)
  const dtEndLocal = formatLocalWallClockForIcs(event.endUtc, event.timeZone)

  return buildIcs([
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//${escapeIcsText(args.brandName)}//EN`,
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    `X-WR-TIMEZONE:${escapeIcsText(event.timeZone)}`,
    ...buildVTimeZone(event.timeZone, event.startUtc),
    'BEGIN:VEVENT',
    `UID:${escapeIcsText(`${event.bookingId}@tovis`)}`,
    `DTSTAMP:${formatUtcForIcs(new Date())}`,
    `DTSTART;TZID=${escapeIcsText(event.timeZone)}:${dtStartLocal}`,
    `DTEND;TZID=${escapeIcsText(event.timeZone)}:${dtEndLocal}`,
    `SUMMARY:${escapeIcsText(event.title)}`,
    event.location ? `LOCATION:${escapeIcsText(event.location)}` : null,
    `DESCRIPTION:${escapeIcsText(event.description)}`,
    organizerLine,
    attendeeLine,
    'STATUS:CONFIRMED',
    'SEQUENCE:0',
    'END:VEVENT',
    'END:VCALENDAR',
  ])
}

// ── Google Calendar template URL ──────────────────────────────────────────────

/**
 * A no-auth "Add to Google Calendar" link. Times are passed as local wall-clock
 * (basic format, no `Z`) plus `ctz=<IANA zone>`, so Google pins the event to the
 * salon's timezone regardless of the viewer's account zone.
 */
export function buildGoogleCalendarUrl(event: BookingCalendarEvent): string {
  const dates = `${formatLocalWallClockForIcs(
    event.startUtc,
    event.timeZone,
  )}/${formatLocalWallClockForIcs(event.endUtc, event.timeZone)}`

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates,
    ctz: event.timeZone,
    details: event.description,
  })
  if (event.location) params.set('location', event.location)

  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

// ── Stateless signed token for the public ICS route ───────────────────────────
//
// A calendar link lives forever in an email/SMS, so the token is stateless
// (no DB row, no expiry): HMAC-SHA256 over the booking id, keyed by JWT_SECRET
// with a domain-separation prefix. It authorizes reading *this* booking's invite
// and nothing else — you can't enumerate other bookings by editing the id.

const CALENDAR_TOKEN_VERSION = 'v1'
const CALENDAR_ICS_PATH_PREFIX = '/api/v1/calendar/ics'

function calendarTokenSignature(bookingId: string): string {
  return createHmac('sha256', requireEnv('JWT_SECRET'))
    .update(`calendar-ics:${CALENDAR_TOKEN_VERSION}:${bookingId}`)
    .digest('base64url')
}

export function signBookingCalendarToken(bookingId: string): string {
  const encodedId = Buffer.from(bookingId, 'utf8').toString('base64url')
  return `${CALENDAR_TOKEN_VERSION}.${encodedId}.${calendarTokenSignature(bookingId)}`
}

export function verifyBookingCalendarToken(token: string): string | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null

  const [version, encodedId, signature] = parts
  if (version !== CALENDAR_TOKEN_VERSION) return null
  if (encodedId === undefined || signature === undefined) return null

  let bookingId: string
  try {
    bookingId = Buffer.from(encodedId, 'base64url').toString('utf8')
  } catch {
    return null
  }
  if (!bookingId) return null

  const expected = Buffer.from(calendarTokenSignature(bookingId))
  const provided = Buffer.from(signature)
  if (expected.length !== provided.length) return null
  if (!timingSafeEqual(expected, provided)) return null

  return bookingId
}

/** Internal path (leading slash) to the public token ICS endpoint. */
export function buildBookingIcsPath(bookingId: string): string {
  return `${CALENDAR_ICS_PATH_PREFIX}/${encodeURIComponent(
    signBookingCalendarToken(bookingId),
  )}`
}

// ── Notification-facing entry point ───────────────────────────────────────────

export type BookingCalendarLinks = {
  googleUrl: string
  /** Absolute URL to the public ICS endpoint; null when the app origin is unset. */
  icsUrl: string | null
}

/**
 * Resolve the "Add to calendar" links for a booking, for embedding in email/SMS
 * notifications. Returns null (link silently omitted) when the booking is gone,
 * cancelled, or missing a valid timezone — never throws, so it can't break a
 * notification send.
 */
export async function resolveBookingCalendarLinks(
  bookingId: string,
): Promise<BookingCalendarLinks | null> {
  try {
    const row = await loadBookingForCalendar(bookingId)
    if (!row) return null

    const resolved = resolveBookingCalendarEvent(row, { strictLocation: false })
    if (!resolved.ok) return null

    const origin = readAppOriginFromEnv()

    return {
      googleUrl: buildGoogleCalendarUrl(resolved.event),
      icsUrl: origin ? `${origin}${buildBookingIcsPath(bookingId)}` : null,
    }
  } catch {
    return null
  }
}
