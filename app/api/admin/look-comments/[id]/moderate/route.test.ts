// app/api/admin/look-comments/[id]/moderate/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  handleAdminModerationRoute: vi.fn(),
}))

vi.mock('@/lib/adminModeration/service', () => ({
  handleAdminModerationRoute: mocks.handleAdminModerationRoute,
}))

import { POST } from './route'

function asNextRequest(req: Request): NextRequest {
  return req as unknown as NextRequest
}

function makeJsonRequest(body: unknown): NextRequest {
  return asNextRequest(
    new Request('http://localhost/api/admin/look-comments/comment_1/moderate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    }),
  )
}

function makeCtx(id: string) {
  return {
    params: { id },
  }
}

describe('app/api/admin/look-comments/[id]/moderate/route.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('delegates POST to the shared admin moderation handler with LOOK_COMMENT kind and route id', async () => {
    const delegated = Response.json(
      {
        ok: true,
        target: {
          kind: 'LOOK_COMMENT',
          id: 'comment_1',
          lookPostId: 'look_9',
        },
        action: 'remove',
        result: {
          id: 'comment_1',
          lookPostId: 'look_9',
          moderationStatus: 'REMOVED',
          commentsCount: 7,
        },
      },
      { status: 200 },
    )

    mocks.handleAdminModerationRoute.mockResolvedValue(delegated)

    const req = makeJsonRequest({ action: 'remove' })
    const res = await POST(req, makeCtx('comment_1'))

    expect(mocks.handleAdminModerationRoute).toHaveBeenCalledTimes(1)
    expect(mocks.handleAdminModerationRoute).toHaveBeenCalledWith(req, {
      kind: 'LOOK_COMMENT',
      targetId: 'comment_1',
    })
    expect(res).toBe(delegated)
  })

  it('awaits promised params before delegating', async () => {
    const delegated = Response.json(
      {
        ok: false,
        error: 'Look comment not found.',
      },
      { status: 404 },
    )

    mocks.handleAdminModerationRoute.mockResolvedValue(delegated)

    const req = makeJsonRequest({ action: 'reject' })
    const res = await POST(req, {
      params: Promise.resolve({ id: 'comment_missing' }),
    })

    expect(mocks.handleAdminModerationRoute).toHaveBeenCalledTimes(1)
    expect(mocks.handleAdminModerationRoute).toHaveBeenCalledWith(req, {
      kind: 'LOOK_COMMENT',
      targetId: 'comment_missing',
    })
    expect(res).toBe(delegated)
  })

  it('passes through delegated error responses unchanged', async () => {
    const delegated = Response.json(
      {
        ok: false,
        error: 'Invalid look comment moderation action.',
      },
      { status: 400 },
    )

    mocks.handleAdminModerationRoute.mockResolvedValue(delegated)

    const req = makeJsonRequest({ action: 'mark_in_review' })
    const res = await POST(req, makeCtx('comment_1'))
    const body = await res.json()

    expect(mocks.handleAdminModerationRoute).toHaveBeenCalledWith(req, {
      kind: 'LOOK_COMMENT',
      targetId: 'comment_1',
    })
    expect(res.status).toBe(400)
    expect(body).toEqual({
      ok: false,
      error: 'Invalid look comment moderation action.',
    })
  })
})