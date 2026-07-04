import { NotificationEventKey } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    notification: { groupBy: vi.fn(), findMany: vi.fn() },
    clientNotification: { groupBy: vi.fn(), findMany: vi.fn() },
    professionalProfile: { findMany: vi.fn() },
    clientProfile: { findMany: vi.fn() },
    professionalNotificationPreference: { findMany: vi.fn() },
    clientNotificationPreference: { findMany: vi.fn() },
    lookPost: { findMany: vi.fn() },
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }))
vi.mock('@/lib/membership/urls', () => ({
  getAppUrl: () => 'https://app.test',
}))
vi.mock('@/lib/media/renderUrls', () => ({
  renderMediaUrls: vi.fn(async () => ({
    renderUrl: 'https://cdn.test/x.jpg',
    renderThumbUrl: 'https://cdn.test/thumb.jpg',
  })),
}))
vi.mock('@/lib/brand/forTenant', () => ({
  getBrandForTenantContext: () => ({ displayName: 'TestBrand' }),
}))

import { runSocialDigest, type DigestEmailPayload } from './runDigest'

const NOW = new Date('2026-07-08T16:00:00.000Z')

function resetMocks() {
  for (const model of Object.values(mockPrisma)) {
    for (const fn of Object.values(model)) {
      fn.mockReset()
    }
  }
  // Sensible empty defaults; each test overrides what it needs.
  mockPrisma.notification.groupBy.mockResolvedValue([])
  mockPrisma.notification.findMany.mockResolvedValue([])
  mockPrisma.clientNotification.groupBy.mockResolvedValue([])
  mockPrisma.clientNotification.findMany.mockResolvedValue([])
  mockPrisma.professionalProfile.findMany.mockResolvedValue([])
  mockPrisma.clientProfile.findMany.mockResolvedValue([])
  mockPrisma.professionalNotificationPreference.findMany.mockResolvedValue([])
  mockPrisma.clientNotificationPreference.findMany.mockResolvedValue([])
  mockPrisma.lookPost.findMany.mockResolvedValue([])
}

beforeEach(() => {
  resetMocks()
})

function seedOnePro(overrides?: {
  prefs?: Array<{ eventKey: NotificationEventKey; emailEnabled: boolean }>
  rows?: Array<{ eventKey: NotificationEventKey }>
}) {
  mockPrisma.notification.groupBy.mockResolvedValue([
    { professionalId: 'pro1', _count: { professionalId: 2 } },
  ])
  mockPrisma.professionalProfile.findMany.mockResolvedValue([
    {
      id: 'pro1',
      firstName: 'Pat',
      homeTenantId: 't1',
      homeTenant: { id: 't1', slug: 'tovis-root' },
      user: { email: 'pro@test.com' },
    },
  ])
  mockPrisma.professionalNotificationPreference.findMany.mockResolvedValue(
    (overrides?.prefs ?? []).map((pref) => ({
      professionalId: 'pro1',
      eventKey: pref.eventKey,
      emailEnabled: pref.emailEnabled,
    })),
  )
  mockPrisma.notification.findMany.mockResolvedValue(
    (overrides?.rows ?? [{ eventKey: NotificationEventKey.LOOK_LIKED }]).map(
      (row, index) => ({
        professionalId: 'pro1',
        eventKey: row.eventKey,
        title: `pro-title-${index}`,
        href: `/looks/${index}`,
        createdAt: new Date('2026-07-06T00:00:00.000Z'),
      }),
    ),
  )
}

function seedOneClient() {
  mockPrisma.clientNotification.groupBy.mockResolvedValue([
    { clientId: 'c1', _count: { clientId: 1 } },
  ])
  mockPrisma.clientProfile.findMany.mockResolvedValue([
    {
      id: 'c1',
      firstName: 'Cleo',
      email: 'client@test.com',
      homeTenantId: 't1',
      homeTenant: { id: 't1', slug: 'tovis-root' },
    },
  ])
  mockPrisma.clientNotification.findMany.mockResolvedValue([
    {
      clientId: 'c1',
      eventKey: NotificationEventKey.CLIENT_FOLLOW,
      title: 'Someone followed you',
      href: '/u/someone',
      createdAt: new Date('2026-07-06T00:00:00.000Z'),
    },
  ])
}

describe('runSocialDigest', () => {
  it('sends one digest per pro and client recipient', async () => {
    seedOnePro()
    seedOneClient()
    const sender = vi.fn<(payload: DigestEmailPayload) => Promise<{ ok: boolean }>>().mockResolvedValue({ ok: true })

    const result = await runSocialDigest({ now: NOW, sender })

    expect(result.emailConfigured).toBe(true)
    expect(result.proRecipientsConsidered).toBe(1)
    expect(result.clientRecipientsConsidered).toBe(1)
    expect(result.sent).toBe(2)
    expect(result.failed).toBe(0)
    expect(sender).toHaveBeenCalledTimes(2)

    const recipients = sender.mock.calls.map((call) => call[0].to)
    expect(recipients).toContain('pro@test.com')
    expect(recipients).toContain('client@test.com')

    const proPayload = sender.mock.calls
      .map((call) => call[0])
      .find((payload) => payload.to === 'pro@test.com')
    expect(proPayload?.subject).toContain('TestBrand')
    expect(proPayload?.html).toContain('Hi Pat,')
  })

  it('no-ops when email is not configured', async () => {
    seedOnePro()

    const result = await runSocialDigest({ now: NOW, sender: null })

    expect(result.emailConfigured).toBe(false)
    expect(result.sent).toBe(0)
    // Never even queried recipients.
    expect(mockPrisma.notification.groupBy).not.toHaveBeenCalled()
  })

  it('skips a recipient whose only unread events are email-disabled', async () => {
    seedOnePro({
      prefs: [
        { eventKey: NotificationEventKey.LOOK_LIKED, emailEnabled: false },
      ],
      rows: [{ eventKey: NotificationEventKey.LOOK_LIKED }],
    })
    const sender = vi.fn<(payload: DigestEmailPayload) => Promise<{ ok: boolean }>>().mockResolvedValue({ ok: true })

    const result = await runSocialDigest({ now: NOW, sender })

    expect(result.proRecipientsConsidered).toBe(1)
    expect(result.skippedNoEnabledEvents).toBe(1)
    expect(result.sent).toBe(0)
    expect(sender).not.toHaveBeenCalled()
  })

  it('counts recipients with no email address as skipped', async () => {
    mockPrisma.notification.groupBy.mockResolvedValue([
      { professionalId: 'pro1', _count: { professionalId: 1 } },
    ])
    mockPrisma.professionalProfile.findMany.mockResolvedValue([
      {
        id: 'pro1',
        firstName: 'Pat',
        homeTenantId: 't1',
        homeTenant: { id: 't1', slug: 'tovis-root' },
        user: { email: '' },
      },
    ])
    const sender = vi.fn<(payload: DigestEmailPayload) => Promise<{ ok: boolean }>>().mockResolvedValue({ ok: true })

    const result = await runSocialDigest({ now: NOW, sender })

    expect(result.proRecipientsConsidered).toBe(1)
    expect(result.skippedNoEmail).toBe(1)
    expect(result.sent).toBe(0)
    expect(sender).not.toHaveBeenCalled()
  })

  it('records a send failure without throwing', async () => {
    seedOneClient()
    const sender = vi.fn<(payload: DigestEmailPayload) => Promise<{ ok: boolean }>>().mockResolvedValue({ ok: false })

    const result = await runSocialDigest({ now: NOW, sender })

    expect(result.sent).toBe(0)
    expect(result.failed).toBe(1)
  })

  it('queries only the digest window', async () => {
    seedOneClient()
    const sender = vi.fn<(payload: DigestEmailPayload) => Promise<{ ok: boolean }>>().mockResolvedValue({ ok: true })

    await runSocialDigest({ now: NOW, windowDays: 7, sender })

    const call = mockPrisma.clientNotification.groupBy.mock.calls[0]?.[0]
    const since = call?.where?.createdAt?.gte as Date
    expect(since.toISOString()).toBe('2026-07-01T16:00:00.000Z')
  })
})
