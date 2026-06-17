// lib/migration/calendarImport.test.ts

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
    expect(event?.start.toISOString()).toBe('2026-09-01T17:00:00.000Z')
    expect(event?.end?.toISOString()).toBe('2026-09-01T18:00:00.000Z')
    expect(event?.isRecurring).toBe(false)
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
    expect(events[0]?.end).toBeNull()
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
