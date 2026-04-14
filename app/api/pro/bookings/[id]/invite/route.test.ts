import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ContactMethod, ProClientInviteStatus } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  requirePro: vi.fn(),
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),
  bookingFindFirst: vi.fn(),
  upsertClientClaimLink: vi.fn(),
  createClientClaimInviteDelivery: vi.fn(),
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

vi.mock('@/lib/clients/clientClaimLinks', () => ({
  upsertClientClaimLink: mocks.upsertClientClaimLink,
}))

vi.mock('@/lib/clientActions/createClientClaimInviteDelivery', () => ({
  createClientClaimInviteDelivery: mocks.createClientClaimInviteDelivery,
}))

import { POST } from './route'

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/pro/bookings/booking_1/invite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function makeBooking(overrides?: {
  id?: string
  clientId?: string
  userId?: string | null
}) {
  return {
    id: overrides?.id ?? 'booking_1',
    clientId: overrides?.clientId ?? 'client_123',
    client: {
      userId: overrides?.userId ?? null,
    },
  }
}

function makeInvite(overrides?: {
  id?: string
  token?: string
  status?: ProClientInviteStatus
  invitedName?: string
  invitedEmail?: string | null
  invitedPhone?: string | null
  preferredContactMethod?: ContactMethod | null
  acceptedAt?: Date | null
  revokedAt?: Date | null
}) {
  return {
    id: overrides?.id ?? 'invite_1',
    token: overrides?.token ?? 'token_1',
    status: overrides?.status ?? ProClientInviteStatus.PENDING,
    invitedName: overrides?.invitedName ?? 'Tori Morales',
    invitedEmail:
      overrides && 'invitedEmail' in overrides
        ? overrides.invitedEmail
        : 'tori@example.com',
    invitedPhone:
      overrides && 'invitedPhone' in overrides
        ? overrides.invitedPhone
        : null,
    preferredContactMethod:
      overrides && 'preferredContactMethod' in overrides
        ? overrides.preferredContactMethod
        : ContactMethod.EMAIL,
    acceptedAt:
      overrides && 'acceptedAt' in overrides ? overrides.acceptedAt : null,
    revokedAt:
      overrides && 'revokedAt' in overrides ? overrides.revokedAt : null,
  }
}

function makeInviteDeliveryResult() {
  return {
    plan: {
      idempotency: {
        baseKey: 'invite_base_1',
        sendKey: 'invite_send_1',
      },
    },
    link: {
      target: 'CLAIM',
      href: '/claim/token_1',
      tokenIncluded: true,
    },
    dispatch: {
      created: true,
      selectedChannels: [],
      evaluations: [],
      dispatch: {
        id: 'dispatch_1',
      },
    },
  }
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

    mocks.bookingFindFirst.mockResolvedValue(makeBooking())
    mocks.upsertClientClaimLink.mockResolvedValue(makeInvite())
    mocks.createClientClaimInviteDelivery.mockResolvedValue(
      makeInviteDeliveryResult(),
    )
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
    expect(mocks.upsertClientClaimLink).not.toHaveBeenCalled()
    expect(mocks.createClientClaimInviteDelivery).not.toHaveBeenCalled()
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
        clientId: true,
        client: {
          select: {
            userId: true,
          },
        },
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

    expect(mocks.upsertClientClaimLink).not.toHaveBeenCalled()
    expect(mocks.createClientClaimInviteDelivery).not.toHaveBeenCalled()
  })

  it('creates or updates a pending invite, queues delivery, and returns invite plus delivery summary', async () => {
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

    expect(mocks.upsertClientClaimLink).toHaveBeenCalledWith({
      professionalId: 'pro_123',
      clientId: 'client_123',
      bookingId: 'booking_1',
      invitedName: 'Tori Morales',
      invitedEmail: 'tori@example.com',
      invitedPhone: null,
      preferredContactMethod: ContactMethod.EMAIL,
    })

    expect(mocks.createClientClaimInviteDelivery).toHaveBeenCalledWith({
      professionalId: 'pro_123',
      clientId: 'client_123',
      bookingId: 'booking_1',
      inviteId: 'invite_1',
      rawToken: 'token_1',
      invitedName: 'Tori Morales',
      invitedEmail: 'tori@example.com',
      invitedPhone: null,
      preferredContactMethod: ContactMethod.EMAIL,
      issuedByUserId: 'user_123',
      recipientUserId: null,
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
        inviteDelivery: {
          attempted: true,
          queued: true,
          href: '/claim/token_1',
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
        inviteDelivery: {
          attempted: true,
          queued: true,
          href: '/claim/token_1',
        },
      },
    })
  })

  it('passes recipientUserId through when the booking client is already linked to a user', async () => {
    mocks.bookingFindFirst.mockResolvedValueOnce(
      makeBooking({
        userId: 'user_client_123',
      }),
    )

    await POST(
      makeRequest({
        name: 'Tori Morales',
        email: 'tori@example.com',
      }),
      {
        params: { id: 'booking_1' },
      },
    )

    expect(mocks.createClientClaimInviteDelivery).toHaveBeenCalledWith({
      professionalId: 'pro_123',
      clientId: 'client_123',
      bookingId: 'booking_1',
      inviteId: 'invite_1',
      rawToken: 'token_1',
      invitedName: 'Tori Morales',
      invitedEmail: 'tori@example.com',
      invitedPhone: null,
      preferredContactMethod: ContactMethod.EMAIL,
      issuedByUserId: 'user_123',
      recipientUserId: 'user_client_123',
    })
  })

  it('returns queued false when invite delivery enqueue fails but still returns 200 with the invite payload', async () => {
    mocks.createClientClaimInviteDelivery.mockRejectedValueOnce(
      new Error('dispatch enqueue failed'),
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

      expect(mocks.createClientClaimInviteDelivery).toHaveBeenCalledTimes(1)

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'POST /api/pro/bookings/[id]/invite delivery enqueue failed',
        expect.objectContaining({
          professionalId: 'pro_123',
          bookingId: 'booking_1',
          clientId: 'client_123',
          inviteId: 'invite_1',
          error: expect.any(Error),
        }),
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
          inviteDelivery: {
            attempted: true,
            queued: false,
            href: null,
          },
        },
      })
    } finally {
      consoleErrorSpy.mockRestore()
    }
  })

  it('does not attempt delivery for an already accepted invite', async () => {
    mocks.upsertClientClaimLink.mockResolvedValueOnce(
      makeInvite({
        status: ProClientInviteStatus.ACCEPTED,
        acceptedAt: new Date('2026-04-13T20:00:00.000Z'),
      }),
    )

    const result = await POST(
      makeRequest({
        name: 'Tori Morales',
        email: 'tori@example.com',
      }),
      {
        params: { id: 'booking_1' },
      },
    )

    expect(mocks.createClientClaimInviteDelivery).not.toHaveBeenCalled()

    expect(result).toEqual({
      ok: true,
      status: 200,
      data: {
        invite: {
          id: 'invite_1',
          token: 'token_1',
          status: ProClientInviteStatus.ACCEPTED,
          invitedName: 'Tori Morales',
          invitedEmail: 'tori@example.com',
          invitedPhone: null,
          preferredContactMethod: ContactMethod.EMAIL,
        },
        inviteDelivery: {
          attempted: false,
          queued: false,
          href: null,
        },
      },
    })
  })

  it('does not attempt delivery for a revoked invite', async () => {
    mocks.upsertClientClaimLink.mockResolvedValueOnce(
      makeInvite({
        status: ProClientInviteStatus.REVOKED,
        revokedAt: new Date('2026-04-13T20:00:00.000Z'),
      }),
    )

    const result = await POST(
      makeRequest({
        name: 'Tori Morales',
        email: 'tori@example.com',
      }),
      {
        params: { id: 'booking_1' },
      },
    )

    expect(mocks.createClientClaimInviteDelivery).not.toHaveBeenCalled()

    expect(result).toEqual({
      ok: true,
      status: 200,
      data: {
        invite: {
          id: 'invite_1',
          token: 'token_1',
          status: ProClientInviteStatus.REVOKED,
          invitedName: 'Tori Morales',
          invitedEmail: 'tori@example.com',
          invitedPhone: null,
          preferredContactMethod: ContactMethod.EMAIL,
        },
        inviteDelivery: {
          attempted: false,
          queued: false,
          href: null,
        },
      },
    })
  })

  it('returns INTERNAL_ERROR when invite creation throws', async () => {
    mocks.upsertClientClaimLink.mockRejectedValueOnce(
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