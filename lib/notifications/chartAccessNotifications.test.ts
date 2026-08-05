// lib/notifications/chartAccessNotifications.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NotificationEventKey } from '@prisma/client'

const mockCreateClientNotification = vi.hoisted(() => vi.fn())
const mockCreateProNotification = vi.hoisted(() => vi.fn())
const mockFindPro = vi.hoisted(() => vi.fn())
const mockFindClient = vi.hoisted(() => vi.fn())

vi.mock('./clientNotifications', () => ({
  createClientNotification: mockCreateClientNotification,
}))

vi.mock('./proNotifications', () => ({
  createProNotification: mockCreateProNotification,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    professionalProfile: { findUnique: (...a: unknown[]) => mockFindPro(...a) },
    clientProfile: { findUnique: (...a: unknown[]) => mockFindClient(...a) },
  },
}))

import {
  CHART_SHARE_SETTINGS_HREF,
  buildChartAccessGrantedDedupeKey,
  buildChartAccessRequestedDedupeKey,
  notifyChartAccessGranted,
  notifyChartAccessRequested,
} from './chartAccessNotifications'

const PAIR = { clientId: 'client_1', professionalId: 'pro_1' }

beforeEach(() => {
  mockCreateClientNotification.mockReset()
  mockCreateClientNotification.mockResolvedValue({ id: 'notif_1' })
  mockCreateProNotification.mockReset()
  mockCreateProNotification.mockResolvedValue({ id: 'notif_2' })
  mockFindPro.mockReset()
  mockFindPro.mockResolvedValue({
    businessName: 'Glow Studio',
    firstName: 'Ada',
    lastName: 'Lovelace',
    handle: 'glow',
    nameDisplay: 'BUSINESS_NAME',
  })
  mockFindClient.mockReset()
  mockFindClient.mockResolvedValue({ firstName: 'Rae', lastName: 'Kim' })
})

describe('dedupe keys', () => {
  // Keyed on the PAIR, because the request row is one-per-pair. A key that
  // varied per ask would stack an inbox row for a state that cannot exist twice.
  it('are per (client, pro) and distinct per direction', () => {
    expect(buildChartAccessRequestedDedupeKey(PAIR)).toBe(
      'chart-access-requested:client_1:pro_1',
    )
    expect(buildChartAccessGrantedDedupeKey(PAIR)).toBe(
      'chart-access-granted:client_1:pro_1',
    )
  })
})

describe('notifyChartAccessRequested', () => {
  it('tells the CLIENT, names the pro, and points at the surface that can answer', async () => {
    await notifyChartAccessRequested(PAIR)

    expect(mockCreateProNotification).not.toHaveBeenCalled()
    const payload = mockCreateClientNotification.mock.calls[0]?.[0]
    expect(payload).toMatchObject({
      clientId: 'client_1',
      eventKey: NotificationEventKey.CHART_ACCESS_REQUESTED,
      title: 'Glow Studio asked to see your chart',
      href: CHART_SHARE_SETTINGS_HREF,
      dedupeKey: 'chart-access-requested:client_1:pro_1',
    })
  })

  // An ask the client cannot attribute is worse than none — their decision is
  // entirely about who is asking.
  it('sends nothing when the pro cannot be resolved', async () => {
    mockFindPro.mockResolvedValue(null)

    await notifyChartAccessRequested(PAIR)

    expect(mockCreateClientNotification).not.toHaveBeenCalled()
  })
})

describe('notifyChartAccessGranted', () => {
  it('tells the PRO and links the chart they may now open', async () => {
    await notifyChartAccessGranted(PAIR)

    expect(mockCreateClientNotification).not.toHaveBeenCalled()
    expect(mockCreateProNotification.mock.calls[0]?.[0]).toMatchObject({
      professionalId: 'pro_1',
      eventKey: NotificationEventKey.CHART_ACCESS_GRANTED,
      title: 'Rae Kim shared their chart with you',
      href: '/pro/clients/client_1',
      dedupeKey: 'chart-access-granted:client_1:pro_1',
    })
  })

  it('sends nothing when the client cannot be resolved', async () => {
    mockFindClient.mockResolvedValue(null)

    await notifyChartAccessGranted(PAIR)

    expect(mockCreateProNotification).not.toHaveBeenCalled()
  })
})
