// lib/migration/calendarImport.test.ts
//
// The anchor cases below pin what `node-ical` ACTUALLY returns for each way
// iCalendar can stamp a time, captured from a Google-shaped export rather than
// assumed ([[wire-shape-vs-mock-drift]]). They are the producer half of the B9
// fix: `calendarEventTime.test.ts` covers what each anchor then resolves to.

import { describe, expect, it } from 'vitest'

import { parseCalendarFeed } from './calendarImport'

function ics(...lines: string[]): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Test//EN',
    ...lines,
    'END:VCALENDAR',
  ].join('\r\n')
}

function vevent(...lines: string[]): string[] {
  return ['BEGIN:VEVENT', ...lines, 'END:VEVENT']
}

// The VTIMEZONE block a real Google / Apple export carries.
const LA_VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  'TZID:America/Los_Angeles',
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:-0800',
  'TZOFFSETTO:-0700',
  'TZNAME:PDT',
  'DTSTART:19700308T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:-0700',
  'TZOFFSETTO:-0800',
  'TZNAME:PST',
  'DTSTART:19701101T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
]

describe('parseCalendarFeed', () => {
  it('returns [] for empty or non-string input', () => {
    expect(parseCalendarFeed('')).toEqual([])
    expect(parseCalendarFeed('   ')).toEqual([])
  })

  it('normalizes a basic event with an attendee (CN + mailto)', () => {
    const feed = ics(
      ...vevent(
        'UID:evt-1@vagaro',
        'DTSTART:20260901T170000Z',
        'DTEND:20260901T180000Z',
        'SUMMARY:Color – Jane D.',
        'ATTENDEE;CN=Jane Doe:mailto:jane@example.com',
      ),
    )
    const events = parseCalendarFeed(feed)

    expect(events).toHaveLength(1)
    const event = events[0]
    expect(event?.uid).toBe('evt-1@vagaro')
    expect(event?.summary).toBe('Color – Jane D.')
    expect(event?.attendeeName).toBe('Jane Doe')
    expect(event?.attendeeEmail).toBe('jane@example.com')
    expect(event?.isRecurring).toBe(false)
    expect(event?.time).toEqual({
      anchor: 'INSTANT',
      startUtc: new Date('2026-09-01T17:00:00.000Z'),
      endUtc: new Date('2026-09-01T18:00:00.000Z'),
    })
  })

  it('skips events missing a UID or start', () => {
    const feed = ics(
      ...vevent('DTSTART:20260901T170000Z', 'SUMMARY:No UID'),
      ...vevent('UID:no-start@x', 'SUMMARY:No start'),
      ...vevent('UID:ok@x', 'DTSTART:20260901T170000Z', 'SUMMARY:Keeper'),
    )
    const events = parseCalendarFeed(feed)
    expect(events.map((e) => e.uid)).toEqual(['ok@x'])
  })

  it('handles a missing end and a missing attendee', () => {
    const feed = ics(
      ...vevent('UID:noend@x', 'DTSTART:20260901T170000Z', 'SUMMARY:Walk-in'),
    )
    const events = parseCalendarFeed(feed)
    expect(events[0]?.time).toEqual({
      anchor: 'INSTANT',
      startUtc: new Date('2026-09-01T17:00:00.000Z'),
      endUtc: null,
    })
    expect(events[0]?.attendeeName).toBeNull()
    expect(events[0]?.attendeeEmail).toBeNull()
  })

  it('flags recurring events rather than expanding them', () => {
    const feed = ics(
      ...vevent(
        'UID:weekly@x',
        'DTSTART:20260901T170000Z',
        'DTEND:20260901T180000Z',
        'RRULE:FREQ=WEEKLY;COUNT=10',
        'SUMMARY:Standing appt',
      ),
    )
    const events = parseCalendarFeed(feed)
    expect(events).toHaveLength(1)
    expect(events[0]?.isRecurring).toBe(true)
  })

  it('does not throw on malformed input', () => {
    expect(parseCalendarFeed('not a calendar at all')).toEqual([])
  })
})

describe('parseCalendarFeed — which clock each stamp is on', () => {
  it('reads a TZID stamp as an absolute instant', () => {
    const events = parseCalendarFeed(
      ics(
        ...LA_VTIMEZONE,
        ...vevent(
          'UID:tzid@google.com',
          'DTSTART;TZID=America/Los_Angeles:20260801T140000',
          'DTEND;TZID=America/Los_Angeles:20260801T153000',
          'SUMMARY:Balayage',
        ),
      ),
    )

    expect(events[0]?.time).toEqual({
      anchor: 'INSTANT',
      startUtc: new Date('2026-08-01T21:00:00.000Z'),
      endUtc: new Date('2026-08-01T22:30:00.000Z'),
    })
  })

  it('reads an all-day (VALUE=DATE) stamp as a calendar DATE, DTEND exclusive', () => {
    // The B9 defect lived here: node-ical builds this from the HOST's midnight,
    // so taking its `Date` at face value made a day off start and end seven
    // hours out for a Los Angeles pro.
    const events = parseCalendarFeed(
      ics(
        ...LA_VTIMEZONE,
        ...vevent(
          'UID:allday@google.com',
          'DTSTART;VALUE=DATE:20260805',
          'DTEND;VALUE=DATE:20260806',
          'SUMMARY:Vacation - closed',
        ),
      ),
    )

    expect(events[0]?.time).toEqual({
      anchor: 'LOCAL_DATE',
      startDate: { year: 2026, month: 8, day: 5 },
      endDateExclusive: { year: 2026, month: 8, day: 6 },
    })
  })

  it('reads a multi-day all-day stamp as its full date span', () => {
    const events = parseCalendarFeed(
      ics(
        ...vevent(
          'UID:conf@google.com',
          'DTSTART;VALUE=DATE:20260810',
          'DTEND;VALUE=DATE:20260813',
          'SUMMARY:Conference',
        ),
      ),
    )

    expect(events[0]?.time).toEqual({
      anchor: 'LOCAL_DATE',
      startDate: { year: 2026, month: 8, day: 10 },
      endDateExclusive: { year: 2026, month: 8, day: 13 },
    })
  })

  it('gets RFC 5545’s one-day default for an all-day stamp with no DTEND', () => {
    // Measured, not assumed: node-ical applies the DATE default duration itself
    // and hands back DTEND = the next date. Worth pinning — the first draft of
    // this test asserted `null` here ([[enumerate-producer-before-reusing-parser]]).
    const events = parseCalendarFeed(
      ics(...vevent('UID:oneday@x', 'DTSTART;VALUE=DATE:20260805', 'SUMMARY:Closed')),
    )

    expect(events[0]?.time).toEqual({
      anchor: 'LOCAL_DATE',
      startDate: { year: 2026, month: 8, day: 5 },
      endDateExclusive: { year: 2026, month: 8, day: 6 },
    })
  })

  it('drops an unusable DTEND, leaving the resolver to take the whole day', () => {
    const events = parseCalendarFeed(
      ics(
        ...vevent(
          'UID:badend@x',
          'DTSTART;VALUE=DATE:20260805',
          'DTEND;VALUE=DATE:notadate',
          'SUMMARY:Closed',
        ),
      ),
    )

    expect(events[0]?.time).toEqual({
      anchor: 'LOCAL_DATE',
      startDate: { year: 2026, month: 8, day: 5 },
      endDateExclusive: null,
    })
  })

  it('reads a floating stamp in a feed with NO VTIMEZONE as a wall clock', () => {
    const events = parseCalendarFeed(
      ics(
        ...vevent(
          'UID:floating@x',
          'DTSTART:20260807T100000',
          'DTEND:20260807T110000',
          'SUMMARY:Floating consult',
        ),
      ),
    )

    expect(events[0]?.time).toEqual({
      anchor: 'LOCAL_WALL',
      start: { year: 2026, month: 8, day: 7, hour: 10, minute: 0 },
      end: { year: 2026, month: 8, day: 7, hour: 11, minute: 0 },
    })
  })

  it('lets a feed’s own VTIMEZONE pin an otherwise-floating stamp', () => {
    // node-ical's documented fallback: a floating DTSTART inside a calendar that
    // declares a VTIMEZONE is read in that zone. Pinned because it decides which
    // anchor the parser reports, and it is the feed's intent — not the host's.
    const events = parseCalendarFeed(
      ics(
        ...LA_VTIMEZONE,
        ...vevent(
          'UID:floating-with-vtz@x',
          'DTSTART:20260807T100000',
          'DTEND:20260807T110000',
          'SUMMARY:Floating inside a zoned calendar',
        ),
      ),
    )

    expect(events[0]?.time).toEqual({
      anchor: 'INSTANT',
      startUtc: new Date('2026-08-07T17:00:00.000Z'),
      endUtc: new Date('2026-08-07T18:00:00.000Z'),
    })
  })

  it('ignores a DTEND whose anchor disagrees with DTSTART’s', () => {
    // Malformed, but real exports do it. Mixing a wall clock with an instant
    // would produce a window that is neither.
    const events = parseCalendarFeed(
      ics(
        ...vevent(
          'UID:mixed@x',
          'DTSTART;VALUE=DATE:20260805',
          'DTEND:20260806T170000Z',
          'SUMMARY:Mixed anchors',
        ),
      ),
    )

    expect(events[0]?.time).toEqual({
      anchor: 'LOCAL_DATE',
      startDate: { year: 2026, month: 8, day: 5 },
      endDateExclusive: null,
    })
  })
})
