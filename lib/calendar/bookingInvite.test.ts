import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  buildBookingIcsPath,
  buildCalendarInvite,
  buildGoogleCalendarUrl,
  signBookingCalendarToken,
  verifyBookingCalendarToken,
  type BookingCalendarEvent,
} from './bookingInvite'

// 2026-07-15 14:00 America/New_York is EDT (UTC-4) → 18:00Z.
const summerEvent: BookingCalendarEvent = {
  bookingId: 'booking_summer',
  startUtc: new Date('2026-07-15T18:00:00Z'),
  endUtc: new Date('2026-07-15T19:00:00Z'),
  timeZone: 'America/New_York',
  title: 'Balayage with Amara',
  description: 'Service: Balayage\nProfessional: Amara\nBooking ID: booking_summer',
  location: '123 Main St, Brooklyn, NY',
  organizerName: 'Amara',
  organizerEmail: 'amara@example.com',
  attendeeEmail: 'client@example.com',
  attendeeName: 'Jane Client',
}

// 2026-01-15 14:00 America/New_York is EST (UTC-5) → 19:00Z. Same wall-clock,
// different UTC instant — proves the offset is resolved per-date (DST aware).
const winterEvent: BookingCalendarEvent = {
  ...summerEvent,
  bookingId: 'booking_winter',
  startUtc: new Date('2026-01-15T19:00:00Z'),
  endUtc: new Date('2026-01-15T20:00:00Z'),
}

describe('lib/calendar/bookingInvite — ICS timezone correctness', () => {
  it('anchors the event to the salon timezone with a matching VTIMEZONE (summer / EDT)', () => {
    const ics = buildCalendarInvite({ event: summerEvent, brandName: 'Tovis' })

    // The referenced TZID must be defined in-document so no client falls back to UTC.
    expect(ics).toContain('BEGIN:VTIMEZONE')
    expect(ics).toContain('TZID:America/New_York')
    expect(ics).toContain('TZOFFSETTO:-0400')
    expect(ics).toContain('END:VTIMEZONE')

    // DTSTART/DTEND are local wall-clock (2:00pm–3:00pm), NOT the UTC instant.
    expect(ics).toContain('DTSTART;TZID=America/New_York:20260715T140000')
    expect(ics).toContain('DTEND;TZID=America/New_York:20260715T150000')

    // The wall-clock local times must never be emitted with a trailing Z (UTC).
    expect(ics).not.toContain('DTSTART;TZID=America/New_York:20260715T140000Z')
  })

  it('resolves a different UTC offset for the same wall-clock in winter (EST)', () => {
    const ics = buildCalendarInvite({ event: winterEvent, brandName: 'Tovis' })

    expect(ics).toContain('TZOFFSETTO:-0500')
    expect(ics).toContain('DTSTART;TZID=America/New_York:20260115T140000')
    expect(ics).toContain('DTEND;TZID=America/New_York:20260115T150000')
  })

  it('carries the standard VEVENT fields', () => {
    // Unfold RFC 5545 line folding (CRLF + leading space) so long lines like
    // ATTENDEE can be matched as a single contiguous string.
    const ics = buildCalendarInvite({
      event: summerEvent,
      brandName: 'Tovis',
    }).replace(/\r\n[ \t]/g, '')

    expect(ics).toContain('BEGIN:VEVENT')
    expect(ics).toContain('UID:booking_summer@tovis')
    expect(ics).toContain('SUMMARY:Balayage with Amara')
    expect(ics).toContain('LOCATION:123 Main St\\, Brooklyn\\, NY')
    expect(ics).toContain('ORGANIZER;CN=Amara:mailto:amara@example.com')
    expect(ics).toContain(
      'ATTENDEE;CN=Jane Client;ROLE=REQ-PARTICIPANT;RSVP=FALSE:mailto:client@example.com',
    )
    expect(ics).toContain('STATUS:CONFIRMED')
  })

  it('omits LOCATION when the event has no address', () => {
    const ics = buildCalendarInvite({
      event: { ...summerEvent, location: null },
      brandName: 'Tovis',
    })

    expect(ics).not.toContain('LOCATION:')
    expect(ics).toContain('DTSTART;TZID=America/New_York:20260715T140000')
  })
})

describe('lib/calendar/bookingInvite — Google Calendar URL', () => {
  it('pins the event to the salon timezone via ctz + local wall-clock dates', () => {
    const url = new URL(buildGoogleCalendarUrl(summerEvent))

    expect(url.origin + url.pathname).toBe(
      'https://calendar.google.com/calendar/render',
    )
    expect(url.searchParams.get('action')).toBe('TEMPLATE')
    expect(url.searchParams.get('ctz')).toBe('America/New_York')
    // Local wall-clock, not UTC — Google renders it in the salon zone.
    expect(url.searchParams.get('dates')).toBe(
      '20260715T140000/20260715T150000',
    )
    expect(url.searchParams.get('text')).toBe('Balayage with Amara')
    expect(url.searchParams.get('location')).toBe('123 Main St, Brooklyn, NY')
  })

  it('omits location when the event has none', () => {
    const url = new URL(
      buildGoogleCalendarUrl({ ...summerEvent, location: null }),
    )
    expect(url.searchParams.has('location')).toBe(false)
  })
})

describe('lib/calendar/bookingInvite — signed token', () => {
  const originalSecret = process.env.JWT_SECRET

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-calendar-secret'
  })

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.JWT_SECRET
    } else {
      process.env.JWT_SECRET = originalSecret
    }
  })

  it('round-trips a booking id through sign/verify', () => {
    const token = signBookingCalendarToken('booking_1')
    expect(verifyBookingCalendarToken(token)).toBe('booking_1')
  })

  it('rejects a tampered signature', () => {
    const token = signBookingCalendarToken('booking_1')
    expect(verifyBookingCalendarToken(`${token}x`)).toBeNull()
  })

  it('rejects a forged booking id (signature no longer matches)', () => {
    const token = signBookingCalendarToken('booking_1')
    const [version, , signature] = token.split('.')
    const forgedId = Buffer.from('booking_2', 'utf8').toString('base64url')
    expect(
      verifyBookingCalendarToken(`${version}.${forgedId}.${signature}`),
    ).toBeNull()
  })

  it('rejects malformed tokens', () => {
    expect(verifyBookingCalendarToken('garbage')).toBeNull()
    expect(verifyBookingCalendarToken('a.b')).toBeNull()
    expect(verifyBookingCalendarToken('v2.abc.def')).toBeNull()
  })

  it('builds a same-origin ICS path from the token', () => {
    const path = buildBookingIcsPath('booking_1')
    expect(path.startsWith('/api/v1/calendar/ics/')).toBe(true)
    const token = decodeURIComponent(path.replace('/api/v1/calendar/ics/', ''))
    expect(verifyBookingCalendarToken(token)).toBe('booking_1')
  })
})
