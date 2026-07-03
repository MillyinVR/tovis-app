// lib/notifications/lookEngagement.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NotificationEventKey } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  createProNotification: vi.fn(),
  createClientNotification: vi.fn(),
}))

vi.mock('./proNotifications', () => ({
  createProNotification: mocks.createProNotification,
}))

vi.mock('./clientNotifications', () => ({
  createClientNotification: mocks.createClientNotification,
}))

import {
  buildLookEngagementDedupeKey,
  notifyLookLiked,
  notifyLookSaved,
} from './lookEngagement'

type Identity = {
  userId: string
  clientProfileId: string | null
  professionalProfileId: string | null
}

const PRO_LOOK = { professionalId: 'pro_1', clientAuthorId: null }
const CLIENT_LOOK = { professionalId: 'pro_1', clientAuthorId: 'client_author' }

const NOW = new Date('2026-07-03T12:00:00.000Z')

function client(id: string, userId: string): Identity {
  return { userId, clientProfileId: id, professionalProfileId: null }
}

function pro(id: string, userId: string): Identity {
  return { userId, clientProfileId: null, professionalProfileId: id }
}

describe('buildLookEngagementDedupeKey', () => {
  it('buckets by UTC day', () => {
    expect(buildLookEngagementDedupeKey('liked', 'look_1', NOW)).toBe(
      'look:look_1:liked:2026-07-03',
    )
    expect(
      buildLookEngagementDedupeKey(
        'saved',
        'look_1',
        new Date('2026-07-04T00:00:01.000Z'),
      ),
    ).toBe('look:look_1:saved:2026-07-04')
  })
})

describe('notifyLookLiked / notifyLookSaved', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createProNotification.mockResolvedValue({ id: 'n1' })
    mocks.createClientNotification.mockResolvedValue({ id: 'n2' })
  })

  it('notifies the pro with a singular title on the first like', async () => {
    await notifyLookLiked({
      lookPostId: 'look_1',
      look: PRO_LOOK,
      actor: client('client_2', 'user_2'),
      count: 1,
      now: NOW,
    })

    expect(mocks.createProNotification).toHaveBeenCalledTimes(1)
    expect(mocks.createProNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        professionalId: 'pro_1',
        eventKey: NotificationEventKey.LOOK_LIKED,
        title: 'Someone liked your look',
        href: '/looks/look_1',
        dedupeKey: 'look:look_1:liked:2026-07-03',
        actorUserId: 'user_2',
        data: expect.objectContaining({
          lookPostId: 'look_1',
          count: 1,
          actorClientId: 'client_2',
        }),
      }),
    )
    expect(mocks.createClientNotification).not.toHaveBeenCalled()
  })

  it('carries the running count in the title and data on later likes', async () => {
    await notifyLookLiked({
      lookPostId: 'look_1',
      look: PRO_LOOK,
      actor: client('client_3', 'user_3'),
      count: 4,
      now: NOW,
    })

    expect(mocks.createProNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '4 people liked your look',
        dedupeKey: 'look:look_1:liked:2026-07-03',
        data: expect.objectContaining({ count: 4 }),
      }),
    )
  })

  it('uses saved-times copy for saves (save counts are board items, not people)', async () => {
    await notifyLookSaved({
      lookPostId: 'look_1',
      look: PRO_LOOK,
      actor: client('client_2', 'user_2'),
      count: 3,
      now: NOW,
    })

    expect(mocks.createProNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        eventKey: NotificationEventKey.LOOK_SAVED,
        title: 'Your look was saved 3 times',
        dedupeKey: 'look:look_1:saved:2026-07-03',
      }),
    )
  })

  it('routes to the client author for client-shared looks', async () => {
    await notifyLookLiked({
      lookPostId: 'look_1',
      look: CLIENT_LOOK,
      actor: client('client_2', 'user_2'),
      count: 1,
      now: NOW,
    })

    expect(mocks.createClientNotification).toHaveBeenCalledTimes(1)
    expect(mocks.createClientNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'client_author',
        eventKey: NotificationEventKey.LOOK_LIKED,
      }),
    )
    expect(mocks.createProNotification).not.toHaveBeenCalled()
  })

  it('skips a pro liking their own look', async () => {
    await notifyLookLiked({
      lookPostId: 'look_1',
      look: PRO_LOOK,
      actor: pro('pro_1', 'user_pro'),
      count: 1,
      now: NOW,
    })

    expect(mocks.createProNotification).not.toHaveBeenCalled()
    expect(mocks.createClientNotification).not.toHaveBeenCalled()
  })

  it('skips the client author saving their own shared look', async () => {
    await notifyLookSaved({
      lookPostId: 'look_1',
      look: CLIENT_LOOK,
      actor: client('client_author', 'user_author'),
      count: 1,
      now: NOW,
    })

    expect(mocks.createProNotification).not.toHaveBeenCalled()
    expect(mocks.createClientNotification).not.toHaveBeenCalled()
  })

  it('still notifies the client author when the LOOK PRO likes a client-shared look', async () => {
    await notifyLookLiked({
      lookPostId: 'look_1',
      look: CLIENT_LOOK,
      actor: pro('pro_1', 'user_pro'),
      count: 1,
      now: NOW,
    })

    expect(mocks.createClientNotification).toHaveBeenCalledTimes(1)
    expect(mocks.createClientNotification).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: 'client_author' }),
    )
  })

  it('clamps a nonsensical count to 1', async () => {
    await notifyLookLiked({
      lookPostId: 'look_1',
      look: PRO_LOOK,
      actor: client('client_2', 'user_2'),
      count: 0,
      now: NOW,
    })

    expect(mocks.createProNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Someone liked your look',
        data: expect.objectContaining({ count: 1 }),
      }),
    )
  })
})
