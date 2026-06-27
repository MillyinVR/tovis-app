// app/api/v1/client/bookings/[id]/share-look/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  class FakeClientLookError extends Error {
    code: string
    httpStatus: number
    constructor(code: string, httpStatus: number, message: string) {
      super(message)
      this.code = code
      this.httpStatus = httpStatus
    }
  }

  return {
    requireClient: vi.fn(),
    pickString: vi.fn((v: unknown) =>
      typeof v === 'string' && v.trim() ? v.trim() : null,
    ),
    jsonFail: vi.fn((status: number, message: string) => ({ status, message })),
    resolveRouteParams: vi.fn(),
    withRouteIdempotency: vi.fn(),
    createClientLookFromVisit: vi.fn(),
    FakeClientLookError,
  }
})

const FakeClientLookError = mocks.FakeClientLookError

vi.mock('@/app/api/_utils', () => ({
  requireClient: mocks.requireClient,
  pickString: mocks.pickString,
  jsonFail: mocks.jsonFail,
}))

vi.mock('@/app/api/_utils/idempotency', () => ({
  // Drive the real `run` so we exercise the route's success path + status/body.
  withRouteIdempotency: (_args: unknown, run: (ctx: unknown) => Promise<unknown>) =>
    mocks.withRouteIdempotency(_args, run),
}))

vi.mock('@/app/api/_utils/routeContext', () => ({
  resolveRouteParams: mocks.resolveRouteParams,
}))

vi.mock('@/lib/looks/publication/clientLookService', () => ({
  createClientLookFromVisit: mocks.createClientLookFromVisit,
  ClientLookError: mocks.FakeClientLookError,
}))

import { POST } from './route'

function req(body: unknown): Request {
  return new Request('http://test/api/v1/client/bookings/b1/share-look', {
    method: 'POST',
    headers: { 'idempotency-key': 'k1', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const ctx = { params: Promise.resolve({ id: 'b1' }) }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireClient.mockResolvedValue({
    ok: true,
    user: { id: 'user_1' },
    clientId: 'client_1',
  })
  mocks.resolveRouteParams.mockResolvedValue({ id: 'b1' })
  mocks.withRouteIdempotency.mockImplementation(async (_args, run) => {
    const { status, body } = (await run({
      idempotencyKey: 'k1',
      idempotencyRecordId: 'r1',
      requestHash: 'h1',
    })) as { status: number; body: unknown }
    return { status, body }
  })
})

describe('POST share-look', () => {
  it('rejects a missing look name', async () => {
    const res = (await POST(req({ after: { uploadSessionId: 's' } }), ctx)) as never
    expect(res).toMatchObject({ status: 400 })
    expect(mocks.createClientLookFromVisit).not.toHaveBeenCalled()
  })

  it('rejects a missing after photo', async () => {
    const res = (await POST(req({ name: 'Look' }), ctx)) as never
    expect(res).toMatchObject({ status: 400 })
    expect(mocks.createClientLookFromVisit).not.toHaveBeenCalled()
  })

  it('publishes and returns 201 with the created look', async () => {
    mocks.createClientLookFromVisit.mockResolvedValue({
      lookPostId: 'look_1',
      visibility: 'PUBLIC',
      serviceId: 'svc_1',
      primaryMediaAssetId: 'media_1',
    })

    // Capture what the route's `run` callback returned (status + body) directly,
    // since the mocked idempotency wrapper passes it straight through.
    type RunResult = {
      status: number
      body: { ok: boolean; look: { id: string; visibility: string } }
    }
    let captured: RunResult | null = null
    mocks.withRouteIdempotency.mockImplementation(
      async (_a: unknown, run: (c: unknown) => Promise<unknown>) => {
        captured = (await run({
          idempotencyKey: 'k1',
          idempotencyRecordId: 'r1',
          requestHash: 'h1',
        })) as RunResult
        return captured
      },
    )

    await POST(
      req({
        name: 'Glazed',
        caption: 'nice',
        isPublic: true,
        after: { uploadSessionId: 's_after' },
        before: { reuseMediaAssetId: 'm_before' },
      }),
      ctx,
    )

    expect(captured).toMatchObject({
      status: 201,
      body: { ok: true, look: { id: 'look_1', visibility: 'PUBLIC' } },
    })

    expect(mocks.createClientLookFromVisit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        clientId: 'client_1',
        bookingId: 'b1',
        uploadedByUserId: 'user_1',
        name: 'Glazed',
        isPublic: true,
        after: { uploadSessionId: 's_after' },
        before: { reuseMediaAssetId: 'm_before' },
      }),
    )
  })

  it('maps a ClientLookError to its http status', async () => {
    mocks.withRouteIdempotency.mockImplementation(async (_args, run) =>
      run({ idempotencyKey: 'k', idempotencyRecordId: 'r', requestHash: 'h' }),
    )
    mocks.createClientLookFromVisit.mockRejectedValue(
      new FakeClientLookError('FORBIDDEN', 403, 'Not yours.'),
    )

    const res = (await POST(
      req({ name: 'X', after: { uploadSessionId: 's' } }),
      ctx,
    )) as never
    expect(res).toMatchObject({ status: 403, message: 'Not yours.' })
  })
})
