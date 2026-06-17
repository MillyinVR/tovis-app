// lib/migration/calendarImportServer.test.ts
//
// Tests classification (preview) and materialization (commit) with mocked
// Prisma + the canonical writes. The service matcher runs for real.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  offeringFindMany: vi.fn(),
  locationFindFirst: vi.fn(),
  blockFindFirst: vi.fn(),
  blockCreate: vi.fn(),
  blockDeleteMany: vi.fn(),
  cancelImportedBookingIfPristine: vi.fn(),
  createProBooking: vi.fn(),
  upsertProClient: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    professionalServiceOffering: { findMany: mocks.offeringFindMany },
    professionalLocation: { findFirst: mocks.locationFindFirst },
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

import {
  commitCalendarImport,
  parseCalendarImportRequest,
  previewCalendarImport,
  reconcileRemovedImportedEvents,
} from './calendarImportServer'
import type { NormalizedCalendarEvent } from './calendarImport'

const NOW = new Date('2026-09-01T12:00:00.000Z')
const FUTURE = new Date('2026-09-15T17:00:00.000Z')
const PAST = new Date('2026-08-15T17:00:00.000Z')

function event(overrides: Partial<NormalizedCalendarEvent> & { uid: string }): NormalizedCalendarEvent {
  return {
    uid: overrides.uid,
    start: overrides.start ?? FUTURE,
    end: overrides.end ?? null,
    summary: overrides.summary ?? '',
    attendeeName: overrides.attendeeName ?? null,
    attendeeEmail: overrides.attendeeEmail ?? null,
    isRecurring: overrides.isRecurring ?? false,
  }
}

const OFFERINGS = [
  { id: 'off-hair', serviceId: 'svc-hair', offersInSalon: true, service: { name: 'Haircut' } },
  { id: 'off-color', serviceId: 'svc-color', offersInSalon: false, service: { name: 'Color' } },
]

beforeEach(() => {
  vi.clearAllMocks()
  mocks.offeringFindMany.mockResolvedValue(OFFERINGS)
  mocks.locationFindFirst.mockResolvedValue({ id: 'loc-salon' })
  mocks.blockFindFirst.mockResolvedValue(null)
  mocks.blockCreate.mockResolvedValue({ id: 'block-1' })
  mocks.blockDeleteMany.mockResolvedValue({ count: 1 })
  mocks.cancelImportedBookingIfPristine.mockResolvedValue(1)
  mocks.createProBooking.mockResolvedValue({ booking: { id: 'bk-1' } })
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
      event({ uid: 'history', summary: 'Haircut', start: PAST, attendeeName: 'Jane Doe', attendeeEmail: 'jane@example.com' }),
      event({ uid: 'skip', summary: 'Haircut', start: PAST }),
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
        idempotencyKey: 'import:b1',
        allowOutsideWorkingHours: true,
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
  })

  it('seeds client history for a past event and does not create a booking', async () => {
    const events = [
      event({ uid: 'p1', summary: 'Haircut', start: PAST, attendeeName: 'Jane Doe', attendeeEmail: 'jane@example.com' }),
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

    expect(mocks.blockCreate).not.toHaveBeenCalled()
    expect(result.created.blocks).toBe(0)
    expect(result.skipped).toBe(1)
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

describe('reconcileRemovedImportedEvents', () => {
  it('cancels only pristine imported bookings and deletes held blocks, scoped per UID', async () => {
    const result = await reconcileRemovedImportedEvents({
      professionalId: 'pro-1',
      removedUids: ['gone-1'],
    })

    expect(mocks.cancelImportedBookingIfPristine).toHaveBeenCalledWith({
      professionalId: 'pro-1',
      idempotencyKey: 'import:gone-1',
    })
    expect(mocks.blockDeleteMany).toHaveBeenCalledWith({
      where: { professionalId: 'pro-1', note: { contains: '[import:gone-1]' } },
    })
    expect(result).toEqual({ cancelledBookings: 1, deletedBlocks: 1 })
  })

  it('does nothing for an empty removed list', async () => {
    const result = await reconcileRemovedImportedEvents({ professionalId: 'pro-1', removedUids: [] })
    expect(mocks.cancelImportedBookingIfPristine).not.toHaveBeenCalled()
    expect(mocks.blockDeleteMany).not.toHaveBeenCalled()
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
