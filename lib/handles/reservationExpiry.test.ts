// lib/handles/reservationExpiry.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NotificationEventKey } from '@prisma/client'

const mocks = vi.hoisted(() => {
  const prisma = {
    professionalProfile: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
  }
  const createProNotification = vi.fn()
  return { prisma, createProNotification }
})

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }))
vi.mock('@/lib/notifications/proNotifications', () => ({
  createProNotification: mocks.createProNotification,
}))

import {
  RESERVATION_GRACE_DAYS,
  RESERVATION_WARN_DAYS,
  runHandleReservationExpiry,
} from './reservationExpiry'

const NOW = new Date('2026-06-22T09:00:00.000Z')
const MS_PER_DAY = 24 * 60 * 60 * 1000

describe('runHandleReservationExpiry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.prisma.professionalProfile.findMany.mockResolvedValue([])
    mocks.prisma.professionalProfile.updateMany.mockResolvedValue({ count: 0 })
  })

  it('warns pros in the warning window with a deduped, billing-linked notification', async () => {
    const reservedAt = new Date(
      NOW.getTime() - (RESERVATION_GRACE_DAYS - RESERVATION_WARN_DAYS + 1) * MS_PER_DAY,
    )
    mocks.prisma.professionalProfile.findMany.mockResolvedValue([
      { id: 'pro_1', handle: 'tori', handleReservedAt: reservedAt },
    ])

    const result = await runHandleReservationExpiry(NOW)

    expect(result.warned).toBe(1)
    expect(mocks.createProNotification).toHaveBeenCalledTimes(1)
    const arg = mocks.createProNotification.mock.calls[0]?.[0]
    expect(arg).toMatchObject({
      professionalId: 'pro_1',
      eventKey: NotificationEventKey.PRO_HANDLE_RESERVATION_EXPIRING,
      href: '/pro/membership',
    })
    expect(arg.dedupeKey).toContain(String(reservedAt.getTime()))
    expect(arg.title).toContain('tori.tovis.me')
  })

  it('skips warning rows whose handle is somehow blank', async () => {
    mocks.prisma.professionalProfile.findMany.mockResolvedValue([
      { id: 'pro_1', handle: '', handleReservedAt: NOW },
    ])
    const result = await runHandleReservationExpiry(NOW)
    expect(result.warned).toBe(0)
    expect(mocks.createProNotification).not.toHaveBeenCalled()
  })

  it('releases expired reservations and reports the count', async () => {
    mocks.prisma.professionalProfile.updateMany.mockResolvedValue({ count: 3 })
    const result = await runHandleReservationExpiry(NOW)

    expect(result.released).toBe(3)
    const updateArg = mocks.prisma.professionalProfile.updateMany.mock.calls[0]?.[0]
    expect(updateArg.data).toEqual({
      handle: null,
      handleNormalized: null,
      handleReservedAt: null,
    })
    // Only non-premium, actually-reserved rows past the grace window.
    expect(updateArg.where.isPremium).toBe(false)
    expect(updateArg.where.handleNormalized).toEqual({ not: null })
    expect(updateArg.where.handleReservedAt.lte).toBeInstanceOf(Date)
  })
})
