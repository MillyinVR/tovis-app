// app/api/admin/viral-service-requests/[id]/approve/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  handleLegacyViralModerationRoute: vi.fn(),
}))

vi.mock('@/lib/adminModeration/service', () => ({
  handleLegacyViralModerationRoute: mocks.handleLegacyViralModerationRoute,
}))

import { POST } from './route'

function asNextRequest(req: Request): NextRequest {
  return req as unknown as NextRequest
}

function makeJsonRequest(body: unknown): NextRequest {
  return asNextRequest(
    new Request(
      'http://localhost/api/admin/viral-service-requests/request_1/approve',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      },
    ),
  )
}

function makeCtx(id: string) {
  return {
    params: { id },
  }
}

describe('app/api/admin/viral-service-requests/[id]/approve/route.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('delegates POST to the shared legacy viral moderation handler with forced approve action and route id', async () => {
    const delegated = Response.json(
      {
        ok: true,
        request: {
          id: 'request_1',
          status: 'APPROVED',
        },
        notifications: {
          enqueued: true,
          matchedProfessionalIds: ['pro_1', 'pro_2'],
          dispatchSourceKeys: ['k1', 'k2'],
        },
      },
      { status: 200 },
    )

    mocks.handleLegacyViralModerationRoute.mockResolvedValue(delegated)

    const req = makeJsonRequest({ adminNotes: 'Looks viable.' })
    const res = await POST(req, makeCtx('request_1'))

    expect(mocks.handleLegacyViralModerationRoute).toHaveBeenCalledTimes(1)
    expect(mocks.handleLegacyViralModerationRoute).toHaveBeenCalledWith(req, {
      targetId: 'request_1',
      forcedAction: 'approve',
    })
    expect(res).toBe(delegated)
  })

  it('awaits promised params before delegating', async () => {
    const delegated = Response.json(
      {
        ok: false,
        error: 'Viral request not found.',
      },
      { status: 404 },
    )

    mocks.handleLegacyViralModerationRoute.mockResolvedValue(delegated)

    const req = makeJsonRequest({ adminNotes: 'Nope' })
    const res = await POST(req, {
      params: Promise.resolve({ id: 'request_missing' }),
    })

    expect(mocks.handleLegacyViralModerationRoute).toHaveBeenCalledTimes(1)
    expect(mocks.handleLegacyViralModerationRoute).toHaveBeenCalledWith(req, {
      targetId: 'request_missing',
      forcedAction: 'approve',
    })
    expect(res).toBe(delegated)
  })

  it('passes through delegated error responses unchanged', async () => {
    const delegated = Response.json(
      {
        ok: false,
        error: 'Content-Type must be application/json.',
      },
      { status: 415 },
    )

    mocks.handleLegacyViralModerationRoute.mockResolvedValue(delegated)

    const req = makeJsonRequest({ adminNotes: 'x' })
    const res = await POST(req, makeCtx('request_1'))
    const body = await res.json()

    expect(mocks.handleLegacyViralModerationRoute).toHaveBeenCalledWith(req, {
      targetId: 'request_1',
      forcedAction: 'approve',
    })
    expect(res.status).toBe(415)
    expect(body).toEqual({
      ok: false,
      error: 'Content-Type must be application/json.',
    })
  })
})