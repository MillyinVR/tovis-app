// lib/messages/inboxContext.test.ts
//
// The inbox filter + eyebrow logic shared by the SSR inbox page and the JSON
// list route (iOS). Covers filter parsing, the Prisma where per tab, the accent
// rule, and the batched eyebrow resolution (booking / waitlist / service).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MessageThreadContextType,
  WaitlistPreferenceType,
  WaitlistStatus,
  WaitlistTimeOfDay,
} from '@prisma/client'

const mocks = vi.hoisted(() => ({
  prisma: {
    booking: { findMany: vi.fn() },
    service: { findMany: vi.fn() },
    professionalServiceOffering: { findMany: vi.fn() },
    waitlistEntry: { findMany: vi.fn() },
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }))

import {
  isAccentContextType,
  parseInboxFilter,
  resolveInboxEyebrows,
  whereForInboxFilter,
  type InboxEyebrowThread,
} from './inboxContext'

function thread(overrides: Partial<InboxEyebrowThread> & { id: string }): InboxEyebrowThread {
  return {
    contextType: MessageThreadContextType.PRO_PROFILE,
    bookingId: null,
    serviceId: null,
    offeringId: null,
    waitlistEntryId: null,
    ...overrides,
  }
}

describe('parseInboxFilter', () => {
  it('maps the known tab values', () => {
    expect(parseInboxFilter('bookings')).toBe('bookings')
    expect(parseInboxFilter('waitlists')).toBe('waitlists')
    expect(parseInboxFilter('pros')).toBe('pros')
    expect(parseInboxFilter('BOOKINGS')).toBe('bookings')
  })

  it('falls back to all for empty / unknown / null', () => {
    expect(parseInboxFilter('all')).toBe('all')
    expect(parseInboxFilter('')).toBe('all')
    expect(parseInboxFilter(null)).toBe('all')
    expect(parseInboxFilter('nonsense')).toBe('all')
  })
})

describe('whereForInboxFilter', () => {
  it('always scopes to the viewer with message activity', () => {
    const where = whereForInboxFilter({ userId: 'u1', filter: 'all' })
    expect(where.participants).toEqual({ some: { userId: 'u1' } })
    expect(where.lastMessageAt).toEqual({ not: null })
    expect(where.contextType).toBeUndefined()
  })

  it('constrains contextType per tab', () => {
    expect(whereForInboxFilter({ userId: 'u1', filter: 'bookings' }).contextType).toBe(
      MessageThreadContextType.BOOKING,
    )
    expect(whereForInboxFilter({ userId: 'u1', filter: 'waitlists' }).contextType).toBe(
      MessageThreadContextType.WAITLIST,
    )
    expect(whereForInboxFilter({ userId: 'u1', filter: 'pros' }).contextType).toEqual({
      in: [
        MessageThreadContextType.PRO_PROFILE,
        MessageThreadContextType.SERVICE,
        MessageThreadContextType.OFFERING,
      ],
    })
  })
})

describe('isAccentContextType', () => {
  it('accents actionable contexts only', () => {
    expect(isAccentContextType(MessageThreadContextType.BOOKING)).toBe(true)
    expect(isAccentContextType(MessageThreadContextType.OFFERING)).toBe(true)
    expect(isAccentContextType(MessageThreadContextType.WAITLIST)).toBe(true)
    expect(isAccentContextType(MessageThreadContextType.SERVICE)).toBe(false)
    expect(isAccentContextType(MessageThreadContextType.PRO_PROFILE)).toBe(false)
  })
})

describe('resolveInboxEyebrows', () => {
  beforeEach(() => {
    mocks.prisma.booking.findMany.mockResolvedValue([])
    mocks.prisma.service.findMany.mockResolvedValue([])
    mocks.prisma.professionalServiceOffering.findMany.mockResolvedValue([])
    mocks.prisma.waitlistEntry.findMany.mockResolvedValue([])
  })

  it('skips lookups for context types with no ids', async () => {
    const result = await resolveInboxEyebrows([
      thread({ id: 't1', contextType: MessageThreadContextType.PRO_PROFILE }),
    ])

    expect(mocks.prisma.booking.findMany).not.toHaveBeenCalled()
    expect(mocks.prisma.service.findMany).not.toHaveBeenCalled()
    expect(mocks.prisma.waitlistEntry.findMany).not.toHaveBeenCalled()
    expect(result.get('t1')).toEqual({ eyebrow: 'Pro', isAccentContext: false })
  })

  it('builds a booking eyebrow with service + time, accented', async () => {
    mocks.prisma.booking.findMany.mockResolvedValue([
      {
        id: 'bk1',
        scheduledFor: new Date('2026-06-27T18:30:00.000Z'),
        locationTimeZone: 'UTC',
        service: { name: 'Balayage' },
      },
    ])

    const result = await resolveInboxEyebrows([
      thread({ id: 't1', contextType: MessageThreadContextType.BOOKING, bookingId: 'bk1' }),
    ])

    const eyebrow = result.get('t1')
    expect(eyebrow?.isAccentContext).toBe(true)
    expect(eyebrow?.eyebrow.startsWith('BOOKING CONFIRMED — Balayage — ')).toBe(true)
  })

  it('builds a waitlist eyebrow with status + preference', async () => {
    mocks.prisma.waitlistEntry.findMany.mockResolvedValue([
      {
        id: 'wl1',
        status: WaitlistStatus.ACTIVE,
        preferenceType: WaitlistPreferenceType.TIME_OF_DAY,
        specificDate: null,
        timeOfDay: WaitlistTimeOfDay.MORNING,
        windowStartMin: null,
        windowEndMin: null,
        service: { name: 'Color' },
      },
    ])

    const result = await resolveInboxEyebrows([
      thread({
        id: 't1',
        contextType: MessageThreadContextType.WAITLIST,
        waitlistEntryId: 'wl1',
      }),
    ])

    expect(result.get('t1')).toEqual({
      eyebrow: 'Waitlist — Position active — Color — Morning',
      isAccentContext: true,
    })
  })

  it('falls back to "Waitlist" when the entry row is missing', async () => {
    const result = await resolveInboxEyebrows([
      thread({
        id: 't1',
        contextType: MessageThreadContextType.WAITLIST,
        waitlistEntryId: 'gone',
      }),
    ])

    expect(result.get('t1')).toEqual({ eyebrow: 'Waitlist', isAccentContext: true })
  })
})
