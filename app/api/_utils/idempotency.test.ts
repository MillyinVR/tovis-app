// app/api/_utils/idempotency.test.ts
import { Role } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  beginIdempotency: vi.fn(),
  completeIdempotency: vi.fn(),
  failIdempotency: vi.fn(),
}))

vi.mock('@/lib/idempotency', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/idempotency')>()

  return {
    ...actual,
    beginIdempotency: mocks.beginIdempotency,
    completeIdempotency: mocks.completeIdempotency,
    failIdempotency: mocks.failIdempotency,
  }
})

import { IDEMPOTENCY_ROUTES } from '@/lib/idempotency'
import {
  beginRouteIdempotency,
  completeRouteIdempotency,
  failStartedRouteIdempotency,
  isRouteIdempotencyHandled,
  readIdempotencyKey,
  withRouteIdempotency,
} from './idempotency'

const TEST_ROUTE = IDEMPOTENCY_ROUTES.BOOKING_FINALIZE
const TEST_OPERATION = 'POST /api/test'
const TEST_ACTOR = {
  actorUserId: 'user_1',
  actorRole: Role.CLIENT,
}

function requestWithHeaders(headers?: HeadersInit): Request {
  return new Request('https://app.test/api/test', {
    method: 'POST',
    headers,
  })
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const body: unknown = await response.json()

  if (!isJsonObject(body)) {
    throw new Error('Expected response JSON object.')
  }

  return body
}

describe('app/api/_utils/idempotency', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.beginIdempotency.mockReset()
    mocks.completeIdempotency.mockReset()
    mocks.failIdempotency.mockReset()

    mocks.completeIdempotency.mockResolvedValue(undefined)
    mocks.failIdempotency.mockResolvedValue(undefined)
  })

  describe('readIdempotencyKey', () => {
    it('reads idempotency-key', () => {
      const request = requestWithHeaders({
        'idempotency-key': ' idem_123 ',
      })

      expect(readIdempotencyKey(request)).toBe('idem_123')
    })

    it('falls back to x-idempotency-key', () => {
      const request = requestWithHeaders({
        'x-idempotency-key': ' idem_fallback ',
      })

      expect(readIdempotencyKey(request)).toBe('idem_fallback')
    })

    it('prefers idempotency-key over x-idempotency-key', () => {
      const request = requestWithHeaders({
        'idempotency-key': ' idem_primary ',
        'x-idempotency-key': ' idem_fallback ',
      })

      expect(readIdempotencyKey(request)).toBe('idem_primary')
    })

    it('returns null for missing or blank headers', () => {
      expect(readIdempotencyKey(requestWithHeaders())).toBeNull()

      expect(
        readIdempotencyKey(
          requestWithHeaders({
            'idempotency-key': '   ',
          }),
        ),
      ).toBeNull()
    })
  })

  describe('beginRouteIdempotency', () => {
    it('returns a handled 400 response when the idempotency key is missing', async () => {
      const result = await beginRouteIdempotency({
        request: requestWithHeaders(),
        actor: TEST_ACTOR,
        route: TEST_ROUTE,
        requestBody: { bookingId: 'booking_1' },
      })

      expect(isRouteIdempotencyHandled(result)).toBe(true)

      if (!isRouteIdempotencyHandled(result)) {
        throw new Error('Expected handled idempotency result.')
      }

      expect(result.response.status).toBe(400)
      await expect(readJson(result.response)).resolves.toMatchObject({
        ok: false,
        error: 'Missing idempotency key.',
        code: 'IDEMPOTENCY_KEY_REQUIRED',
      })

      expect(mocks.beginIdempotency).not.toHaveBeenCalled()
    })

    it('allows custom missing-key message', async () => {
      const result = await beginRouteIdempotency({
        request: requestWithHeaders(),
        actor: TEST_ACTOR,
        route: TEST_ROUTE,
        requestBody: { bookingId: 'booking_1' },
        messages: {
          missingKey: 'Cancel requests require an idempotency key.',
        },
      })

      if (!isRouteIdempotencyHandled(result)) {
        throw new Error('Expected handled idempotency result.')
      }

      expect(result.response.status).toBe(400)
      await expect(readJson(result.response)).resolves.toMatchObject({
        ok: false,
        error: 'Cancel requests require an idempotency key.',
        code: 'IDEMPOTENCY_KEY_REQUIRED',
      })
    })

    it('passes the normalized idempotency key to the ledger', async () => {
      mocks.beginIdempotency.mockResolvedValueOnce({
        kind: 'started',
        idempotencyRecordId: 'idem_record_1',
        requestHash: 'hash_1',
      })

      const requestBody = {
        bookingId: 'booking_1',
        reason: 'Client requested cancellation',
      }

      const result = await beginRouteIdempotency({
        request: requestWithHeaders({
          'idempotency-key': ' idem_123 ',
        }),
        actor: TEST_ACTOR,
        route: TEST_ROUTE,
        requestBody,
      })

      expect(mocks.beginIdempotency).toHaveBeenCalledWith({
        actor: TEST_ACTOR,
        route: TEST_ROUTE,
        key: 'idem_123',
        requestBody,
      })

      expect(result).toEqual({
        kind: 'started',
        idempotencyRecordId: 'idem_record_1',
        idempotencyKey: 'idem_123',
        requestHash: 'hash_1',
      })
    })

    it('returns a handled 400 response if the ledger reports missing_key', async () => {
      mocks.beginIdempotency.mockResolvedValueOnce({
        kind: 'missing_key',
      })

      const result = await beginRouteIdempotency({
        request: requestWithHeaders({
          'idempotency-key': 'idem_123',
        }),
        actor: TEST_ACTOR,
        route: TEST_ROUTE,
        requestBody: { bookingId: 'booking_1' },
      })

      if (!isRouteIdempotencyHandled(result)) {
        throw new Error('Expected handled idempotency result.')
      }

      expect(result.response.status).toBe(400)
      await expect(readJson(result.response)).resolves.toMatchObject({
        ok: false,
        error: 'Missing idempotency key.',
        code: 'IDEMPOTENCY_KEY_REQUIRED',
      })
    })

    it('returns a handled 409 response when a matching request is already in progress', async () => {
      mocks.beginIdempotency.mockResolvedValueOnce({
        kind: 'in_progress',
      })

      const result = await beginRouteIdempotency({
        request: requestWithHeaders({
          'idempotency-key': 'idem_123',
        }),
        actor: TEST_ACTOR,
        route: TEST_ROUTE,
        requestBody: { bookingId: 'booking_1' },
        requestLabel: 'cancel booking',
      })

      if (!isRouteIdempotencyHandled(result)) {
        throw new Error('Expected handled idempotency result.')
      }

      expect(result.response.status).toBe(409)
      await expect(readJson(result.response)).resolves.toMatchObject({
        ok: false,
        error: 'A matching cancel booking request is already in progress.',
        code: 'IDEMPOTENCY_REQUEST_IN_PROGRESS',
      })
    })

    it('allows custom in-progress message', async () => {
      mocks.beginIdempotency.mockResolvedValueOnce({
        kind: 'in_progress',
      })

      const result = await beginRouteIdempotency({
        request: requestWithHeaders({
          'idempotency-key': 'idem_123',
        }),
        actor: TEST_ACTOR,
        route: TEST_ROUTE,
        requestBody: { bookingId: 'booking_1' },
        messages: {
          inProgress: 'This booking cancellation is already running.',
        },
      })

      if (!isRouteIdempotencyHandled(result)) {
        throw new Error('Expected handled idempotency result.')
      }

      expect(result.response.status).toBe(409)
      await expect(readJson(result.response)).resolves.toMatchObject({
        ok: false,
        error: 'This booking cancellation is already running.',
        code: 'IDEMPOTENCY_REQUEST_IN_PROGRESS',
      })
    })

    it('returns a handled 409 response when the idempotency key conflicts with a different request body', async () => {
      mocks.beginIdempotency.mockResolvedValueOnce({
        kind: 'conflict',
      })

      const result = await beginRouteIdempotency({
        request: requestWithHeaders({
          'idempotency-key': 'idem_123',
        }),
        actor: TEST_ACTOR,
        route: TEST_ROUTE,
        requestBody: { bookingId: 'booking_1' },
      })

      if (!isRouteIdempotencyHandled(result)) {
        throw new Error('Expected handled idempotency result.')
      }

      expect(result.response.status).toBe(409)
      await expect(readJson(result.response)).resolves.toMatchObject({
        ok: false,
        error:
          'This idempotency key was already used with a different request body.',
        code: 'IDEMPOTENCY_KEY_CONFLICT',
      })
    })

    it('allows custom conflict message', async () => {
      mocks.beginIdempotency.mockResolvedValueOnce({
        kind: 'conflict',
      })

      const result = await beginRouteIdempotency({
        request: requestWithHeaders({
          'idempotency-key': 'idem_123',
        }),
        actor: TEST_ACTOR,
        route: TEST_ROUTE,
        requestBody: { bookingId: 'booking_1' },
        messages: {
          conflict:
            'This reschedule key was already used with different details.',
        },
      })

      if (!isRouteIdempotencyHandled(result)) {
        throw new Error('Expected handled idempotency result.')
      }

      expect(result.response.status).toBe(409)
      await expect(readJson(result.response)).resolves.toMatchObject({
        ok: false,
        error: 'This reschedule key was already used with different details.',
        code: 'IDEMPOTENCY_KEY_CONFLICT',
      })
    })

    it('replays the cached response when the ledger reports replay', async () => {
      mocks.beginIdempotency.mockResolvedValueOnce({
        kind: 'replay',
        responseStatus: 201,
        responseBody: {
          nextBookingId: 'booking_next',
          aftercare: {
            id: 'aftercare_1',
          },
        },
      })

      const result = await beginRouteIdempotency({
        request: requestWithHeaders({
          'idempotency-key': 'idem_123',
        }),
        actor: TEST_ACTOR,
        route: TEST_ROUTE,
        requestBody: { bookingId: 'booking_1' },
      })

      if (!isRouteIdempotencyHandled(result)) {
        throw new Error('Expected handled idempotency result.')
      }

      expect(result.response.status).toBe(201)
      await expect(readJson(result.response)).resolves.toMatchObject({
        ok: true,
        nextBookingId: 'booking_next',
        aftercare: {
          id: 'aftercare_1',
        },
      })
    })

    it('returns a started result when the ledger starts a new request', async () => {
      mocks.beginIdempotency.mockResolvedValueOnce({
        kind: 'started',
        idempotencyRecordId: 'idem_record_1',
        requestHash: 'hash_1',
      })

      const result = await beginRouteIdempotency({
        request: requestWithHeaders({
          'idempotency-key': 'idem_123',
        }),
        actor: TEST_ACTOR,
        route: TEST_ROUTE,
        requestBody: { bookingId: 'booking_1' },
      })

      expect(result).toEqual({
        kind: 'started',
        idempotencyRecordId: 'idem_record_1',
        idempotencyKey: 'idem_123',
        requestHash: 'hash_1',
      })
    })
  })

  describe('completeRouteIdempotency', () => {
    it('does nothing when no idempotency record id is provided', async () => {
      await completeRouteIdempotency({
        idempotencyRecordId: null,
        responseStatus: 200,
        responseBody: {
          ok: true,
        },
      })

      expect(mocks.completeIdempotency).not.toHaveBeenCalled()
    })

    it('completes the started ledger record', async () => {
      await completeRouteIdempotency({
        idempotencyRecordId: 'idem_record_1',
        responseStatus: 200,
        responseBody: {
          ok: true,
          bookingId: 'booking_1',
        },
      })

      expect(mocks.completeIdempotency).toHaveBeenCalledWith({
        idempotencyRecordId: 'idem_record_1',
        responseStatus: 200,
        responseBody: {
          ok: true,
          bookingId: 'booking_1',
        },
      })
    })
  })

  describe('failStartedRouteIdempotency', () => {
    it('does nothing when no idempotency record id is provided', async () => {
      await failStartedRouteIdempotency({
        idempotencyRecordId: undefined,
        operation: TEST_OPERATION,
      })

      expect(mocks.failIdempotency).not.toHaveBeenCalled()
    })

    it('fails the started ledger record', async () => {
      await failStartedRouteIdempotency({
        idempotencyRecordId: 'idem_record_1',
        operation: TEST_OPERATION,
      })

      expect(mocks.failIdempotency).toHaveBeenCalledWith({
        idempotencyRecordId: 'idem_record_1',
      })
    })

    it('swallows fail-ledger errors after logging', async () => {
      const consoleErrorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined)

      mocks.failIdempotency.mockRejectedValueOnce(
        new Error('ledger unavailable'),
      )

      await expect(
        failStartedRouteIdempotency({
          idempotencyRecordId: 'idem_record_1',
          operation: TEST_OPERATION,
        }),
      ).resolves.toBeUndefined()

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        `${TEST_OPERATION} idempotency failure update error:`,
        expect.any(Error),
      )

      consoleErrorSpy.mockRestore()
    })
  })

  describe('withRouteIdempotency', () => {
    function startedRequest(): Request {
      return requestWithHeaders({ 'idempotency-key': 'idem_wrap' })
    }

    it('returns the handled response without running work or completing', async () => {
      // No idempotency-key header => begin returns a handled 400.
      const run = vi.fn()

      const response = await withRouteIdempotency(
        {
          request: requestWithHeaders(),
          actor: TEST_ACTOR,
          route: TEST_ROUTE,
          requestBody: { bookingId: 'booking_1' },
          operation: TEST_OPERATION,
        },
        run,
      )

      expect(response.status).toBe(400)
      expect(run).not.toHaveBeenCalled()
      expect(mocks.beginIdempotency).not.toHaveBeenCalled()
      expect(mocks.completeIdempotency).not.toHaveBeenCalled()
      expect(mocks.failIdempotency).not.toHaveBeenCalled()
    })

    it('returns the replay response without running work', async () => {
      mocks.beginIdempotency.mockResolvedValueOnce({
        kind: 'replay',
        responseStatus: 201,
        responseBody: { bookingId: 'booking_replay' },
      })
      const run = vi.fn()

      const response = await withRouteIdempotency(
        {
          request: startedRequest(),
          actor: TEST_ACTOR,
          route: TEST_ROUTE,
          requestBody: { bookingId: 'booking_1' },
          operation: TEST_OPERATION,
        },
        run,
      )

      expect(response.status).toBe(201)
      await expect(readJson(response)).resolves.toMatchObject({
        bookingId: 'booking_replay',
      })
      expect(run).not.toHaveBeenCalled()
      expect(mocks.completeIdempotency).not.toHaveBeenCalled()
    })

    it('runs the work, completes with the result, and returns jsonOk', async () => {
      mocks.beginIdempotency.mockResolvedValueOnce({
        kind: 'started',
        idempotencyRecordId: 'idem_record_ok',
        requestHash: 'hash_ok',
      })

      const run = vi.fn().mockResolvedValue({
        status: 201,
        body: { bookingId: 'booking_created' },
      })

      const response = await withRouteIdempotency(
        {
          request: startedRequest(),
          actor: TEST_ACTOR,
          route: TEST_ROUTE,
          requestBody: { bookingId: 'booking_1' },
          operation: TEST_OPERATION,
        },
        run,
      )

      expect(run).toHaveBeenCalledWith({
        idempotencyKey: 'idem_wrap',
        idempotencyRecordId: 'idem_record_ok',
        requestHash: 'hash_ok',
      })

      expect(mocks.completeIdempotency).toHaveBeenCalledWith({
        idempotencyRecordId: 'idem_record_ok',
        responseStatus: 201,
        responseBody: { bookingId: 'booking_created' },
      })

      expect(mocks.failIdempotency).not.toHaveBeenCalled()
      expect(response.status).toBe(201)
      await expect(readJson(response)).resolves.toMatchObject({
        ok: true,
        bookingId: 'booking_created',
      })
    })

    it('marks the record failed and rethrows when the work throws', async () => {
      mocks.beginIdempotency.mockResolvedValueOnce({
        kind: 'started',
        idempotencyRecordId: 'idem_record_fail',
        requestHash: 'hash_fail',
      })

      const boom = new Error('work blew up')
      const run = vi.fn().mockRejectedValue(boom)

      await expect(
        withRouteIdempotency(
          {
            request: startedRequest(),
            actor: TEST_ACTOR,
            route: TEST_ROUTE,
            requestBody: { bookingId: 'booking_1' },
            operation: TEST_OPERATION,
          },
          run,
        ),
      ).rejects.toBe(boom)

      expect(mocks.failIdempotency).toHaveBeenCalledWith({
        idempotencyRecordId: 'idem_record_fail',
      })
      expect(mocks.completeIdempotency).not.toHaveBeenCalled()
    })
  })
})