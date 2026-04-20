// app/api/viral-service-requests/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  jsonOk: vi.fn(
    (data?: Record<string, unknown>, init?: number | ResponseInit) => {
      const status = typeof init === 'number' ? init : init?.status
      return Response.json(
        { ok: true, ...(data ?? {}) },
        { status: status ?? 200 },
      )
    },
  ),
  jsonFail: vi.fn(
    (
      status: number,
      error: string,
      extra?: Record<string, unknown>,
    ) => {
      return Response.json(
        { ok: false, error, ...(extra ?? {}) },
        { status },
      )
    },
  ),
  pickInt: vi.fn((value: string | null) => {
    if (value == null) return null
    const parsed = Number.parseInt(value, 10)
    return Number.isFinite(parsed) ? parsed : null
  }),
  requireClient: vi.fn(),
  prisma: {
    serviceCategory: {
      findUnique: vi.fn(),
    },
  },
  createClientViralRequest: vi.fn(),
  listClientViralRequests: vi.fn(),
  toViralRequestDto: vi.fn(),
}))

vi.mock('@/app/api/_utils', () => ({
  jsonOk: mocks.jsonOk,
  jsonFail: mocks.jsonFail,
  pickInt: mocks.pickInt,
}))

vi.mock('@/app/api/_utils/auth/requireClient', () => ({
  requireClient: mocks.requireClient,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: mocks.prisma,
}))

vi.mock('@/lib/viralRequests', () => ({
  createClientViralRequest: mocks.createClientViralRequest,
  listClientViralRequests: mocks.listClientViralRequests,
}))

vi.mock('@/lib/viralRequests/contracts', () => ({
  toViralRequestDto: mocks.toViralRequestDto,
}))

import { GET, POST } from './route'

function makeJsonRequest(
  method: 'GET' | 'POST',
  url = 'http://localhost/api/viral-service-requests',
  body?: unknown,
) {
  return new Request(url, {
    method,
    headers:
      body === undefined
        ? undefined
        : {
            'content-type': 'application/json',
          },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function makeTextRequest(
  method: 'POST',
  url = 'http://localhost/api/viral-service-requests',
  body = 'x',
) {
  return new Request(url, {
    method,
    headers: {
      'content-type': 'text/plain',
    },
    body,
  })
}

describe('app/api/viral-service-requests/route.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('GET', () => {
    it('passes through failed auth responses unchanged', async () => {
      const authRes = Response.json(
        { ok: false, error: 'Unauthorized' },
        { status: 401 },
      )

      mocks.requireClient.mockResolvedValue({
        ok: false,
        res: authRes,
      })

      const res = await GET(makeJsonRequest('GET'))

      expect(res).toBe(authRes)
      expect(mocks.listClientViralRequests).not.toHaveBeenCalled()
    })

    it('lists the current client requests and maps them to dto shape', async () => {
      const rows = [{ id: 'request_1' }, { id: 'request_2' }]

      mocks.requireClient.mockResolvedValue({
        ok: true,
        clientId: 'client_1',
        user: { id: 'user_1' },
      })

      mocks.listClientViralRequests.mockResolvedValue(rows)
      mocks.toViralRequestDto
        .mockReturnValueOnce({ id: 'request_1', status: 'REQUESTED' })
        .mockReturnValueOnce({ id: 'request_2', status: 'APPROVED' })

      const res = await GET(
        makeJsonRequest(
          'GET',
          'http://localhost/api/viral-service-requests?take=10&skip=2',
        ),
      )
      const body = await res.json()

      expect(mocks.pickInt).toHaveBeenNthCalledWith(1, '10')
      expect(mocks.pickInt).toHaveBeenNthCalledWith(2, '2')

      expect(mocks.listClientViralRequests).toHaveBeenCalledWith(
        mocks.prisma,
        'client_1',
        {
          take: 10,
          skip: 2,
        },
      )

      expect(mocks.toViralRequestDto).toHaveBeenCalledTimes(2)
      expect(mocks.toViralRequestDto.mock.calls[0]?.[0]).toEqual(rows[0])
      expect(mocks.toViralRequestDto.mock.calls[1]?.[0]).toEqual(rows[1])

      expect(res.status).toBe(200)
      expect(body).toEqual({
        ok: true,
        requests: [
          { id: 'request_1', status: 'REQUESTED' },
          { id: 'request_2', status: 'APPROVED' },
        ],
      })
    })

    it('returns 500 when listing throws', async () => {
      mocks.requireClient.mockResolvedValue({
        ok: true,
        clientId: 'client_1',
        user: { id: 'user_1' },
      })

      mocks.listClientViralRequests.mockRejectedValue(new Error('boom'))

      const res = await GET(makeJsonRequest('GET'))
      const body = await res.json()

      expect(res.status).toBe(500)
      expect(body).toEqual({
        ok: false,
        error: 'Couldn’t load viral requests. Try again.',
        code: 'INTERNAL',
      })
    })
  })

  describe('POST', () => {
    it('passes through failed auth responses unchanged', async () => {
      const authRes = Response.json(
        { ok: false, error: 'Unauthorized' },
        { status: 401 },
      )

      mocks.requireClient.mockResolvedValue({
        ok: false,
        res: authRes,
      })

      const res = await POST(
        makeJsonRequest('POST', undefined, {
          name: 'Wolf Cut',
        }),
      )

      expect(res).toBe(authRes)
      expect(mocks.createClientViralRequest).not.toHaveBeenCalled()
    })

    it('returns 415 for non-json content type', async () => {
      mocks.requireClient.mockResolvedValue({
        ok: true,
        clientId: 'client_1',
        user: { id: 'user_1' },
      })

      const res = await POST(makeTextRequest('POST'))
      const body = await res.json()

      expect(res.status).toBe(415)
      expect(body).toEqual({
        ok: false,
        error: 'Content-Type must be application/json.',
        code: 'UNSUPPORTED_MEDIA_TYPE',
      })
    })

    it('returns 400 when requestedCategoryId does not exist', async () => {
      mocks.requireClient.mockResolvedValue({
        ok: true,
        clientId: 'client_1',
        user: { id: 'user_1' },
      })

      mocks.prisma.serviceCategory.findUnique.mockResolvedValue(null)

      const res = await POST(
        makeJsonRequest('POST', undefined, {
          name: 'Wolf Cut',
          requestedCategoryId: 'cat_missing',
        }),
      )
      const body = await res.json()

      expect(mocks.prisma.serviceCategory.findUnique).toHaveBeenCalledWith({
        where: { id: 'cat_missing' },
        select: { id: true },
      })

      expect(mocks.createClientViralRequest).not.toHaveBeenCalled()

      expect(res.status).toBe(400)
      expect(body).toEqual({
        ok: false,
        error: 'Requested category not found.',
        code: 'INVALID_REQUESTED_CATEGORY_ID',
      })
    })

    it('creates a viral request and returns the mapped dto', async () => {
      const created = { id: 'request_1' }
      const mapped = { id: 'request_1', status: 'REQUESTED' }

      mocks.requireClient.mockResolvedValue({
        ok: true,
        clientId: 'client_1',
        user: { id: 'user_1' },
      })

      mocks.prisma.serviceCategory.findUnique.mockResolvedValue({ id: 'cat_1' })
      mocks.createClientViralRequest.mockResolvedValue(created)
      mocks.toViralRequestDto.mockReturnValue(mapped)

      const res = await POST(
        makeJsonRequest('POST', undefined, {
          name: ' Wolf Cut ',
          description: ' Trend inspo ',
          sourceUrl: ' https://example.com/inspo ',
          requestedCategoryId: ' cat_1 ',
          links: [' https://example.com/a ', 'https://example.com/b'],
          mediaUrls: [' https://example.com/m1 '],
        }),
      )
      const body = await res.json()

      expect(mocks.createClientViralRequest).toHaveBeenCalledWith(mocks.prisma, {
        clientId: 'client_1',
        name: 'Wolf Cut',
        description: 'Trend inspo',
        sourceUrl: 'https://example.com/inspo',
        requestedCategoryId: 'cat_1',
        links: ['https://example.com/a', 'https://example.com/b'],
        mediaUrls: ['https://example.com/m1'],
      })

      expect(mocks.toViralRequestDto).toHaveBeenCalledWith(created)

      expect(res.status).toBe(201)
      expect(body).toEqual({
        ok: true,
        request: mapped,
      })
    })

    it('passes undefined arrays through when links/mediaUrls are not arrays', async () => {
      const created = { id: 'request_1' }

      mocks.requireClient.mockResolvedValue({
        ok: true,
        clientId: 'client_1',
        user: { id: 'user_1' },
      })

      mocks.createClientViralRequest.mockResolvedValue(created)
      mocks.toViralRequestDto.mockReturnValue({
        id: 'request_1',
        status: 'REQUESTED',
      })

      await POST(
        makeJsonRequest('POST', undefined, {
          name: 'Wolf Cut',
          links: 'not-an-array',
          mediaUrls: null,
        }),
      )

      expect(mocks.createClientViralRequest).toHaveBeenCalledWith(mocks.prisma, {
        clientId: 'client_1',
        name: 'Wolf Cut',
        description: null,
        sourceUrl: null,
        requestedCategoryId: null,
        links: undefined,
        mediaUrls: undefined,
      })
    })

    it('returns 400 for known validation/input errors', async () => {
      mocks.requireClient.mockResolvedValue({
        ok: true,
        clientId: 'client_1',
        user: { id: 'user_1' },
      })

      mocks.createClientViralRequest.mockRejectedValue(
        new Error('sourceUrl must be a valid URL.'),
      )

      const res = await POST(
        makeJsonRequest('POST', undefined, {
          name: 'Wolf Cut',
          sourceUrl: 'bad-url',
        }),
      )
      const body = await res.json()

      expect(res.status).toBe(400)
      expect(body).toEqual({
        ok: false,
        error: 'sourceUrl must be a valid URL.',
        code: 'INVALID_VIRAL_REQUEST_INPUT',
      })
    })

    it('returns 500 for unexpected errors', async () => {
      mocks.requireClient.mockResolvedValue({
        ok: true,
        clientId: 'client_1',
        user: { id: 'user_1' },
      })

      mocks.createClientViralRequest.mockRejectedValue(new Error('boom'))

      const res = await POST(
        makeJsonRequest('POST', undefined, {
          name: 'Wolf Cut',
        }),
      )
      const body = await res.json()

      expect(res.status).toBe(500)
      expect(body).toEqual({
        ok: false,
        error: 'Couldn’t create viral request. Try again.',
        code: 'INTERNAL',
      })
    })
  })
})