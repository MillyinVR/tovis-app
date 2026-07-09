import { NotificationEventKey } from '@prisma/client'
import { describe, expect, it } from 'vitest'

import {
  buildDigestHeadline,
  summarizeDigestRows,
  type DigestNotificationRow,
} from './summary'

function row(
  eventKey: NotificationEventKey,
  overrides: Partial<DigestNotificationRow> = {},
): DigestNotificationRow {
  return {
    eventKey,
    title: overrides.title ?? `title-${eventKey}`,
    href: overrides.href ?? `/looks/${eventKey}`,
    createdAt: overrides.createdAt ?? new Date('2026-07-01T00:00:00.000Z'),
    actorName: overrides.actorName ?? null,
  }
}

describe('summarizeDigestRows', () => {
  it('groups counts by display group and totals them', () => {
    const summary = summarizeDigestRows([
      row(NotificationEventKey.LOOK_LIKED),
      row(NotificationEventKey.LOOK_LIKED),
      row(NotificationEventKey.LOOK_COMMENTED),
      row(NotificationEventKey.LOOK_COMMENT_REPLIED),
      row(NotificationEventKey.CLIENT_FOLLOW),
    ])

    expect(summary.totalCount).toBe(5)

    const byKey = new Map(summary.groups.map((group) => [group.key, group]))
    expect(byKey.get('likes')?.count).toBe(2)
    expect(byKey.get('likes')?.label).toBe('2 new likes')
    // Comments group folds both comment + reply events.
    expect(byKey.get('comments')?.count).toBe(2)
    expect(byKey.get('followers')?.count).toBe(1)
    expect(byKey.get('followers')?.label).toBe('1 new follower')
  })

  it('preserves the configured group display order', () => {
    const summary = summarizeDigestRows([
      row(NotificationEventKey.LOOK_MILESTONE_REACHED),
      row(NotificationEventKey.CLIENT_FOLLOW),
      row(NotificationEventKey.LOOK_LIKED),
    ])

    expect(summary.groups.map((group) => group.key)).toEqual([
      'likes',
      'followers',
      'milestones',
    ])
  })

  it('returns the newest rows in the recent list, capped', () => {
    const summary = summarizeDigestRows(
      [
        row(NotificationEventKey.LOOK_LIKED, {
          title: 'old',
          createdAt: new Date('2026-07-01T00:00:00.000Z'),
        }),
        row(NotificationEventKey.LOOK_COMMENTED, {
          title: 'newest',
          createdAt: new Date('2026-07-03T00:00:00.000Z'),
        }),
        row(NotificationEventKey.LOOK_SAVED, {
          title: 'middle',
          createdAt: new Date('2026-07-02T00:00:00.000Z'),
        }),
      ],
      { maxRecentItems: 2 },
    )

    expect(summary.recent.map((item) => item.title)).toEqual([
      'newest',
      'middle',
    ])
  })

  it('ignores rows outside the digest groups', () => {
    const summary = summarizeDigestRows([
      row(NotificationEventKey.LOOK_LIKED),
      row(NotificationEventKey.BOOKING_CONFIRMED),
    ])

    expect(summary.totalCount).toBe(1)
    expect(summary.groups).toHaveLength(1)
  })

  it('returns an empty summary for no rows', () => {
    const summary = summarizeDigestRows([])
    expect(summary.totalCount).toBe(0)
    expect(summary.groups).toEqual([])
    expect(summary.recent).toEqual([])
    expect(summary.leadActorName).toBeNull()
  })

  it('picks the newest engagement actor name as the lead', () => {
    const summary = summarizeDigestRows([
      row(NotificationEventKey.LOOK_LIKED, {
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
        actorName: 'Older',
      }),
      row(NotificationEventKey.LOOK_COMMENTED, {
        createdAt: new Date('2026-07-03T00:00:00.000Z'),
        actorName: 'Jordan',
      }),
      // Newest row overall but no actor name (e.g. a milestone) — skipped.
      row(NotificationEventKey.LOOK_MILESTONE_REACHED, {
        createdAt: new Date('2026-07-04T00:00:00.000Z'),
      }),
    ])

    expect(summary.leadActorName).toBe('Jordan')
  })

  it('leaves the lead null when no row carries an actor name', () => {
    const summary = summarizeDigestRows([
      row(NotificationEventKey.CLIENT_FOLLOW),
      row(NotificationEventKey.LOOK_MILESTONE_REACHED),
    ])
    expect(summary.leadActorName).toBeNull()
  })
})

describe('buildDigestHeadline', () => {
  it('lists the top two groups and flags more', () => {
    const summary = summarizeDigestRows([
      row(NotificationEventKey.LOOK_LIKED),
      row(NotificationEventKey.LOOK_LIKED),
      row(NotificationEventKey.LOOK_COMMENTED),
      row(NotificationEventKey.CLIENT_FOLLOW),
    ])

    expect(buildDigestHeadline(summary)).toBe(
      '2 new likes & 1 new comment & more',
    )
  })

  it('renders a single group without an ampersand', () => {
    const summary = summarizeDigestRows([
      row(NotificationEventKey.CLIENT_FOLLOW),
    ])
    expect(buildDigestHeadline(summary)).toBe('1 new follower')
  })

  it('falls back to a generic line when empty', () => {
    expect(buildDigestHeadline(summarizeDigestRows([]))).toBe(
      'You have new activity',
    )
  })

  it('leads with the actor name and an others count when known', () => {
    const summary = summarizeDigestRows([
      row(NotificationEventKey.LOOK_LIKED, {
        createdAt: new Date('2026-07-03T00:00:00.000Z'),
        actorName: 'Maya',
      }),
      row(NotificationEventKey.LOOK_SAVED, {
        createdAt: new Date('2026-07-02T00:00:00.000Z'),
      }),
      row(NotificationEventKey.LOOK_COMMENTED, {
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
      }),
    ])

    expect(buildDigestHeadline(summary)).toBe(
      'Maya and 2 others engaged with your looks this week',
    )
  })

  it('uses the singular "other" for a count of two', () => {
    const summary = summarizeDigestRows([
      row(NotificationEventKey.LOOK_LIKED, {
        createdAt: new Date('2026-07-03T00:00:00.000Z'),
        actorName: 'Maya',
      }),
      row(NotificationEventKey.LOOK_SAVED, {
        createdAt: new Date('2026-07-02T00:00:00.000Z'),
      }),
    ])

    expect(buildDigestHeadline(summary)).toBe(
      'Maya and 1 other engaged with your looks this week',
    )
  })

  it('drops the others clause for a lone engagement', () => {
    const summary = summarizeDigestRows([
      row(NotificationEventKey.LOOK_LIKED, { actorName: 'Maya' }),
    ])

    expect(buildDigestHeadline(summary)).toBe(
      'Maya engaged with your looks this week',
    )
  })
})
