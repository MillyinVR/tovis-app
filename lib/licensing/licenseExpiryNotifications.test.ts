// lib/licensing/licenseExpiryNotifications.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NotificationEventKey, VerificationStatus } from '@prisma/client'

const mocks = vi.hoisted(() => {
  const prisma = {
    professionalProfile: {
      findMany: vi.fn(),
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
  LICENSE_EXPIRY_WARN_DAYS,
  runLicenseExpiryNotifications,
} from './licenseExpiryNotifications'

const NOW = new Date('2026-08-06T09:00:00.000Z')
const MS_PER_DAY = 24 * 60 * 60 * 1000

describe('runLicenseExpiryNotifications', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.prisma.professionalProfile.findMany.mockResolvedValue([])
  })

  /**
   * Both passes call professionalProfile.findMany, so route each to its own
   * rows by the shape of the licenseExpiry filter: the warn window is bounded
   * on BOTH sides ({ gt, lte }), the expired pass only on one ({ lte }).
   */
  function routeFindMany(args: { warnRows?: unknown[]; expiredRows?: unknown[] }) {
    mocks.prisma.professionalProfile.findMany.mockImplementation(
      async ({ where }: { where: { licenseExpiry?: { gt?: unknown } } }) =>
        where?.licenseExpiry && 'gt' in where.licenseExpiry
          ? (args.warnRows ?? [])
          : (args.expiredRows ?? []),
    )
  }

  it('warns pros whose license enters the warning window, with a deduped notification', async () => {
    const licenseExpiry = new Date(NOW.getTime() + (LICENSE_EXPIRY_WARN_DAYS - 1) * MS_PER_DAY)
    routeFindMany({
      warnRows: [
        {
          id: 'pro_1',
          professionType: 'COSMETOLOGIST',
          licenseState: 'CA',
          licenseExpiry,
        },
      ],
    })

    const result = await runLicenseExpiryNotifications(NOW)

    expect(result.warned).toBe(1)
    expect(mocks.createProNotification).toHaveBeenCalledTimes(1)
    const arg = mocks.createProNotification.mock.calls[0]?.[0]
    expect(arg).toMatchObject({
      professionalId: 'pro_1',
      eventKey: NotificationEventKey.PRO_LICENSE_EXPIRING_SOON,
      href: '/pro/verification',
    })
    expect(arg.dedupeKey).toBe(`license-expiring:pro_1:${licenseExpiry.getTime()}`)
  })

  it('skips a warn-window row whose profession does not require a license', async () => {
    routeFindMany({
      warnRows: [
        {
          id: 'pro_1',
          professionType: 'MAKEUP_ARTIST',
          licenseState: 'CA',
          licenseExpiry: new Date(NOW.getTime() + 10 * MS_PER_DAY),
        },
      ],
    })

    const result = await runLicenseExpiryNotifications(NOW)

    expect(result.warned).toBe(0)
    expect(mocks.createProNotification).not.toHaveBeenCalled()
  })

  it('notifies pros whose license has already expired', async () => {
    const licenseExpiry = new Date(NOW.getTime() - 2 * MS_PER_DAY)
    routeFindMany({
      expiredRows: [
        {
          id: 'pro_2',
          professionType: 'BARBER',
          licenseState: 'TX',
          licenseExpiry,
        },
      ],
    })

    const result = await runLicenseExpiryNotifications(NOW)

    expect(result.expired).toBe(1)
    expect(mocks.createProNotification).toHaveBeenCalledTimes(1)
    const arg = mocks.createProNotification.mock.calls[0]?.[0]
    expect(arg).toMatchObject({
      professionalId: 'pro_2',
      eventKey: NotificationEventKey.PRO_LICENSE_EXPIRED,
      href: '/pro/verification',
    })
    expect(arg.dedupeKey).toBe(`license-expired:pro_2:${licenseExpiry.getTime()}`)
  })

  it('the query only asks for APPROVED, licenseVerified pros', async () => {
    routeFindMany({})
    await runLicenseExpiryNotifications(NOW)

    for (const call of mocks.prisma.professionalProfile.findMany.mock.calls) {
      const where = call[0].where
      expect(where.verificationStatus).toBe(VerificationStatus.APPROVED)
      expect(where.licenseVerified).toBe(true)
    }
  })

  it('does nothing when no license is near or past expiry', async () => {
    routeFindMany({})
    const result = await runLicenseExpiryNotifications(NOW)

    expect(result).toEqual({ warned: 0, expired: 0 })
    expect(mocks.createProNotification).not.toHaveBeenCalled()
  })

  it('renewal: a later expiry date produces a DIFFERENT dedupe key, so a fresh cycle can fire for it', async () => {
    const oldExpiry = new Date(NOW.getTime() + 5 * MS_PER_DAY)
    const renewedExpiry = new Date(NOW.getTime() + 10 * MS_PER_DAY)

    routeFindMany({
      warnRows: [
        { id: 'pro_1', professionType: 'COSMETOLOGIST', licenseState: 'CA', licenseExpiry: oldExpiry },
      ],
    })
    await runLicenseExpiryNotifications(NOW)
    const firstKey = mocks.createProNotification.mock.calls[0]?.[0]?.dedupeKey

    vi.clearAllMocks()
    routeFindMany({
      warnRows: [
        { id: 'pro_1', professionType: 'COSMETOLOGIST', licenseState: 'CA', licenseExpiry: renewedExpiry },
      ],
    })
    await runLicenseExpiryNotifications(NOW)
    const secondKey = mocks.createProNotification.mock.calls[0]?.[0]?.dedupeKey

    expect(firstKey).not.toBe(secondKey)
  })

  it('reports "tomorrow" when exactly one day remains', async () => {
    const licenseExpiry = new Date(NOW.getTime() + 1 * MS_PER_DAY)
    routeFindMany({
      warnRows: [
        { id: 'pro_1', professionType: 'COSMETOLOGIST', licenseState: 'CA', licenseExpiry },
      ],
    })

    await runLicenseExpiryNotifications(NOW)

    const arg = mocks.createProNotification.mock.calls[0]?.[0]
    expect(arg.body).toContain('tomorrow')
  })
})
