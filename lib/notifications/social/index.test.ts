import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createViralRequestApprovedProNotification: vi.fn(),
}))

vi.mock('@/lib/notifications/viralRequestApproved', () => ({
  createViralRequestApprovedProNotification:
    mocks.createViralRequestApprovedProNotification,
}))

import { notifyMatchedProsAboutApprovedViralRequest } from './index'

describe('lib/notifications/social/index.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('dedupes recipients and delegates durable notification creation to the existing viral request helper', async () => {
    mocks.createViralRequestApprovedProNotification
      .mockResolvedValueOnce({ id: 'notif_1' })
      .mockResolvedValueOnce({ id: 'notif_2' })

    const result = await notifyMatchedProsAboutApprovedViralRequest({
      viralRequestId: 'request_1',
      requestName: 'Wolf Cut',
      requestedCategoryId: 'cat_1',
      recipients: [
        {
          professionalId: 'pro_1',
          matchedServiceIds: ['service_1', 'service_2'],
        },
        {
          professionalId: 'pro_1',
          matchedServiceIds: ['service_2', 'service_3', ''],
        },
        {
          professionalId: 'pro_2',
          matchedServiceIds: ['service_9'],
        },
      ],
    })

    expect(
      mocks.createViralRequestApprovedProNotification,
    ).toHaveBeenCalledTimes(2)

    expect(
      mocks.createViralRequestApprovedProNotification,
    ).toHaveBeenNthCalledWith(1, {
      professionalId: 'pro_1',
      viralRequestId: 'request_1',
      requestName: 'Wolf Cut',
      requestedCategoryId: 'cat_1',
      matchedServiceIds: ['service_1', 'service_2', 'service_3'],
      tx: undefined,
    })

    expect(
      mocks.createViralRequestApprovedProNotification,
    ).toHaveBeenNthCalledWith(2, {
      professionalId: 'pro_2',
      viralRequestId: 'request_1',
      requestName: 'Wolf Cut',
      requestedCategoryId: 'cat_1',
      matchedServiceIds: ['service_9'],
      tx: undefined,
    })

    expect(result).toEqual({
      matchedProfessionalIds: ['pro_1', 'pro_2'],
      notificationIds: ['notif_1', 'notif_2'],
    })
  })

  it('returns empty arrays when there are no recipients', async () => {
    const result = await notifyMatchedProsAboutApprovedViralRequest({
      viralRequestId: 'request_1',
      requestName: 'Wolf Cut',
      recipients: [],
    })

    expect(
      mocks.createViralRequestApprovedProNotification,
    ).not.toHaveBeenCalled()

    expect(result).toEqual({
      matchedProfessionalIds: [],
      notificationIds: [],
    })
  })
})