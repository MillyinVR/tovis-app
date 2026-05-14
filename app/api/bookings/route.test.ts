// app/api/bookings/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  jsonFail: vi.fn(),
}))

vi.mock('@/app/api/_utils', () => ({
  jsonFail: mocks.jsonFail,
}))

import { GET, POST } from './route'

describe('app/api/bookings/route.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.jsonFail.mockImplementation(
      (status: number, error: string, extra?: unknown) => ({
        ok: false,
        status,
        error,
        ...(extra && typeof extra === 'object' ? extra : {}),
      }),
    )
  })

  it('GET returns method-not-allowed with read endpoint hints', async () => {
    const result = await GET()

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      405,
      'Method not allowed.',
      {
        code: 'METHOD_NOT_ALLOWED',
        allowedMethods: ['POST'],
        hint: {
          readClientBookings: 'GET /api/client/bookings',
          readProBookings: 'GET /api/pro/bookings',
        },
      },
    )

    expect(result).toEqual({
      ok: false,
      status: 405,
      error: 'Method not allowed.',
      code: 'METHOD_NOT_ALLOWED',
      allowedMethods: ['POST'],
      hint: {
        readClientBookings: 'GET /api/client/bookings',
        readProBookings: 'GET /api/pro/bookings',
      },
    })
  })

  it('POST returns deprecated-endpoint response with hold-to-finalize flow hint', async () => {
    const result = await POST()

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      410,
      'Direct booking creation has been deprecated.',
      {
        code: 'DEPRECATED_ENDPOINT',
        allowedMethods: ['POST'],
        hint: {
          correctFlow: {
            createHold: 'POST /api/holds',
            finalizeBooking: 'POST /api/bookings/finalize',
          },
          message: 'Create a booking hold first, then finalize the hold.',
        },
      },
    )

    expect(result).toEqual({
      ok: false,
      status: 410,
      error: 'Direct booking creation has been deprecated.',
      code: 'DEPRECATED_ENDPOINT',
      allowedMethods: ['POST'],
      hint: {
        correctFlow: {
          createHold: 'POST /api/holds',
          finalizeBooking: 'POST /api/bookings/finalize',
        },
        message: 'Create a booking hold first, then finalize the hold.',
      },
    })
  })
})