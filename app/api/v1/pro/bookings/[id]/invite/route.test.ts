import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ContactMethod, ProClientInviteStatus } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  requirePro: vi.fn(),
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),
  bookingFindFirst: vi.fn(),
  issueClaimLinkForBooking: vi.fn(),
  claimLinkRefusalResponse: vi.fn(),
  createClientClaimInviteDelivery: vi.fn(),
  enforceRateLimit: vi.fn(),
  tokenRateLimitIdentity: vi.fn(),
  safeError: vi.fn(),
  safeLogMeta: vi.fn(),
}))


vi.mock('@/lib/tenant/requestContext', () => ({
  resolveTenantContextForRequest: vi.fn(async () => ({
    isRoot: true,
    tenantId: 'tenant_root',
    slug: 'tovis-root',
  })),
}))

vi.mock('@/app/api/_utils', () => ({
  requirePro: mocks.requirePro,
  jsonFail: mocks.jsonFail,
  jsonOk: mocks.jsonOk,
}))

vi.mock('@/app/api/_utils/rateLimit', () => ({
  enforceRateLimit: mocks.enforceRateLimit,
  tokenRateLimitIdentity: mocks.tokenRateLimitIdentity,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    booking: {
      findFirst: mocks.bookingFindFirst,
    },
  },
}))

vi.mock('@/lib/clients/clientClaimLinks', () => ({
  issueClaimLinkForBooking: mocks.issueClaimLinkForBooking,
}))

vi.mock('@/app/api/_utils/claimInviteRefusals', () => ({
  claimLinkRefusalResponse: mocks.claimLinkRefusalResponse,
}))

vi.mock('@/lib/clientActions/createClientClaimInviteDelivery', () => ({
  createClientClaimInviteDelivery: mocks.createClientClaimInviteDelivery,
}))

vi.mock('@/lib/security/logging', () => ({
  safeError: mocks.safeError,
  safeLogMeta: mocks.safeLogMeta,
}))

import { POST } from './route'

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/v1/pro/bookings/booking_1/invite', {
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

/**
 * The issuer's success shape. `created` is the load-bearing half: false means
 * the token was ROTATED on an existing row, so the delivery must open a fresh
 * send cycle rather than collapse into the first invite's idempotency key.
 */
function makeIssued(overrides?: {
  rawToken?: string
  created?: boolean
  invite?: ReturnType<typeof makeInvite>
}) {
  return {
    kind: 'ok' as const,
    rawToken: overrides?.rawToken ?? 'token_1',
    created: overrides?.created ?? true,
    invite: overrides?.invite ?? makeInvite(),
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

describe('POST /api/v1/pro/bookings/[id]/invite', () => {
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

    // Default: under the ceiling. `enforceRateLimit` returns a Response when it
    // refuses and null when it allows, so null is "allowed".
    mocks.enforceRateLimit.mockResolvedValue(null)
    mocks.claimLinkRefusalResponse.mockImplementation((kind: string) => ({
      ok: false,
      status: 409,
      refusal: kind,
    }))
    mocks.tokenRateLimitIdentity.mockImplementation((id: string) => ({
      kind: 'token' as const,
      id,
    }))

    mocks.bookingFindFirst.mockResolvedValue(makeBooking())
    mocks.issueClaimLinkForBooking.mockResolvedValue(makeIssued())
    mocks.createClientClaimInviteDelivery.mockResolvedValue(
      makeInviteDeliveryResult(),
    )
    mocks.safeError.mockImplementation((error: unknown) => ({
      name: error instanceof Error ? error.name : 'UnknownError',
      message: error instanceof Error ? error.message : String(error),
    }))

    mocks.safeLogMeta.mockImplementation((meta: unknown) => meta)
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
    expect(mocks.issueClaimLinkForBooking).not.toHaveBeenCalled()
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

  it('returns 404 when the booking is not owned by the authenticated pro', async () => {
    // Unified via requireProBooking: the ownership query is scoped to the pro,
    // so a foreign booking is indistinguishable from a missing one (404), and
    // the API no longer leaks that another pro's booking exists.
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

    expect(mocks.jsonFail).toHaveBeenCalledWith(404, 'Booking not found.')

    expect(result).toEqual({
      ok: false,
      status: 404,
      error: 'Booking not found.',
    })

    expect(mocks.issueClaimLinkForBooking).not.toHaveBeenCalled()
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

    expect(mocks.issueClaimLinkForBooking).toHaveBeenCalledWith({
      bookingId: 'booking_1',
      contact: {
        invitedName: 'Tori Morales',
        invitedEmail: 'tori@example.com',
        invitedPhone: null,
        preferredContactMethod: ContactMethod.EMAIL,
      },
    })

    expect(mocks.createClientClaimInviteDelivery).toHaveBeenCalledWith({
      tenantContext: { isRoot: true, tenantId: 'tenant_root', slug: 'tovis-root' },
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
      resendMode: 'INITIAL_SEND',
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
      tenantContext: { isRoot: true, tenantId: 'tenant_root', slug: 'tovis-root' },
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
      resendMode: 'INITIAL_SEND',
    })
  })

  it('returns queued false when invite delivery enqueue fails but still returns 200 with the invite payload', async () => {
    const error = new Error('dispatch enqueue failed')

    mocks.createClientClaimInviteDelivery.mockRejectedValueOnce(error)

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

      expect(mocks.safeError).toHaveBeenCalledWith(error)
      expect(mocks.safeLogMeta).toHaveBeenCalledWith({
        route: 'POST /api/v1/pro/bookings/[id]/invite',
        professionalId: 'pro_123',
        bookingId: 'booking_1',
        clientId: 'client_123',
        inviteId: 'invite_1',
      })

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'POST /api/v1/pro/bookings/[id]/invite delivery enqueue failed',
        {
          error: {
            name: 'Error',
            message: 'dispatch enqueue failed',
          },
          meta: {
            route: 'POST /api/v1/pro/bookings/[id]/invite',
            professionalId: 'pro_123',
            bookingId: 'booking_1',
            clientId: 'client_123',
            inviteId: 'invite_1',
          },
        },
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
    mocks.issueClaimLinkForBooking.mockResolvedValueOnce(
      makeIssued({
        invite: makeInvite({
          status: ProClientInviteStatus.ACCEPTED,
          acceptedAt: new Date('2026-04-13T20:00:00.000Z'),
        }),
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

  // The bug this route shipped with: `upsertClientClaimLink` returned the
  // EXISTING row untouched on a repeat invite, and its rawToken came from the
  // deprecated plaintext `ProClientInvite.token` column — null on every modern
  // row. So the second invite for a booking sent nothing AND handed the pro no
  // link to pass on by hand, behind a 200 whose only tell was two false flags.
  it('re-invites: rotates the token, sends again on a fresh cycle, and hands back a usable link', async () => {
    mocks.issueClaimLinkForBooking.mockResolvedValueOnce(
      makeIssued({ rawToken: 'token_2', created: false }),
    )
    mocks.createClientClaimInviteDelivery.mockResolvedValueOnce({
      ...makeInviteDeliveryResult(),
      link: { target: 'CLAIM', href: '/claim/token_2', tokenIncluded: true },
    })

    const result = await POST(
      makeRequest({
        name: 'Tori Morales',
        email: 'tori@example.com',
      }),
      {
        params: { id: 'booking_1' },
      },
    )

    // RESEND, not INITIAL_SEND: the rotated token is the send-cycle
    // discriminator, and `resolveSendCycleDiscriminator` only consults it on
    // the RESEND branch. INITIAL_SEND here would silently deliver nothing.
    expect(mocks.createClientClaimInviteDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        rawToken: 'token_2',
        resendMode: 'RESEND',
      }),
    )

    expect(result).toEqual({
      ok: true,
      status: 200,
      data: {
        invite: {
          id: 'invite_1',
          // The freshly rotated token, never the null legacy column.
          token: 'token_2',
          status: ProClientInviteStatus.PENDING,
          invitedName: 'Tori Morales',
          invitedEmail: 'tori@example.com',
          invitedPhone: null,
          preferredContactMethod: ContactMethod.EMAIL,
        },
        inviteDelivery: {
          attempted: true,
          queued: true,
          href: '/claim/token_2',
        },
      },
    })
  })

  // Honesty half: a dispatch that collapsed into an existing send (an exact
  // retry of the SAME token) must not be reported as queued.
  it('reports queued false when the dispatch collapsed into an existing send', async () => {
    mocks.createClientClaimInviteDelivery.mockResolvedValueOnce({
      ...makeInviteDeliveryResult(),
      dispatch: { ...makeInviteDeliveryResult().dispatch, created: false },
    })

    const result = await POST(
      makeRequest({ name: 'Tori Morales', email: 'tori@example.com' }),
      { params: { id: 'booking_1' } },
    )

    expect(result).toMatchObject({
      data: {
        inviteDelivery: { attempted: true, queued: false, href: '/claim/token_1' },
      },
    })
  })

  it('returns 409 for a revoked claim link rather than a 200 that sent nothing', async () => {
    mocks.issueClaimLinkForBooking.mockResolvedValueOnce({ kind: 'revoked' })

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
    expect(mocks.claimLinkRefusalResponse).toHaveBeenCalledWith('revoked')
    expect(result).toMatchObject({ ok: false, status: 409, refusal: 'revoked' })
  })

  it('returns 409 when the client has already claimed their profile', async () => {
    mocks.issueClaimLinkForBooking.mockResolvedValueOnce({
      kind: 'already_claimed',
    })

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
    expect(mocks.claimLinkRefusalResponse).toHaveBeenCalledWith(
      'already_claimed',
    )
    expect(result).toMatchObject({
      ok: false,
      status: 409,
      refusal: 'already_claimed',
    })
  })

  it('returns 404 when the issuer cannot find the booking', async () => {
    mocks.issueClaimLinkForBooking.mockResolvedValueOnce({ kind: 'not_found' })

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
    expect(mocks.jsonFail).toHaveBeenCalledWith(404, 'Booking not found.', {
      code: 'NOT_FOUND',
    })
    expect(result).toMatchObject({
      ok: false,
      status: 404,
      code: 'NOT_FOUND',
    })
  })

  it('returns INTERNAL_ERROR when invite creation throws', async () => {
    const error = new Error('invite helper exploded')

    mocks.issueClaimLinkForBooking.mockRejectedValueOnce(error)

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

      expect(mocks.safeError).toHaveBeenCalledWith(error)
      expect(mocks.safeLogMeta).toHaveBeenCalledWith({
        route: 'POST /api/v1/pro/bookings/[id]/invite',
      })

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'POST /api/v1/pro/bookings/[id]/invite error',
        {
          error: {
            name: 'Error',
            message: 'invite helper exploded',
          },
          meta: {
            route: 'POST /api/v1/pro/bookings/[id]/invite',
          },
        },
      )
    } finally {
      consoleErrorSpy.mockRestore()
    }
  })

  // The ceiling on this route only means something if it lands in the SAME slot
  // as the booking-less sibling (POST /api/v1/pro/clients/[id]/invite). Both
  // doors mint a claim link and deliver it to a contact from the request body;
  // two doors keyed differently would be two ceilings, i.e. twice the spam.
  // `check:claim-invite-guarded` proves a limiter EXISTS on every such route —
  // it cannot see whether the key matches, so that is pinned here.
  it('bounds the send with the sibling door\'s exact bucket and key', async () => {
    await POST(makeRequest({ name: 'Tori Morales', email: 'tori@example.com' }), {
      params: Promise.resolve({ id: 'booking_1' }),
    })

    expect(mocks.tokenRateLimitIdentity).toHaveBeenCalledWith(
      'pro_123:client_123',
    )
    expect(mocks.enforceRateLimit).toHaveBeenCalledWith({
      bucket: 'pro:client-claim-invite',
      identity: { kind: 'token', id: 'pro_123:client_123' },
    })
  })

  it('returns the limiter response and neither mints nor delivers when throttled', async () => {
    const limited = { ok: false, status: 429, error: 'Too many requests.' }
    mocks.enforceRateLimit.mockResolvedValueOnce(limited)

    const result = await POST(
      makeRequest({ name: 'Tori Morales', phone: '+15551234567' }),
      { params: Promise.resolve({ id: 'booking_1' }) },
    )

    expect(result).toBe(limited)
    // The whole point: no token is minted and nothing is queued for delivery.
    expect(mocks.issueClaimLinkForBooking).not.toHaveBeenCalled()
    expect(mocks.createClientClaimInviteDelivery).not.toHaveBeenCalled()
  })
})
