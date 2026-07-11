// lib/aftercare/loadClientAftercareInbox.test.ts
//
// The aftercare inbox loader is the shared SSOT behind both the web
// /client/aftercare page and GET /api/v1/client/aftercare (native). These tests
// mock only Prisma + the two enrichment helpers (buildClientBookingDTO,
// loadBookingBeforeAfterThumbs) and exercise the REAL public-display-name +
// timezone resolvers, proving the row mapping (title/pro fallback, unread flag,
// ISO conversion, before/after pairing, rebook-hint discriminator).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AftercareRebookMode } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  prisma: { clientNotification: { findMany: vi.fn() } },
  buildClientBookingDTO: vi.fn(),
  loadBookingBeforeAfterThumbs: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }))
vi.mock('@/lib/dto/clientBooking', () => ({
  buildClientBookingDTO: mocks.buildClientBookingDTO,
}))
vi.mock('@/lib/media/bookingBeforeAfter', () => ({
  loadBookingBeforeAfterThumbs: mocks.loadBookingBeforeAfterThumbs,
}))

import {
  aftercareInboxHintMode,
  loadClientAftercareInbox,
} from './loadClientAftercareInbox'

const BEFORE_AFTER = {
  beforeUrl: 'https://cdn/b.jpg',
  afterUrl: 'https://cdn/a.jpg',
  beforeFullUrl: 'https://cdn/b-full.jpg',
  afterFullUrl: 'https://cdn/a-full.jpg',
}

type NotifOverrides = {
  id?: string
  title?: string | null
  body?: string | null
  readAt?: Date | null
  createdAt?: Date
  bookingId?: string | null
  aftercareId?: string | null
  booking?: unknown
  aftercare?: { rebookMode: AftercareRebookMode | null; rebookedFor: Date | null } | null
}

function makeNotif(o: NotifOverrides = {}) {
  return {
    id: o.id ?? 'ntf_1',
    title: o.title ?? 'Balayage',
    body: o.body ?? 'Wash after 48h.',
    readAt: o.readAt ?? null,
    createdAt: o.createdAt ?? new Date('2026-07-09T15:00:00.000Z'),
    bookingId: o.bookingId ?? 'bk_1',
    aftercareId: o.aftercareId ?? 'ac_1',
    booking: 'booking' in o ? o.booking : { id: 'bk_1', consultationApproval: null },
    aftercare:
      'aftercare' in o
        ? o.aftercare
        : { rebookMode: AftercareRebookMode.NONE, rebookedFor: null },
  }
}

function makeDto(over: Record<string, unknown> = {}) {
  return {
    id: 'bk_1',
    scheduledFor: '2026-07-09T14:30:00.000Z',
    timeZone: 'America/New_York',
    display: { title: 'Balayage + Toner' },
    professional: {
      id: 'pro_1',
      businessName: 'Glow Studio',
      firstName: 'Ada',
      lastName: 'Lee',
      handle: 'glow',
      nameDisplay: 'BUSINESS_NAME',
    },
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.loadBookingBeforeAfterThumbs.mockResolvedValue(new Map())
})

describe('loadClientAftercareInbox', () => {
  it('returns an empty list when the client has no aftercare notifications', async () => {
    mocks.prisma.clientNotification.findMany.mockResolvedValue([])
    const rows = await loadClientAftercareInbox('cl_1')
    expect(rows).toEqual([])
    expect(mocks.loadBookingBeforeAfterThumbs).toHaveBeenCalledWith([])
  })

  it('maps an enriched row using the booking DTO + before/after pair', async () => {
    mocks.prisma.clientNotification.findMany.mockResolvedValue([makeNotif()])
    mocks.buildClientBookingDTO.mockResolvedValue(makeDto())
    mocks.loadBookingBeforeAfterThumbs.mockResolvedValue(
      new Map([['bk_1', BEFORE_AFTER]]),
    )

    const rows = await loadClientAftercareInbox('cl_1')

    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual({
      notificationId: 'ntf_1',
      bookingId: 'bk_1',
      aftercareId: 'ac_1',
      title: 'Balayage + Toner', // dto.display.title wins over the notification title
      proId: 'pro_1',
      proName: 'Glow Studio', // BUSINESS_NAME display
      scheduledFor: '2026-07-09T14:30:00.000Z',
      timeZone: 'America/New_York',
      beforeAfter: BEFORE_AFTER,
      rebookMode: AftercareRebookMode.NONE,
      rebookedFor: null,
      body: 'Wash after 48h.',
      unread: true, // readAt null
      createdAt: '2026-07-09T15:00:00.000Z',
    })
  })

  it('marks a read notification as not unread and carries the rebook date (ISO)', async () => {
    mocks.prisma.clientNotification.findMany.mockResolvedValue([
      makeNotif({
        readAt: new Date('2026-07-10T00:00:00.000Z'),
        aftercare: {
          rebookMode: AftercareRebookMode.NONE,
          rebookedFor: new Date('2026-08-01T13:00:00.000Z'),
        },
      }),
    ])
    mocks.buildClientBookingDTO.mockResolvedValue(makeDto())

    const rows = await loadClientAftercareInbox('cl_1')

    expect(rows[0]?.unread).toBe(false)
    expect(rows[0]?.rebookedFor).toBe('2026-08-01T13:00:00.000Z')
  })

  it('falls back to notification title + "Your pro" + default tz when the booking DTO fails', async () => {
    mocks.prisma.clientNotification.findMany.mockResolvedValue([
      makeNotif({
        title: 'Fresh cut',
        booking: {
          id: 'bk_9',
          professional: null,
          scheduledFor: new Date('2026-07-01T09:00:00.000Z'),
          consultationApproval: null,
        },
      }),
    ])
    // buildClientBookingDTO throws → loader swallows and uses raw fallbacks.
    mocks.buildClientBookingDTO.mockRejectedValue(new Error('boom'))

    const rows = await loadClientAftercareInbox('cl_1')

    expect(rows[0]).toMatchObject({
      bookingId: 'bk_9',
      title: 'Fresh cut',
      proId: null,
      proName: 'Your pro',
      scheduledFor: '2026-07-01T09:00:00.000Z',
      timeZone: 'UTC', // DEFAULT_TIME_ZONE
      beforeAfter: null,
    })
  })

  it('uses the generic "Aftercare" fallback when neither DTO nor notification has a title', async () => {
    mocks.prisma.clientNotification.findMany.mockResolvedValue([
      makeNotif({ title: '   ', booking: null }),
    ])

    const rows = await loadClientAftercareInbox('cl_1')

    expect(rows[0]?.title).toBe('Aftercare')
    expect(mocks.buildClientBookingDTO).not.toHaveBeenCalled() // no booking → skipped
  })
})

describe('aftercareInboxHintMode', () => {
  it('recommends a window', () => {
    expect(
      aftercareInboxHintMode({
        rebookMode: AftercareRebookMode.RECOMMENDED_WINDOW,
        rebookedFor: null,
      }),
    ).toBe('RECOMMENDED_WINDOW')
  })

  it('recommends a date when a rebookedFor is present', () => {
    expect(
      aftercareInboxHintMode({
        rebookMode: AftercareRebookMode.NONE,
        rebookedFor: '2026-08-01T13:00:00.000Z',
      }),
    ).toBe('RECOMMENDED_DATE')
  })

  it('falls back to notes', () => {
    expect(
      aftercareInboxHintMode({ rebookMode: null, rebookedFor: null }),
    ).toBe('NOTES')
  })
})
