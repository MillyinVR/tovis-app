// lib/notifications/lookComments.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NotificationEventKey } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  createProNotification: vi.fn(),
  createClientNotification: vi.fn(),
  resolveLookActorPublicName: vi.fn(),
}))

vi.mock('./proNotifications', () => ({
  createProNotification: mocks.createProNotification,
}))

vi.mock('./clientNotifications', () => ({
  createClientNotification: mocks.createClientNotification,
}))

vi.mock('./social/resolveActorPublicName', () => ({
  resolveLookActorPublicName: mocks.resolveLookActorPublicName,
}))

import { notifyLookCommentCreated } from './lookComments'

type Identity = {
  userId: string
  clientProfileId: string | null
  professionalProfileId: string | null
}

const PRO_LOOK = { professionalId: 'pro_1', clientAuthorId: null }
const CLIENT_LOOK = { professionalId: 'pro_1', clientAuthorId: 'client_author' }

const COMMENT = { id: 'comment_1', body: 'Love this' }

function client(id: string, userId: string): Identity {
  return { userId, clientProfileId: id, professionalProfileId: null }
}

function pro(id: string, userId: string): Identity {
  return { userId, clientProfileId: null, professionalProfileId: id }
}

describe('notifyLookCommentCreated', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createProNotification.mockResolvedValue({ id: 'n1' })
    mocks.createClientNotification.mockResolvedValue({ id: 'n2' })
    // Default: no public identity → name-free titles (historical behavior).
    mocks.resolveLookActorPublicName.mockResolvedValue(null)
  })

  it('notifies the pro on a top-level comment from a stranger', async () => {
    await notifyLookCommentCreated({
      lookPostId: 'look_1',
      look: PRO_LOOK,
      comment: COMMENT,
      parent: null,
      actor: client('client_2', 'user_2'),
    })

    expect(mocks.createProNotification).toHaveBeenCalledTimes(1)
    expect(mocks.createProNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        professionalId: 'pro_1',
        eventKey: NotificationEventKey.LOOK_COMMENTED,
        title: 'New comment on your look',
        body: 'Love this',
        href: '/looks/look_1',
        dedupeKey: 'look-comment:comment_1',
        actorUserId: 'user_2',
        data: expect.objectContaining({
          lookPostId: 'look_1',
          commentId: 'comment_1',
          actorClientId: 'client_2',
        }),
      }),
    )
    expect(mocks.createClientNotification).not.toHaveBeenCalled()
  })

  it('personalizes the comment title with the actor public name when available', async () => {
    mocks.resolveLookActorPublicName.mockResolvedValue('@amy')

    await notifyLookCommentCreated({
      lookPostId: 'look_1',
      look: PRO_LOOK,
      comment: COMMENT,
      parent: null,
      actor: client('client_2', 'user_2'),
    })

    expect(mocks.createProNotification.mock.calls[0]?.[0].title).toBe(
      '@amy commented',
    )
  })

  it('routes LOOK_COMMENTED to the client author for client-shared looks', async () => {
    await notifyLookCommentCreated({
      lookPostId: 'look_1',
      look: CLIENT_LOOK,
      comment: COMMENT,
      parent: null,
      actor: pro('pro_1', 'user_pro'),
    })

    expect(mocks.createClientNotification).toHaveBeenCalledTimes(1)
    expect(mocks.createClientNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'client_author',
        eventKey: NotificationEventKey.LOOK_COMMENTED,
      }),
    )
    expect(mocks.createProNotification).not.toHaveBeenCalled()
  })

  it('skips self-comments by the look author (pro look)', async () => {
    await notifyLookCommentCreated({
      lookPostId: 'look_1',
      look: PRO_LOOK,
      comment: COMMENT,
      parent: null,
      actor: pro('pro_1', 'user_pro'),
    })

    expect(mocks.createProNotification).not.toHaveBeenCalled()
    expect(mocks.createClientNotification).not.toHaveBeenCalled()
  })

  it('skips self-comments by the client author (client-shared look)', async () => {
    await notifyLookCommentCreated({
      lookPostId: 'look_1',
      look: CLIENT_LOOK,
      comment: COMMENT,
      parent: null,
      actor: client('client_author', 'user_author'),
    })

    expect(mocks.createProNotification).not.toHaveBeenCalled()
    expect(mocks.createClientNotification).not.toHaveBeenCalled()
  })

  it('on a reply, notifies both the parent author and the look author', async () => {
    await notifyLookCommentCreated({
      lookPostId: 'look_1',
      look: PRO_LOOK,
      comment: COMMENT,
      parent: client('client_3', 'user_3'),
      actor: client('client_2', 'user_2'),
    })

    expect(mocks.createClientNotification).toHaveBeenCalledTimes(1)
    expect(mocks.createClientNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'client_3',
        eventKey: NotificationEventKey.LOOK_COMMENT_REPLIED,
        title: 'New reply to your comment',
        dedupeKey: 'look-comment-reply:comment_1',
      }),
    )
    expect(mocks.createProNotification).toHaveBeenCalledTimes(1)
    expect(mocks.createProNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        professionalId: 'pro_1',
        eventKey: NotificationEventKey.LOOK_COMMENTED,
      }),
    )
  })

  it('sends only the reply notification when the parent author IS the look author', async () => {
    await notifyLookCommentCreated({
      lookPostId: 'look_1',
      look: PRO_LOOK,
      comment: COMMENT,
      parent: pro('pro_1', 'user_pro'),
      actor: client('client_2', 'user_2'),
    })

    expect(mocks.createProNotification).toHaveBeenCalledTimes(1)
    expect(mocks.createProNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        eventKey: NotificationEventKey.LOOK_COMMENT_REPLIED,
      }),
    )
    expect(mocks.createClientNotification).not.toHaveBeenCalled()
  })

  it('skips the reply notification when replying to yourself (still notifies the look author)', async () => {
    await notifyLookCommentCreated({
      lookPostId: 'look_1',
      look: PRO_LOOK,
      comment: COMMENT,
      parent: client('client_2', 'user_2'),
      actor: client('client_2', 'user_2'),
    })

    expect(mocks.createClientNotification).not.toHaveBeenCalled()
    expect(mocks.createProNotification).toHaveBeenCalledTimes(1)
    expect(mocks.createProNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        eventKey: NotificationEventKey.LOOK_COMMENTED,
      }),
    )
  })

  it('truncates long comment bodies in the notification body', async () => {
    await notifyLookCommentCreated({
      lookPostId: 'look_1',
      look: PRO_LOOK,
      comment: { id: 'comment_1', body: 'x'.repeat(400) },
      parent: null,
      actor: client('client_2', 'user_2'),
    })

    const call = mocks.createProNotification.mock.calls[0]?.[0] as {
      body: string
    }
    expect(call.body.length).toBeLessThanOrEqual(140)
    expect(call.body.endsWith('…')).toBe(true)
  })
})
