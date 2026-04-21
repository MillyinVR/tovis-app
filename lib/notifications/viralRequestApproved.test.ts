import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NotificationEventKey } from '@prisma/client'

const mockCreateProNotification = vi.hoisted(() => vi.fn())

vi.mock('./proNotifications', () => ({
  createProNotification: mockCreateProNotification,
}))

import {
  buildViralRequestApprovedNotificationData,
  buildViralRequestApprovedProNotificationDedupeKey,
  createViralRequestApprovedProNotification,
} from './viralRequestApproved'

describe('lib/notifications/viralRequestApproved', () => {
  beforeEach(() => {
    mockCreateProNotification.mockReset()
    mockCreateProNotification.mockResolvedValue({ id: 'notif_1' })
  })

  it('builds a stable dedupe key and normalized typed payload', () => {
    expect(
      buildViralRequestApprovedProNotificationDedupeKey(' request_1 '),
    ).toBe('viral-request:request_1:approved')

    expect(
      buildViralRequestApprovedNotificationData({
        viralRequestId: ' request_1 ',
        requestName: ' Wolf Cut ',
        requestedCategoryId: ' cat_1 ',
        matchedServiceIds: [' service_1 ', 'service_1', 'service_2', ''],
      }),
    ).toEqual({
      viralRequestId: 'request_1',
      requestName: 'Wolf Cut',
      requestedCategoryId: 'cat_1',
      matchedServiceIds: ['service_1', 'service_2'],
    })
  })

  it('routes the event through createProNotification with the canonical args', async () => {
    const result = await createViralRequestApprovedProNotification({
      professionalId: ' pro_1 ',
      viralRequestId: ' request_1 ',
      requestName: ' Wolf Cut ',
      requestedCategoryId: ' cat_1 ',
      matchedServiceIds: [' service_1 ', 'service_1', 'service_2'],
    })

    expect(result).toEqual({ id: 'notif_1' })

    expect(mockCreateProNotification).toHaveBeenCalledWith({
      professionalId: 'pro_1',
      eventKey: NotificationEventKey.VIRAL_REQUEST_APPROVED,
      title: 'New viral request in your category',
      body: '"Wolf Cut" was approved and matches your services.',
      href: '/admin/viral-requests/request_1',
      dedupeKey: 'viral-request:request_1:approved',
      data: {
        viralRequestId: 'request_1',
        requestName: 'Wolf Cut',
        requestedCategoryId: 'cat_1',
        matchedServiceIds: ['service_1', 'service_2'],
      },
      tx: undefined,
    })
  })
})