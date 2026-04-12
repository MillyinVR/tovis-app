import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ContactMethod, ProClientInviteStatus } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  requirePro: vi.fn(),
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),
  bookingFindFirst: vi.fn(),
  createProClientInvite: vi.fn(),
}))

vi.mock('@/app/api/_utils', () => ({
  requirePro: mocks.requirePro,
  jsonFail: mocks.jsonFail,
  jsonOk: mocks.jsonOk,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    booking: {
      findFirst: mocks.bookingFindFirst,
    },
  },
}))

vi.mock('@/lib/invites/proClientInvite', () => ({
  createProClientInvite: mocks.createProClientInvite,
}))

import { POST } from './route'

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/pro/bookings/booking_1/invite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/pro/bookings/[id]/invite', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.requirePro.mockResolvedValue({
      ok: true,
      professionalId: 'pro_123',
      user: {
        id: 'user_123',
      },
    })

    mocks.jsonFail.mockImplementation(
      (status: number, error: string, extra?: unknown) => ({
        ok: false,
        status,
        error,
        ...(extra && typeof extra === 'object' ? extra : {}),
      }),
    )

    mocks.jsonOk.mockImplementation((data: unknown, status = 200) => ({
      ok: true,
      status,
      data,
    }))

    mocks.bookingFindFirst.mockResolvedValue({
      id: 'booking_1',
    })

    mocks.createProClientInvite.mockResolvedValue({
      id: 'invite_1',
      token: 'token_1',
      status: ProClientInviteStatus.PENDING,
      invitedName: 'Tori Morales',
      invitedEmail: 'tori@example.com',
      invitedPhone: null,
      preferredContactMethod: ContactMethod.EMAIL,
    })
  })

  it('returns auth response when requirePro fails', async () => {
    const authRes = { ok: false, status: 401, error: 'Unauthorized' }

    mocks.requirePro.mockResolvedValueOnce({
      ok: false,
      res: authRes,
    })

    const result = await POST(makeRequest({}), {
      params: { id: 'booking_1' },
    })

    expect(result).toBe(authRes)
    expect(mocks.bookingFindFirst).not.toHaveBeenCalled()
    expect(mocks.createProClientInvite).not.toHaveBeenCalled()
  })

  it('returns VALIDATION_ERROR when booking id is missing', async () => {
    const result = await POST(makeRequest({}), {
      params: { id: '   ' },
    })

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      400,
      'Missing booking id.',
      { code: 'VALIDATION_ERROR' },
    )

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'Missing booking id.',
      code: 'VALIDATION_ERROR',
    })
  })

  it('returns VALIDATION_ERROR when name is missing', async () => {
    const result = await POST(
      makeRequest({
        email: 'tori@example.com',
      }),
      {
        params: { id: 'booking_1' },
      },
    )

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      400,
      'Name is required.',
      { code: 'VALIDATION_ERROR' },
    )

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'Name is required.',
      code: 'VALIDATION_ERROR',
    })
  })

  it('returns VALIDATION_ERROR when both email and phone are missing', async () => {
    const result = await POST(
      makeRequest({
        name: 'Tori Morales',
      }),
      {
        params: { id: 'booking_1' },
      },
    )

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      400,
      'Email or phone is required.',
      { code: 'VALIDATION_ERROR' },
    )

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'Email or phone is required.',
      code: 'VALIDATION_ERROR',
    })
  })

  it('returns VALIDATION_ERROR when preferredContactMethod is invalid', async () => {
    const result = await POST(
      makeRequest({
        name: 'Tori Morales',
        email: 'tori@example.com',
        preferredContactMethod: 'PIGEON',
      }),
      {
        params: { id: 'booking_1' },
      },
    )

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      400,
      'Invalid preferredContactMethod.',
      { code: 'VALIDATION_ERROR' },
    )

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'Invalid preferredContactMethod.',
      code: 'VALIDATION_ERROR',
    })
  })

  it('returns VALIDATION_ERROR when preferredContactMethod is SMS without phone', async () => {
    const result = await POST(
      makeRequest({
        name: 'Tori Morales',
        email: 'tori@example.com',
        preferredContactMethod: 'SMS',
      }),
      {
        params: { id: 'booking_1' },
      },
    )

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      400,
      'Phone is required when preferredContactMethod is SMS.',
      { code: 'VALIDATION_ERROR' },
    )

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'Phone is required when preferredContactMethod is SMS.',
      code: 'VALIDATION_ERROR',
    })
  })

  it('returns VALIDATION_ERROR when preferredContactMethod is EMAIL without email', async () => {
    const result = await POST(
      makeRequest({
        name: 'Tori Morales',
        phone: '+16195551234',
        preferredContactMethod: 'EMAIL',
      }),
      {
        params: { id: 'booking_1' },
      },
    )

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      400,
      'Email is required when preferredContactMethod is EMAIL.',
      { code: 'VALIDATION_ERROR' },
    )

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'Email is required when preferredContactMethod is EMAIL.',
      code: 'VALIDATION_ERROR',
    })
  })

  it('returns FORBIDDEN when the booking is not owned by the authenticated pro', async () => {
    mocks.bookingFindFirst.mockResolvedValueOnce(null)

    const result = await POST(
      makeRequest({
        name: 'Tori Morales',
        email: 'tori@example.com',
      }),
      {
        params: { id: 'booking_1' },
      },
    )

    expect(mocks.bookingFindFirst).toHaveBeenCalledWith({
      where: {
        id: 'booking_1',
        professionalId: 'pro_123',
      },
      select: {
        id: true,
      },
    })

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      403,
      'Forbidden.',
      { code: 'FORBIDDEN' },
    )

    expect(result).toEqual({
      ok: false,
      status: 403,
      error: 'Forbidden.',
      code: 'FORBIDDEN',
    })

    expect(mocks.createProClientInvite).not.toHaveBeenCalled()
  })

  it('creates or updates an invite successfully and returns the invite payload', async () => {
    const result = await POST(
      makeRequest({
        name: '  Tori Morales  ',
        email: '  tori@example.com  ',
        preferredContactMethod: 'email',
      }),
      {
        params: Promise.resolve({ id: 'booking_1' }),
      },
    )

    expect(mocks.createProClientInvite).toHaveBeenCalledWith({
      professionalId: 'pro_123',
      bookingId: 'booking_1',
      invitedName: 'Tori Morales',
      invitedEmail: 'tori@example.com',
      invitedPhone: null,
      preferredContactMethod: ContactMethod.EMAIL,
    })

    expect(mocks.jsonOk).toHaveBeenCalledWith(
      {
        invite: {
          id: 'invite_1',
          token: 'token_1',
          status: ProClientInviteStatus.PENDING,
          invitedName: 'Tori Morales',
          invitedEmail: 'tori@example.com',
          invitedPhone: null,
          preferredContactMethod: ContactMethod.EMAIL,
        },
      },
      200,
    )

    expect(result).toEqual({
      ok: true,
      status: 200,
      data: {
        invite: {
          id: 'invite_1',
          token: 'token_1',
          status: ProClientInviteStatus.PENDING,
          invitedName: 'Tori Morales',
          invitedEmail: 'tori@example.com',
          invitedPhone: null,
          preferredContactMethod: ContactMethod.EMAIL,
        },
      },
    })
  })

  it('returns INTERNAL_ERROR when invite creation throws', async () => {
    mocks.createProClientInvite.mockRejectedValueOnce(
      new Error('invite helper exploded'),
    )

    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    try {
      const result = await POST(
        makeRequest({
          name: 'Tori Morales',
          email: 'tori@example.com',
        }),
        {
          params: { id: 'booking_1' },
        },
      )

      expect(mocks.jsonFail).toHaveBeenCalledWith(
        500,
        'Internal server error',
      )

      expect(result).toEqual({
        ok: false,
        status: 500,
        error: 'Internal server error',
      })

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'POST /api/pro/bookings/[id]/invite error',
        expect.any(Error),
      )
    } finally {
      consoleErrorSpy.mockRestore()
    }
  })
})