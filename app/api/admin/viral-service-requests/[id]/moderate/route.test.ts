// app/api/admin/viral-service-requests/[id]/moderate/route.test.ts
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
    new Request(
      'http://localhost/api/admin/viral-service-requests/request_1/moderate',
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

describe('app/api/admin/viral-service-requests/[id]/moderate/route.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('delegates POST to the shared admin moderation handler with VIRAL_SERVICE_REQUEST kind and route id', async () => {
    const delegated = Response.json(
      {
        ok: true,
        target: {
          kind: 'VIRAL_SERVICE_REQUEST',
          id: 'request_1',
        },
        action: 'approve',
        result: {
          request: {
            id: 'request_1',
            status: 'APPROVED',
            moderationStatus: 'APPROVED',
            reviewedAt: '2026-04-20T00:00:00.000Z',
            reviewedByUserId: 'admin_1',
            approvedAt: '2026-04-20T00:00:00.000Z',
            rejectedAt: null,
            adminNotes: 'Looks good',
            name: 'Chrome aura nails',
            description: null,
            sourceUrl: null,
            links: [],
            mediaUrls: [],
            requestedCategoryId: 'cat_1',
            requestedCategory: null,
            createdAt: '2026-04-20T00:00:00.000Z',
            updatedAt: '2026-04-20T00:00:00.000Z',
          },
          notifications: {
            enqueued: true,
            matchedProfessionalIds: ['pro_1'],
            dispatchSourceKeys: ['dispatch_1'],
          },
        },
      },
      { status: 200 },
    )

    mocks.handleAdminModerationRoute.mockResolvedValue(delegated)

    const req = makeJsonRequest({
      action: 'approve',
      adminNotes: 'Looks good',
    })
    const res = await POST(req, makeCtx('request_1'))

    expect(mocks.handleAdminModerationRoute).toHaveBeenCalledTimes(1)
    expect(mocks.handleAdminModerationRoute).toHaveBeenCalledWith(req, {
      kind: 'VIRAL_SERVICE_REQUEST',
      targetId: 'request_1',
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

    mocks.handleAdminModerationRoute.mockResolvedValue(delegated)

    const req = makeJsonRequest({
      action: 'reject',
      adminNotes: 'Not a fit',
    })
    const res = await POST(req, {
      params: Promise.resolve({ id: 'request_missing' }),
    })

    expect(mocks.handleAdminModerationRoute).toHaveBeenCalledTimes(1)
    expect(mocks.handleAdminModerationRoute).toHaveBeenCalledWith(req, {
      kind: 'VIRAL_SERVICE_REQUEST',
      targetId: 'request_missing',
    })
    expect(res).toBe(delegated)
  })

  it('passes through delegated error responses unchanged', async () => {
    const delegated = Response.json(
      {
        ok: false,
        error: 'Invalid viral request moderation action.',
      },
      { status: 400 },
    )

    mocks.handleAdminModerationRoute.mockResolvedValue(delegated)

    const req = makeJsonRequest({
      action: 'remove',
    })
    const res = await POST(req, makeCtx('request_1'))
    const body = await res.json()

    expect(mocks.handleAdminModerationRoute).toHaveBeenCalledWith(req, {
      kind: 'VIRAL_SERVICE_REQUEST',
      targetId: 'request_1',
    })
    expect(res.status).toBe(400)
    expect(body).toEqual({
      ok: false,
      error: 'Invalid viral request moderation action.',
    })
  })
})