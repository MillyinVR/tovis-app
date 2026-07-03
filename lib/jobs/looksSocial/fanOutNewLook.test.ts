// lib/jobs/looksSocial/fanOutNewLook.test.ts
import { describe, expect, it } from 'vitest'
import {
  LookPostStatus,
  LookPostVisibility,
  ModerationStatus,
  NotificationEventKey,
} from '@prisma/client'

import {
  buildNewLookClientNotificationArgs,
  isFanOutEligibleLook,
} from './fanOutNewLook'

const ELIGIBLE = {
  status: LookPostStatus.PUBLISHED,
  moderationStatus: ModerationStatus.APPROVED,
  publishedAt: new Date('2026-07-03T12:00:00.000Z'),
  removedAt: null,
  visibility: LookPostVisibility.PUBLIC,
}

describe('isFanOutEligibleLook', () => {
  it('accepts a published, approved, public look', () => {
    expect(isFanOutEligibleLook(ELIGIBLE)).toBe(true)
  })

  it('accepts FOLLOWERS_ONLY (recipients are followers)', () => {
    expect(
      isFanOutEligibleLook({
        ...ELIGIBLE,
        visibility: LookPostVisibility.FOLLOWERS_ONLY,
      }),
    ).toBe(true)
  })

  it('rejects unlisted, unpublished, removed, and unapproved looks', () => {
    expect(
      isFanOutEligibleLook({
        ...ELIGIBLE,
        visibility: LookPostVisibility.UNLISTED,
      }),
    ).toBe(false)
    expect(
      isFanOutEligibleLook({ ...ELIGIBLE, status: LookPostStatus.DRAFT }),
    ).toBe(false)
    expect(
      isFanOutEligibleLook({ ...ELIGIBLE, publishedAt: null }),
    ).toBe(false)
    expect(
      isFanOutEligibleLook({
        ...ELIGIBLE,
        removedAt: new Date('2026-07-03T13:00:00.000Z'),
      }),
    ).toBe(false)
    expect(
      isFanOutEligibleLook({
        ...ELIGIBLE,
        moderationStatus: ModerationStatus.PENDING_REVIEW,
      }),
    ).toBe(false)
  })
})

describe('buildNewLookClientNotificationArgs', () => {
  it('builds a name-free notification with a per-look dedupe key', () => {
    const args = buildNewLookClientNotificationArgs({
      clientId: 'client_1',
      look: {
        id: 'look_1',
        professionalId: 'pro_1',
        caption: 'Fresh balayage for summer',
      },
    })

    expect(args).toEqual({
      clientId: 'client_1',
      eventKey: NotificationEventKey.LOOK_NEW_FROM_FOLLOWED_PRO,
      title: 'New look from a pro you follow',
      body: 'Fresh balayage for summer',
      href: '/looks/look_1',
      dedupeKey: 'look:look_1:new-look',
      data: {
        lookPostId: 'look_1',
        professionalId: 'pro_1',
      },
    })
  })

  it('collapses whitespace and truncates a long caption', () => {
    const args = buildNewLookClientNotificationArgs({
      clientId: 'client_1',
      look: {
        id: 'look_1',
        professionalId: 'pro_1',
        caption: `  ${'very '.repeat(40)}long  \n caption  `,
      },
    })

    expect(args.body ? args.body.length : 0).toBeLessThanOrEqual(140)
    expect(args.body?.endsWith('…')).toBe(true)
    expect(args.body?.includes('\n')).toBe(false)
  })

  it('omits the body when the caption is empty', () => {
    const args = buildNewLookClientNotificationArgs({
      clientId: 'client_1',
      look: { id: 'look_1', professionalId: 'pro_1', caption: null },
    })

    expect(args.body).toBeNull()
  })

  it('throws on a blank look id', () => {
    expect(() =>
      buildNewLookClientNotificationArgs({
        clientId: 'client_1',
        look: { id: '  ', professionalId: 'pro_1', caption: null },
      }),
    ).toThrowError()
  })
})
