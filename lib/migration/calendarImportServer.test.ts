// lib/migration/calendarImportServer.test.ts
//
// Tests classification (preview) and materialization (commit) with mocked
// Prisma + the canonical writes. The service matcher runs for real.
//
// The B9 cases deliberately drive raw ICS TEXT through `parseCalendarFeed` into
// `commitCalendarImport` and assert on the block that comes out the far end.
// That is what makes them A/B-provable against `origin/main`: the event SHAPE
// changed in this card, so a test that constructed events by hand could not run
// against the pre-fix module — one that feeds a file can.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  offeringFindMany: vi.fn(),
  locationFindFirst: vi.fn(),
  profileFindUnique: vi.fn(),
  blockFindFirst: vi.fn(),
  blockCreate: vi.fn(),
  blockDeleteMany: vi.fn(),
  cancelImportedBookingIfPristine: vi.fn(),
  createProBooking: vi.fn(),
  upsertProClient: vi.fn(),
  bumpScheduleVersion: vi.fn(),
  getTimeRangeConflict: vi.fn(),
  logBookingConflict: vi.fn(),
  lockedTransactions: 0,
}))

// The schedule lock is the property under test, not a detail: count every entry
// and hand the callback a tx whose calendarBlock methods are the same mocks, so
// a write that escaped the lock would show up as a create with no transaction.
vi.mock('@/lib/booking/scheduleTransaction', () => ({
  withLockedProfessionalTransaction: <T,>(
    _professionalId: string,
    run: (ctx: { tx: unknown; now: Date }) => Promise<T>,
  ): Promise<T> => {
    mocks.lockedTransactions += 1
    return run({
      tx: {
        calendarBlock: {
          findFirst: mocks.blockFindFirst,
          create: mocks.blockCreate,
        },
      },
      now: new Date(),
    })
  },
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    professionalServiceOffering: { findMany: mocks.offeringFindMany },
    professionalLocation: { findFirst: mocks.locationFindFirst },
    professionalProfile: { findUnique: mocks.profileFindUnique },
    calendarBlock: {
      findFirst: mocks.blockFindFirst,
      create: mocks.blockCreate,
      deleteMany: mocks.blockDeleteMany,
    },
  },
}))

vi.mock('@/lib/booking/writeBoundary', () => ({
  createProBooking: mocks.createProBooking,
  cancelImportedBookingIfPristine: mocks.cancelImportedBookingIfPristine,
}))

vi.mock('@/lib/clients/upsertProClient', () => ({
  upsertProClient: mocks.upsertProClient,
}))

vi.mock('@/lib/booking/cacheVersion', () => ({
  bumpScheduleVersion: mocks.bumpScheduleVersion,
}))

vi.mock('@/lib/booking/conflictQueries', () => ({
  getTimeRangeConflict: mocks.getTimeRangeConflict,
}))

vi.mock('@/lib/booking/conflictLogging', () => ({
  logBookingConflict: mocks.logBookingConflict,
}))

import { Prisma } from '@prisma/client'

import {
  commitCalendarImport,
  parseCalendarImportRequest,
  previewCalendarImport,
  reconcileRemovedImportedEvents,
} from './calendarImportServer'
import { parseCalendarFeed, type NormalizedCalendarEvent } from './calendarImport'

const NOW = new Date('2026-09-01T12:00:00.000Z')
const FUTURE = new Date('2026-09-15T17:00:00.000Z')
const PAST = new Date('2026-08-15T17:00:00.000Z')
const LA = 'America/Los_Angeles'
const BERLIN = 'Europe/Berlin'

function event(
  overrides: Partial<NormalizedCalendarEvent> & { uid: string },
): NormalizedCalendarEvent {
  return {
    uid: overrides.uid,
    time: overrides.time ?? { anchor: 'INSTANT', startUtc: FUTURE, endUtc: null },
    summary: overrides.summary ?? '',
    attendeeName: overrides.attendeeName ?? null,
    attendeeEmail: overrides.attendeeEmail ?? null,
    isRecurring: overrides.isRecurring ?? false,
  }
}

function at(startUtc: Date, endUtc: Date | null = null): NormalizedCalendarEvent['time'] {
  return { anchor: 'INSTANT', startUtc, endUtc }
}

function ics(...veventLines: string[][]): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Test//EN',
    ...veventLines.flatMap((lines) => ['BEGIN:VEVENT', ...lines, 'END:VEVENT']),
    'END:VCALENDAR',
  ].join('\r\n')
}

function allDayIcs(): string {
  return ics([
    'UID:allday@google.com',
    'DTSTART;VALUE=DATE:20260905',
    'DTEND;VALUE=DATE:20260906',
    'SUMMARY:Vacation - closed',
  ])
}

// An event with no matching service and no attendee — the plain BLOCK path.
function unmappedIcs(
  uid: string,
  startUtc: string,
  endUtc: string,
  summary = 'Hot Stone Massage',
): string[] {
  return [
    `UID:${uid}`,
    `DTSTART:${stamp(startUtc)}`,
    `DTEND:${stamp(endUtc)}`,
    `SUMMARY:${summary}`,
  ]
}

// A salon-mappable event with a resolvable client — the BOOKING path.
function bookableIcs(uid: string, startUtc: string, endUtc: string): string[] {
  return [
    `UID:${uid}`,
    `DTSTART:${stamp(startUtc)}`,
    `DTEND:${stamp(endUtc)}`,
    'SUMMARY:Haircut',
    'ATTENDEE;CN=Jane Doe:mailto:jane@example.com',
  ]
}

// ISO → the UTC-stamped iCalendar form (`20260915T170000Z`).
function stamp(iso: string): string {
  return `${iso.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}`
}

const OFFERINGS = [
  { id: 'off-hair', serviceId: 'svc-hair', offersInSalon: true, service: { name: 'Haircut' } },
  { id: 'off-color', serviceId: 'svc-color', offersInSalon: false, service: { name: 'Color' } },
]

function blockData(call = 0): Record<string, unknown> {
  const args = mocks.blockCreate.mock.calls[call]?.[0]
  return (args && typeof args === 'object' && 'data' in args
    ? args.data
    : {}) as Record<string, unknown>
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.lockedTransactions = 0
  mocks.offeringFindMany.mockResolvedValue(OFFERINGS)
  mocks.locationFindFirst.mockResolvedValue({ id: 'loc-salon', timeZone: LA })
  mocks.profileFindUnique.mockResolvedValue({ timeZone: LA })
  mocks.blockFindFirst.mockResolvedValue(null)
  mocks.blockCreate.mockResolvedValue({ id: 'block-1' })
  mocks.blockDeleteMany.mockResolvedValue({ count: 1 })
  mocks.cancelImportedBookingIfPristine.mockResolvedValue(1)
  mocks.createProBooking.mockResolvedValue({
    booking: { id: 'bk-1' },
    meta: { mutated: true, noOp: false },
  })
  mocks.getTimeRangeConflict.mockResolvedValue(null)
  mocks.upsertProClient.mockResolvedValue({
    ok: true,
    clientId: 'client-1',
    userId: null,
    email: 'jane@example.com',
    claimStatus: 'UNCLAIMED',
  })
})

describe('previewCalendarImport', () => {
  it('classifies each event by clock, service match, mode, and client', async () => {
    const events = [
      event({ uid: 'booking', summary: 'Haircut', attendeeName: 'Jane Doe', attendeeEmail: 'jane@example.com' }),
      event({ uid: 'unmapped', summary: 'Hot Stone Massage', attendeeName: 'Jane Doe', attendeeEmail: 'jane@example.com' }),
      event({ uid: 'mobile', summary: 'Color', attendeeName: 'Jane Doe', attendeeEmail: 'jane@example.com' }),
      event({ uid: 'history', summary: 'Haircut', time: at(PAST), attendeeName: 'Jane Doe', attendeeEmail: 'jane@example.com' }),
      event({ uid: 'skip', summary: 'Haircut', time: at(PAST) }),
    ]

    const preview = await previewCalendarImport({ professionalId: 'pro-1', events, now: NOW })
    const byUid = new Map(preview.rows.map((r) => [r.uid, r]))

    expect(byUid.get('booking')?.classification).toBe('BOOKING')
    expect(byUid.get('booking')?.matchedServiceName).toBe('Haircut')
    expect(byUid.get('unmapped')?.classification).toBe('BLOCK')
    expect(byUid.get('mobile')?.classification).toBe('BLOCK')
    expect(byUid.get('history')?.classification).toBe('HISTORY')
    expect(byUid.get('skip')?.classification).toBe('SKIP')

    expect(preview.summary).toEqual({ total: 5, bookings: 1, blocks: 2, history: 1, skipped: 1 })
  })

  it.each([
    { zone: LA, start: '2026-09-05T07:00:00.000Z', end: '2026-09-06T07:00:00.000Z' },
    { zone: BERLIN, start: '2026-09-04T22:00:00.000Z', end: '2026-09-05T22:00:00.000Z' },
  ])('previews an all-day event on the pro’s clock in $zone, not the server’s', async ({
    zone,
    start,
    end,
  }) => {
    mocks.locationFindFirst.mockResolvedValue({ id: 'loc-salon', timeZone: zone })
    const events = parseCalendarFeed(allDayIcs())

    const preview = await previewCalendarImport({ professionalId: 'pro-1', events, now: NOW })

    expect(preview.rows[0]?.start).toBe(start)
    expect(preview.rows[0]?.end).toBe(end)
  })
})

describe('commitCalendarImport', () => {
  it('creates a silent IMPORTED booking for a salon-mapped future event', async () => {
    const events = [
      event({ uid: 'b1', summary: 'Haircut', attendeeName: 'Jane Doe', attendeeEmail: 'jane@example.com' }),
    ]

    const result = await commitCalendarImport({
      professionalId: 'pro-1',
      actorUserId: 'user-1',
      events,
      now: NOW,
    })

    expect(mocks.createProBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        professionalId: 'pro-1',
        clientId: 'client-1',
        offeringId: 'off-hair',
        locationId: 'loc-salon',
        locationType: 'SALON',
        importMode: true,
        idempotencyKey: 'import:pro-1:b1',
        allowOutsideWorkingHours: true,
        scheduledFor: FUTURE,
      }),
    )
    expect(result.created.bookings).toBe(1)
  })

  it('falls back to a held block when booking creation fails (e.g. STEP_MISMATCH)', async () => {
    const bookingError: Error & { code?: string } = new Error('off grid')
    bookingError.code = 'STEP_MISMATCH'
    mocks.createProBooking.mockRejectedValueOnce(bookingError)
    const events = [
      event({ uid: 'b1', summary: 'Haircut', attendeeName: 'Jane Doe', attendeeEmail: 'jane@example.com' }),
    ]

    const result = await commitCalendarImport({
      professionalId: 'pro-1',
      actorUserId: 'user-1',
      events,
      now: NOW,
    })

    expect(mocks.createProBooking).toHaveBeenCalledTimes(1)
    expect(mocks.blockCreate).toHaveBeenCalledTimes(1)
    expect(result.created.bookings).toBe(0)
    expect(result.created.blocks).toBe(1)
    expect(result.failed).toBe(0)
  })

  it('holds the time as a block when the only salon location is missing', async () => {
    mocks.locationFindFirst.mockResolvedValue(null)
    const events = [
      event({ uid: 'b1', summary: 'Haircut', attendeeName: 'Jane Doe', attendeeEmail: 'jane@example.com' }),
    ]

    const result = await commitCalendarImport({
      professionalId: 'pro-1',
      actorUserId: 'user-1',
      events,
      now: NOW,
    })

    expect(mocks.createProBooking).not.toHaveBeenCalled()
    expect(mocks.blockCreate).toHaveBeenCalledTimes(1)
    expect(result.created.blocks).toBe(1)

    // Imported bookings bump inside the write boundary, but imported BLOCKS are
    // written here — a block-only import would otherwise leave availability
    // offering the time the import just took.
    expect(mocks.bumpScheduleVersion).toHaveBeenCalledWith('pro-1')
  })

  it('seeds client history for a past event and does not create a booking', async () => {
    const events = [
      event({ uid: 'p1', summary: 'Haircut', time: at(PAST), attendeeName: 'Jane Doe', attendeeEmail: 'jane@example.com' }),
    ]

    const result = await commitCalendarImport({
      professionalId: 'pro-1',
      actorUserId: 'user-1',
      events,
      now: NOW,
    })

    expect(mocks.upsertProClient).toHaveBeenCalledTimes(1)
    expect(mocks.createProBooking).not.toHaveBeenCalled()
    expect(result.created.history).toBe(1)
  })

  it('is idempotent on blocks: skips creating a block that already exists for the UID', async () => {
    mocks.blockFindFirst.mockResolvedValue({ id: 'existing-block' })
    const events = [event({ uid: 'u1', summary: 'Hot Stone Massage' })]

    const result = await commitCalendarImport({
      professionalId: 'pro-1',
      actorUserId: 'user-1',
      events,
      now: NOW,
    })

    expect(mocks.blockFindFirst).toHaveBeenCalledWith({
      where: { professionalId: 'pro-1', importedEventUid: 'u1' },
      select: { id: true },
    })
    expect(mocks.blockCreate).not.toHaveBeenCalled()
    expect(result.created.blocks).toBe(0)
    expect(result.skipped).toBe(1)

    // A re-run that wrote nothing must not invalidate: import is idempotent and
    // pros re-sync on a timer, so bumping here would cold-start the cache on
    // every no-op sync.
    expect(mocks.bumpScheduleVersion).not.toHaveBeenCalled()
  })

  it('honors excludeUids', async () => {
    const events = [
      event({ uid: 'b1', summary: 'Haircut', attendeeName: 'Jane Doe', attendeeEmail: 'jane@example.com' }),
    ]

    const result = await commitCalendarImport({
      professionalId: 'pro-1',
      actorUserId: 'user-1',
      events,
      excludeUids: ['b1'],
      now: NOW,
    })

    expect(mocks.createProBooking).not.toHaveBeenCalled()
    expect(result.skipped).toBe(1)
  })
})

describe('commitCalendarImport — whose clock the feed is on (B9)', () => {
  // Two zones, because a host that happens to share the pro's zone lets the
  // pre-fix code pass by accident ([[your-machine-already-satisfies-the-condition]]).
  it.each([
    { zone: LA, startsAt: '2026-09-05T07:00:00.000Z', endsAt: '2026-09-06T07:00:00.000Z' },
    { zone: BERLIN, startsAt: '2026-09-04T22:00:00.000Z', endsAt: '2026-09-05T22:00:00.000Z' },
  ])(
    'blocks an all-day event as the pro’s whole local day in $zone',
    async ({ zone, startsAt, endsAt }) => {
      mocks.locationFindFirst.mockResolvedValue({ id: 'loc-salon', timeZone: zone })
      const events = parseCalendarFeed(
        ics([
          'UID:allday@google.com',
          'DTSTART;VALUE=DATE:20260905',
          'DTEND;VALUE=DATE:20260906',
          'SUMMARY:Vacation - closed',
        ]),
      )

      const result = await commitCalendarImport({
        professionalId: 'pro-1',
        actorUserId: 'user-1',
        events,
        now: NOW,
      })

      expect(result.created.blocks).toBe(1)
      expect(blockData()).toMatchObject({
        startsAt: new Date(startsAt),
        endsAt: new Date(endsAt),
      })
    },
  )

  it('books a TZID event at the instant the feed pinned, unchanged', async () => {
    const events = parseCalendarFeed(
      ics([
        'UID:tzid@google.com',
        'DTSTART;TZID=America/Los_Angeles:20260915T140000',
        'DTEND;TZID=America/Los_Angeles:20260915T153000',
        'SUMMARY:Haircut',
        'ATTENDEE;CN=Jane Doe:mailto:jane@example.com',
      ]),
    )

    await commitCalendarImport({
      professionalId: 'pro-1',
      actorUserId: 'user-1',
      events,
      now: NOW,
    })

    expect(mocks.createProBooking).toHaveBeenCalledWith(
      expect.objectContaining({ scheduledFor: new Date('2026-09-15T21:00:00.000Z') }),
    )
  })

  it('still holds the rest of today when the pro is closed today', async () => {
    // Two bugs met here. The old anchoring made a Los Angeles pro's all-day
    // event start at 17:00 the PREVIOUS day; and classification asked whether
    // the event had STARTED, so a day-off marker was "past" from its first
    // minute either way. A closure covering today was therefore skipped
    // outright, leaving the pro's remaining working hours bookable.
    const events = parseCalendarFeed(
      ics(['UID:today@google.com', 'DTSTART;VALUE=DATE:20260901', 'SUMMARY:Closed today']),
    )

    const result = await commitCalendarImport({
      professionalId: 'pro-1',
      actorUserId: 'user-1',
      events,
      // 09:00 in Los Angeles on the day the event covers — nine hours after the
      // local midnight the event starts at.
      now: new Date('2026-09-01T16:00:00.000Z'),
    })

    expect(result.skipped).toBe(0)
    expect(result.created.blocks).toBe(1)
    expect(blockData()).toMatchObject({
      startsAt: new Date('2026-09-01T07:00:00.000Z'),
      endsAt: new Date('2026-09-02T07:00:00.000Z'),
    })
  })

  it('bins an event as history only once it has ENDED', async () => {
    const events = parseCalendarFeed(
      ics([
        'UID:ended@google.com',
        'DTSTART;TZID=America/Los_Angeles:20260901T040000',
        'DTEND;TZID=America/Los_Angeles:20260901T050000',
        'SUMMARY:Haircut',
        'ATTENDEE;CN=Jane Doe:mailto:jane@example.com',
      ]),
    )

    // 05:30 in Los Angeles: half an hour after it ended.
    const ended = await commitCalendarImport({
      professionalId: 'pro-1',
      actorUserId: 'user-1',
      events,
      now: new Date('2026-09-01T12:30:00.000Z'),
    })
    expect(ended.created.history).toBe(1)
    expect(ended.created.blocks).toBe(0)

    // 04:30, while it is running: the remaining half hour is still the pro's.
    vi.clearAllMocks()
    mocks.offeringFindMany.mockResolvedValue(OFFERINGS)
    mocks.locationFindFirst.mockResolvedValue({ id: 'loc-salon', timeZone: LA })
    mocks.profileFindUnique.mockResolvedValue({ timeZone: LA })
    mocks.blockFindFirst.mockResolvedValue(null)
    mocks.blockCreate.mockResolvedValue({ id: 'block-1' })
    mocks.getTimeRangeConflict.mockResolvedValue(null)
    const inPast: Error & { code?: string } = new Error('past')
    inPast.code = 'TIME_IN_PAST'
    mocks.createProBooking.mockRejectedValueOnce(inPast)
    mocks.upsertProClient.mockResolvedValue({
      ok: true,
      clientId: 'client-1',
      userId: null,
      email: 'jane@example.com',
      claimStatus: 'UNCLAIMED',
    })

    const running = await commitCalendarImport({
      professionalId: 'pro-1',
      actorUserId: 'user-1',
      events,
      now: new Date('2026-09-01T11:30:00.000Z'),
    })
    expect(running.created.history).toBe(0)
    expect(running.created.blocks).toBe(1)
    expect(String(blockData().note)).toContain('already started — needs review')
  })

  it('falls back to the professional’s zone when no location has one', async () => {
    mocks.locationFindFirst.mockResolvedValue(null)
    mocks.profileFindUnique.mockResolvedValue({ timeZone: BERLIN })
    const events = parseCalendarFeed(
      ics(['UID:allday@google.com', 'DTSTART;VALUE=DATE:20260905', 'SUMMARY:Closed']),
    )

    await commitCalendarImport({
      professionalId: 'pro-1',
      actorUserId: 'user-1',
      events,
      now: NOW,
    })

    expect(blockData()).toMatchObject({ startsAt: new Date('2026-09-04T22:00:00.000Z') })
  })
})

describe('commitCalendarImport — the held block is a real claim on the calendar', () => {
  it('writes every block under the professional’s schedule lock', async () => {
    const events = parseCalendarFeed(
      ics(
        unmappedIcs('u1', '2026-09-15T17:00:00.000Z', '2026-09-15T18:00:00.000Z'),
        unmappedIcs('u2', '2026-09-16T17:00:00.000Z', '2026-09-16T18:00:00.000Z', 'Reiki'),
      ),
    )

    await commitCalendarImport({
      professionalId: 'pro-1',
      actorUserId: 'user-1',
      events,
      now: NOW,
    })

    expect(mocks.blockCreate).toHaveBeenCalledTimes(2)
    // One lock per block, not one for the whole import: holding the pro's lock
    // across a thousand-event feed would queue their real bookings behind it.
    expect(mocks.lockedTransactions).toBe(2)
  })

  it('runs the same conflict read every other block writer runs', async () => {
    const events = parseCalendarFeed(
      ics(unmappedIcs('u1', '2026-09-15T17:00:00.000Z', '2026-09-15T18:00:00.000Z')),
    )

    await commitCalendarImport({
      professionalId: 'pro-1',
      actorUserId: 'user-1',
      events,
      now: NOW,
    })

    expect(mocks.getTimeRangeConflict).toHaveBeenCalledWith(
      expect.objectContaining({
        professionalId: 'pro-1',
        // The import holds the pro's own time, so the block — and the question —
        // apply at every location.
        locationId: null,
        requestedStart: new Date('2026-09-15T17:00:00.000Z'),
        requestedEnd: new Date('2026-09-15T18:00:00.000Z'),
        defaultBufferMinutes: 0,
      }),
    )
  })

  it('still holds the time when it overlaps a real booking, and says so', async () => {
    // Tori's call (2026-07-25): warn, don't refuse. `overlapPolicy.ts` already
    // promises the pro this block ("held as blocked time for you to review"), so
    // the ALLOW is pinned deliberately — a future refusal is a product change.
    mocks.getTimeRangeConflict.mockResolvedValue('BOOKING')
    const events = parseCalendarFeed(
      ics(
        unmappedIcs(
          'u1',
          '2026-09-15T17:00:00.000Z',
          '2026-09-15T18:00:00.000Z',
          'Colour touch-up',
        ),
      ),
    )

    const result = await commitCalendarImport({
      professionalId: 'pro-1',
      actorUserId: 'user-1',
      events,
      now: NOW,
    })

    expect(result.created.blocks).toBe(1)
    expect(blockData().note).toContain('Overlaps an existing appointment.')
    expect(mocks.logBookingConflict).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'BLOCK_CREATE', conflictType: 'BOOKING' }),
    )
  })

  // A guard, not a bug pin: the pre-fix note said nothing about an overlap
  // either — because it never asked. Stated so it is not over-claimed.
  it('says nothing about an overlap when there is none', async () => {
    const events = parseCalendarFeed(
      ics(
        unmappedIcs(
          'u1',
          '2026-09-15T17:00:00.000Z',
          '2026-09-15T18:00:00.000Z',
          'Colour touch-up',
        ),
      ),
    )

    await commitCalendarImport({
      professionalId: 'pro-1',
      actorUserId: 'user-1',
      events,
      now: NOW,
    })

    expect(blockData().note).not.toContain('Overlaps')
    expect(mocks.logBookingConflict).not.toHaveBeenCalled()
  })

  it('keeps internal identifiers and error codes out of the note', async () => {
    // The note is rendered as the block's TITLE on the pro calendar
    // (app/api/v1/pro/calendar/route.ts), so it is user-facing copy. It used to
    // read "… [import:uid@google.com] (imported appointment needs review
    // (TIME_BOOKED))".
    //
    // `TIME_BOOKED` is what an import overlap actually arrives as — the overlap
    // policy's `IMPORT_OVERLAP_NOT_ALLOWED` is folded into it by
    // `mapBookingOverlapBlockedCodeToBookingError` (writeBoundary.ts:5139)
    // before the importer's catch ever sees it.
    const bookingError: Error & { code?: string } = new Error('overlap')
    bookingError.code = 'TIME_BOOKED'
    mocks.createProBooking.mockRejectedValueOnce(bookingError)
    const events = parseCalendarFeed(
      ics(bookableIcs('uid@google.com', '2026-09-15T17:00:00.000Z', '2026-09-15T18:00:00.000Z')),
    )

    await commitCalendarImport({
      professionalId: 'pro-1',
      actorUserId: 'user-1',
      events,
      now: NOW,
    })

    const note = String(blockData().note)
    expect(note).not.toContain('import:')
    expect(note).not.toContain('TIME_BOOKED')
    expect(note).toContain('Haircut — Jane Doe')
    expect(note).toContain('imported over an existing appointment — needs review')
    // The source UID lives in its own column, where a pro editing the note
    // cannot orphan the block from its event.
    expect(blockData().importedEventUid).toBe('uid@google.com')
  })

  it('maps an unrecognised failure code to the generic line', async () => {
    const bookingError: Error & { code?: string } = new Error('boom')
    bookingError.code = 'SOME_NEW_INTERNAL_CODE'
    mocks.createProBooking.mockRejectedValueOnce(bookingError)
    const events = parseCalendarFeed(
      ics(bookableIcs('b1', '2026-09-15T17:00:00.000Z', '2026-09-15T18:00:00.000Z')),
    )

    await commitCalendarImport({
      professionalId: 'pro-1',
      actorUserId: 'user-1',
      events,
      now: NOW,
    })

    const note = String(blockData().note)
    expect(note).not.toContain('SOME_NEW_INTERNAL_CODE')
    expect(note).toContain('imported appointment — needs review')
  })

  it('treats a unique-index collision as an idempotent skip, not a failure', async () => {
    mocks.blockCreate.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    )
    const events = parseCalendarFeed(
      ics(unmappedIcs('u1', '2026-09-15T17:00:00.000Z', '2026-09-15T18:00:00.000Z')),
    )

    const result = await commitCalendarImport({
      professionalId: 'pro-1',
      actorUserId: 'user-1',
      events,
      now: NOW,
    })

    expect(result.created.blocks).toBe(0)
    expect(result.skipped).toBe(1)
    expect(result.failed).toBe(0)
  })

  it('refuses to hold an implausibly long event rather than shortening it', async () => {
    const events = parseCalendarFeed(
      ics(unmappedIcs('forever@x', '2026-09-15T17:00:00.000Z', '2030-01-01T00:00:00.000Z', 'Busy')),
    )

    const result = await commitCalendarImport({
      professionalId: 'pro-1',
      actorUserId: 'user-1',
      events,
      now: NOW,
    })

    expect(mocks.blockCreate).not.toHaveBeenCalled()
    expect(result.created.blocks).toBe(0)
    expect(result.skipped).toBe(1)
  })
})

describe('commitCalendarImport — an idempotent replay is not a creation', () => {
  it('counts a replayed booking as skipped, not created', async () => {
    // Driven on the running server: a second commit of the same feed answered
    // `bookings: 1` again, because the boundary's idempotency short-circuit
    // returns the EXISTING booking and every success was counted as a create.
    // The resync writes this into `lastSyncCounts` hourly
    // ([[cron-populated-signal-honesty]]).
    mocks.createProBooking.mockResolvedValue({
      booking: { id: 'bk-1' },
      meta: { mutated: false, noOp: true },
    })
    const events = parseCalendarFeed(
      ics(bookableIcs('b1', '2026-09-15T17:00:00.000Z', '2026-09-15T18:00:00.000Z')),
    )

    const result = await commitCalendarImport({
      professionalId: 'pro-1',
      actorUserId: 'user-1',
      events,
      now: NOW,
    })

    expect(result.created.bookings).toBe(0)
    expect(result.skipped).toBe(1)
    expect(result.failed).toBe(0)
  })
})

describe('commitCalendarImport — the per-run event ceiling', () => {
  function manyEvents(count: number): NormalizedCalendarEvent[] {
    const events = parseCalendarFeed(
      ics(
        ...Array.from({ length: count }, (_, i) =>
          unmappedIcs(
            `u${i}`,
            new Date(FUTURE.getTime() + i * 3_600_000).toISOString(),
            new Date(FUTURE.getTime() + i * 3_600_000 + 1_800_000).toISOString(),
          ),
        ),
      ),
    )
    // Guard the fixture itself: a parser that dropped rows would make the
    // ceiling assertions below pass for the wrong reason.
    expect(events).toHaveLength(count)
    return events
  }

  it('imports up to the ceiling and reports the overflow as skipped', async () => {
    const result = await commitCalendarImport({
      professionalId: 'pro-1',
      actorUserId: 'user-1',
      events: manyEvents(1_003),
      now: NOW,
    })

    expect(result.created.blocks).toBe(1_000)
    // Reported, not silently dropped: a bounded run that claimed to have
    // imported everything would read as a complete import.
    expect(result.skipped).toBe(3)
  })

  it('counts the whole feed in a preview’s total even when it bounds the rows', async () => {
    const preview = await previewCalendarImport({
      professionalId: 'pro-1',
      events: manyEvents(1_002),
      now: NOW,
    })

    expect(preview.rows).toHaveLength(1_000)
    expect(preview.summary.total).toBe(1_002)
    expect(preview.summary.skipped).toBe(2)
  })
})

describe('reconcileRemovedImportedEvents', () => {
  it('cancels only pristine imported bookings and deletes held blocks, scoped per UID', async () => {
    const result = await reconcileRemovedImportedEvents({
      professionalId: 'pro-1',
      removedUids: ['gone-1'],
    })

    expect(mocks.cancelImportedBookingIfPristine).toHaveBeenCalledWith({
      professionalId: 'pro-1',
      idempotencyKey: 'import:pro-1:gone-1',
    })
    // Keyed on the column, not on a `contains` match against the pro-editable
    // note — renaming a block used to make it un-removable.
    expect(mocks.blockDeleteMany).toHaveBeenCalledWith({
      where: { professionalId: 'pro-1', importedEventUid: 'gone-1' },
    })
    expect(result).toEqual({ cancelledBookings: 1, deletedBlocks: 1 })

    // Deleting the held blocks RELEASES that time; a resync that only removed
    // blocks would otherwise keep the freed slots hidden.
    expect(mocks.bumpScheduleVersion).toHaveBeenCalledWith('pro-1')
  })

  it('does nothing for an empty removed list', async () => {
    const result = await reconcileRemovedImportedEvents({ professionalId: 'pro-1', removedUids: [] })
    expect(mocks.cancelImportedBookingIfPristine).not.toHaveBeenCalled()
    expect(mocks.blockDeleteMany).not.toHaveBeenCalled()
    expect(mocks.bumpScheduleVersion).not.toHaveBeenCalled()
    expect(result).toEqual({ cancelledBookings: 0, deletedBlocks: 0 })
  })
})

describe('parseCalendarImportRequest', () => {
  it('requires non-empty ics text', () => {
    expect(parseCalendarImportRequest(null)).toBeNull()
    expect(parseCalendarImportRequest({ ics: '   ' })).toBeNull()
  })

  it('parses ics text and optional excludeUids', () => {
    const parsed = parseCalendarImportRequest({ ics: 'BEGIN:VCALENDAR', excludeUids: ['a', 1, 'b'] })
    expect(parsed?.icsText).toBe('BEGIN:VCALENDAR')
    expect(parsed?.excludeUids).toEqual(['a', 'b'])
  })
})
