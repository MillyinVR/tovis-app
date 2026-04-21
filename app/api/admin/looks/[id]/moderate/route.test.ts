// app/api/admin/looks/[id]/moderate/route.test.ts
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
    new Request('http://localhost/api/admin/looks/look_1/moderate', {
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

describe('app/api/admin/looks/[id]/moderate/route.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('delegates POST to the shared admin moderation handler with LOOK_POST kind and route id', async () => {
    const delegated = Response.json(
      {
        ok: true,
        target: {
          kind: 'LOOK_POST',
          id: 'look_1',
        },
        action: 'approve',
        result: {
          id: 'look_1',
          status: 'PUBLISHED',
          moderationStatus: 'APPROVED',
          archivedAt: null,
          removedAt: null,
        },
      },
      { status: 200 },
    )

    mocks.handleAdminModerationRoute.mockResolvedValue(delegated)

    const req = makeJsonRequest({ action: 'approve' })
    const res = await POST(req, makeCtx('look_1'))

    expect(mocks.handleAdminModerationRoute).toHaveBeenCalledTimes(1)
    expect(mocks.handleAdminModerationRoute).toHaveBeenCalledWith(req, {
      kind: 'LOOK_POST',
      targetId: 'look_1',
    })
    expect(res).toBe(delegated)
  })

  it('awaits promised params before delegating', async () => {
    const delegated = Response.json(
      {
        ok: false,
        error: 'Look post not found.',
      },
      { status: 404 },
    )

    mocks.handleAdminModerationRoute.mockResolvedValue(delegated)

    const req = makeJsonRequest({ action: 'reject' })
    const res = await POST(req, {
      params: Promise.resolve({ id: 'look_missing' }),
    })

    expect(mocks.handleAdminModerationRoute).toHaveBeenCalledTimes(1)
    expect(mocks.handleAdminModerationRoute).toHaveBeenCalledWith(req, {
      kind: 'LOOK_POST',
      targetId: 'look_missing',
    })
    expect(res).toBe(delegated)
  })

  it('passes through delegated error responses unchanged', async () => {
    const delegated = Response.json(
      {
        ok: false,
        error: 'Invalid look moderation action.',
      },
      { status: 400 },
    )

    mocks.handleAdminModerationRoute.mockResolvedValue(delegated)

    const req = makeJsonRequest({ action: 'definitely_not_real' })
    const res = await POST(req, makeCtx('look_1'))
    const body = await res.json()

    expect(mocks.handleAdminModerationRoute).toHaveBeenCalledWith(req, {
      kind: 'LOOK_POST',
      targetId: 'look_1',
    })
    expect(res.status).toBe(400)
    expect(body).toEqual({
      ok: false,
      error: 'Invalid look moderation action.',
    })
  })
})