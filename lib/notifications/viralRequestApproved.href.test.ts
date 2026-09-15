// lib/notifications/viralRequestApproved.href.test.ts
//
// VIRAL_REQUEST_APPROVED emits NO href, end to end.
//
// Why this is a second file rather than another case in
// `viralRequestApproved.test.ts`: that suite mocks `./proNotifications`, so it
// can only prove which args the emitter PASSES. The claim that matters here is
// what the write boundary then DOES with them — `createProNotification` runs
// `assertNotificationHrefShape`, which throws outside production when an
// emitted href does not reduce to a shape the event declares. A mocked
// `createProNotification` skips that guard entirely, which is the one thing
// worth proving about a change that removes a href. Mock config is per-file in
// vitest, so the real path needs its own.
//
// Assertions are deliberately narrow (`objectContaining`): this is a test about
// one event's href, not a second copy of `proNotifications.test.ts`.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NotificationEventKey } from '@prisma/client'

const mockEnqueueDispatch = vi.hoisted(() => vi.fn())

const mockPrisma = vi.hoisted(() => ({
  $transaction: vi.fn(),
  notification: {
    create: vi.fn(),
    updateMany: vi.fn(),
    findFirst: vi.fn(),
  },
  professionalProfile: {
    findUnique: vi.fn(),
  },
  professionalNotificationPreference: {
    findUnique: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({
  prisma: mockPrisma,
}))

vi.mock('./dispatch/enqueueDispatch', () => ({
  enqueueDispatch: mockEnqueueDispatch,
}))

import { createViralRequestApprovedProNotification } from './viralRequestApproved'

const tx = {
  notification: mockPrisma.notification,
  professionalProfile: mockPrisma.professionalProfile,
  professionalNotificationPreference:
    mockPrisma.professionalNotificationPreference,
}

describe('VIRAL_REQUEST_APPROVED carries no href through the write boundary', () => {
  beforeEach(() => {
    for (const group of [
      mockPrisma.notification,
      mockPrisma.professionalProfile,
      mockPrisma.professionalNotificationPreference,
    ]) {
      for (const fn of Object.values(group)) fn.mockReset()
    }
    mockPrisma.$transaction.mockReset()
    mockEnqueueDispatch.mockReset()

    mockPrisma.$transaction.mockImplementation(
      async (run: (db: typeof tx) => Promise<unknown>) => run(tx),
    )
    mockPrisma.notification.create.mockResolvedValue({ id: 'notif_1' })
    // The emitter always sets a dedupeKey, so the write boundary tries an
    // update first; `count: 0` sends it down the create path.
    mockPrisma.notification.updateMany.mockResolvedValue({ count: 0 })
    mockPrisma.professionalProfile.findUnique.mockResolvedValue({
      id: 'pro_1',
      userId: 'user_1',
      homeTenantId: 'tenant_pro_1',
      phone: null,
      phoneVerifiedAt: null,
      timeZone: 'America/Los_Angeles',
      user: {
        email: 'pro@example.com',
        emailVerifiedAt: new Date('2026-04-08T07:00:00.000Z'),
        phone: null,
        phoneVerifiedAt: null,
        transactionalSmsConsentAt: null,
      },
    })
    mockPrisma.professionalNotificationPreference.findUnique.mockResolvedValue(
      null,
    )
    mockEnqueueDispatch.mockResolvedValue(undefined)
  })

  it('writes the row with an empty href, and the title/body survive', async () => {
    const result = await createViralRequestApprovedProNotification({
      professionalId: 'pro_1',
      viralRequestId: 'request_1',
      requestName: 'Wolf Cut',
      requestedCategoryId: 'cat_1',
      matchedServiceIds: ['service_1'],
    })

    expect(result).toEqual({ id: 'notif_1' })

    // 🔴 The whole point: this call runs `assertNotificationHrefShape`, which
    // throws here (NODE_ENV=test) if the emitted href is not one this event
    // declares. Reaching this line at all is the guard agreeing that `[]` and
    // "no href" are the same statement.
    expect(mockPrisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventKey: NotificationEventKey.VIRAL_REQUEST_APPROVED,
          title: 'New viral request in your category',
          body: '"Wolf Cut" was approved and matches your services.',
          // `normInternalHref` maps an absent href to '' — the column is not
          // nullable, so '' IS "no destination" in this schema. Asserted as the
          // literal rather than a falsy check so a real href cannot pass.
          href: '',
        }),
      }),
    )

    // The dedupe path rewrites href too, so a re-emit onto a row minted before
    // this change replaces the old /admin href with '' rather than leaving it.
    expect(mockPrisma.notification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ href: '' }),
      }),
    )

    // The notice still goes out; only the destination is gone.
    expect(mockEnqueueDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        key: NotificationEventKey.VIRAL_REQUEST_APPROVED,
        title: 'New viral request in your category',
        body: '"Wolf Cut" was approved and matches your services.',
        href: '',
        notificationId: 'notif_1',
      }),
    )
  })
})
