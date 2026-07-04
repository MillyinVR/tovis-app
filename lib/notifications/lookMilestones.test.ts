// lib/notifications/lookMilestones.test.ts
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
  LOOK_LIKE_MILESTONES,
  LOOK_SAVE_MILESTONES,
  buildLookMilestoneDedupeKey,
  crossedLookMilestones,
  notifyLookMilestones,
} from './lookMilestones'

const PRO_LOOK = { professionalId: 'pro_1', clientAuthorId: null }
const CLIENT_LOOK = { professionalId: 'pro_1', clientAuthorId: 'client_author' }

describe('crossedLookMilestones', () => {
  it('detects an upward crossing (before < T <= after)', () => {
    expect(crossedLookMilestones(49, 50, LOOK_LIKE_MILESTONES)).toEqual([50])
    expect(crossedLookMilestones(9, 10, LOOK_SAVE_MILESTONES)).toEqual([10])
  })

  it('detects multiple thresholds crossed in one jump', () => {
    expect(crossedLookMilestones(5, 60, LOOK_LIKE_MILESTONES)).toEqual([10, 50])
  })

  it('is inclusive on the current value and exclusive on the previous', () => {
    // exactly landing on the threshold counts; already-at-threshold does not
    expect(crossedLookMilestones(9, 10, LOOK_LIKE_MILESTONES)).toEqual([10])
    expect(crossedLookMilestones(10, 12, LOOK_LIKE_MILESTONES)).toEqual([])
  })

  it('never fires on a downward move (unlike / unsave)', () => {
    expect(crossedLookMilestones(50, 49, LOOK_LIKE_MILESTONES)).toEqual([])
    expect(crossedLookMilestones(100, 10, LOOK_LIKE_MILESTONES)).toEqual([])
  })

  it('returns nothing when no threshold sits in the interval', () => {
    expect(crossedLookMilestones(11, 12, LOOK_LIKE_MILESTONES)).toEqual([])
    expect(crossedLookMilestones(0, 0, LOOK_LIKE_MILESTONES)).toEqual([])
  })

  it('ignores non-finite inputs', () => {
    expect(crossedLookMilestones(Number.NaN, 50, LOOK_LIKE_MILESTONES)).toEqual(
      [],
    )
  })
})

describe('buildLookMilestoneDedupeKey', () => {
  it('is stable per look + metric + threshold (fires once ever)', () => {
    expect(buildLookMilestoneDedupeKey('likes', 'look_1', 50)).toBe(
      'look:look_1:milestone:likes:50',
    )
    expect(buildLookMilestoneDedupeKey('saves', 'look_1', 10)).toBe(
      'look:look_1:milestone:saves:10',
    )
  })
})

describe('notifyLookMilestones', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('notifies the pro author once per crossed like threshold', async () => {
    await notifyLookMilestones({
      lookPostId: 'look_1',
      look: PRO_LOOK,
      metric: 'likes',
      previous: 49,
      current: 50,
    })

    expect(mocks.createProNotification).toHaveBeenCalledTimes(1)
    expect(mocks.createClientNotification).not.toHaveBeenCalled()
    const arg = mocks.createProNotification.mock.calls[0]![0]
    expect(arg).toMatchObject({
      professionalId: 'pro_1',
      eventKey: NotificationEventKey.LOOK_MILESTONE_REACHED,
      title: 'Your look hit 50 likes',
      dedupeKey: 'look:look_1:milestone:likes:50',
      href: '/looks/look_1',
    })
    expect(arg.data).toMatchObject({
      lookPostId: 'look_1',
      metric: 'likes',
      threshold: 50,
    })
  })

  it('routes to the client author for a client-shared look (saves)', async () => {
    await notifyLookMilestones({
      lookPostId: 'look_1',
      look: CLIENT_LOOK,
      metric: 'saves',
      previous: 9,
      current: 10,
    })

    expect(mocks.createClientNotification).toHaveBeenCalledTimes(1)
    expect(mocks.createProNotification).not.toHaveBeenCalled()
    expect(mocks.createClientNotification.mock.calls[0]![0]).toMatchObject({
      clientId: 'client_author',
      title: 'Your look hit 10 saves',
      dedupeKey: 'look:look_1:milestone:saves:10',
    })
  })

  it('emits one notification per threshold when several are crossed at once', async () => {
    await notifyLookMilestones({
      lookPostId: 'look_1',
      look: PRO_LOOK,
      metric: 'likes',
      previous: 5,
      current: 60,
    })

    expect(mocks.createProNotification).toHaveBeenCalledTimes(2)
    const titles = mocks.createProNotification.mock.calls.map((c) => c[0].title)
    expect(titles).toEqual(['Your look hit 10 likes', 'Your look hit 50 likes'])
  })

  it('is a no-op when no threshold was crossed', async () => {
    await notifyLookMilestones({
      lookPostId: 'look_1',
      look: PRO_LOOK,
      metric: 'likes',
      previous: 11,
      current: 12,
    })

    expect(mocks.createProNotification).not.toHaveBeenCalled()
    expect(mocks.createClientNotification).not.toHaveBeenCalled()
  })
})
