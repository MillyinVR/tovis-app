// lib/handles/reservationExpiry.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NotificationEventKey } from '@prisma/client'

const mocks = vi.hoisted(() => {
  const prisma = {
    professionalProfile: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    // Releasing a handle must also drop its registry row, or the handle would
    // be free on the profile and still locked in the global namespace — nobody,
    // including the original pro, could ever claim it again.
    handleRegistration: {
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn(),
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
    mocks.prisma.handleRegistration.deleteMany.mockResolvedValue({ count: 0 })
    // $transaction here takes an ARRAY of operations, not a callback.
    mocks.prisma.$transaction.mockImplementation(async (ops: unknown[]) =>
      Promise.all(ops),
    )
  })

  /**
   * Both the warn pass and the release pass call professionalProfile.findMany,
   * so route each to its own rows by the shape of the reservation filter: the
   * warn window is bounded on BOTH sides ({ lte, gt }), the release cutoff only
   * on one ({ lte }). Without this the release rows would also be warned about.
   */
  function routeFindMany(args: {
    warnRows?: unknown[]
    releaseRows?: unknown[]
  }) {
    mocks.prisma.professionalProfile.findMany.mockImplementation(
      async ({ where }: { where: { handleReservedAt?: { gt?: unknown } } }) =>
        where?.handleReservedAt && 'gt' in where.handleReservedAt
          ? (args.warnRows ?? [])
          : (args.releaseRows ?? []),
    )
  }

  it('warns pros in the warning window with a deduped, billing-linked notification', async () => {
    const reservedAt = new Date(
      NOW.getTime() - (RESERVATION_GRACE_DAYS - RESERVATION_WARN_DAYS + 1) * MS_PER_DAY,
    )
    routeFindMany({
      warnRows: [{ id: 'pro_1', handle: 'tori', handleReservedAt: reservedAt }],
    })

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
    routeFindMany({
      warnRows: [{ id: 'pro_1', handle: '', handleReservedAt: NOW }],
    })
    const result = await runHandleReservationExpiry(NOW)
    expect(result.warned).toBe(0)
    expect(mocks.createProNotification).not.toHaveBeenCalled()
  })

  it('releases expired reservations and reports the count', async () => {
    const releaseRows = [{ id: 'pro_1' }, { id: 'pro_2' }, { id: 'pro_3' }]
    routeFindMany({ releaseRows })
    mocks.prisma.professionalProfile.updateMany.mockResolvedValue({ count: 3 })

    const result = await runHandleReservationExpiry(NOW)

    expect(result.released).toBe(3)

    // Selection: only non-premium, actually-reserved rows past the grace window.
    const selectArg = mocks.prisma.professionalProfile.findMany.mock.calls
      .map((call) => call[0])
      .find((arg) => !('gt' in (arg.where.handleReservedAt ?? {})))
    expect(selectArg.where.isPremium).toBe(false)
    expect(selectArg.where.handleNormalized).toEqual({ not: null })
    expect(selectArg.where.handleReservedAt.lte).toBeInstanceOf(Date)

    const updateArg = mocks.prisma.professionalProfile.updateMany.mock.calls[0]?.[0]
    expect(updateArg.data).toEqual({
      handle: null,
      handleNormalized: null,
      handleReservedAt: null,
    })
    expect(updateArg.where).toEqual({ id: { in: ['pro_1', 'pro_2', 'pro_3'] } })

    // The registry row goes with it, in the SAME transaction as the clear.
    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(1)
    const deleteArg = mocks.prisma.handleRegistration.deleteMany.mock.calls[0]?.[0]
    expect(deleteArg).toEqual({
      where: { professionalId: { in: ['pro_1', 'pro_2', 'pro_3'] } },
    })
  })

  it('touches nothing when no reservation has expired', async () => {
    routeFindMany({ releaseRows: [] })
    const result = await runHandleReservationExpiry(NOW)

    expect(result.released).toBe(0)
    expect(mocks.prisma.professionalProfile.updateMany).not.toHaveBeenCalled()
    expect(mocks.prisma.handleRegistration.deleteMany).not.toHaveBeenCalled()
  })
})
