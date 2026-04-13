import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ClientActionTokenKind,
  Prisma,
} from '@prisma/client'

const mocks = vi.hoisted(() => ({
  prisma: {
    clientActionToken: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    aftercareSummary: {
      findUnique: vi.fn(),
    },
  },
  hashClientActionToken: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: mocks.prisma,
}))

vi.mock('@/lib/consultation/clientActionTokens', () => ({
  hashClientActionToken: mocks.hashClientActionToken,
}))

import { resolveAftercareAccessByToken } from './unclaimedAftercareAccess'

function makeAftercareSummary(
  overrides?: Partial<Record<string, unknown>>,
) {
  return {
    id: 'aftercare_1',
    bookingId: 'booking_1',
    publicToken: 'legacy_public_token_1',
    notes: 'Drink water. Avoid heat for 24 hours.',
    rebookMode: 'REQUEST',
    rebookedFor: null,
    rebookWindowStart: new Date('2026-04-15T00:00:00.000Z'),
    rebookWindowEnd: new Date('2026-05-15T00:00:00.000Z'),
    draftSavedAt: new Date('2026-04-10T12:00:00.000Z'),
    sentToClientAt: new Date('2026-04-11T12:00:00.000Z'),
    lastEditedAt: new Date('2026-04-11T11:00:00.000Z'),
    version: 3,
    booking: {
      id: 'booking_1',
      clientId: 'client_1',
      professionalId: 'pro_1',
      serviceId: 'service_1',
      offeringId: 'offering_1',
      scheduledFor: new Date('2026-04-10T18:00:00.000Z'),
      status: 'COMPLETED',
      locationType: 'SALON',
      locationId: 'location_1',
      subtotalSnapshot: new Prisma.Decimal('125.00'),
      totalDurationMinutes: 75,
      service: {
        id: 'service_1',
        name: 'Haircut',
      },
      professional: {
        id: 'pro_1',
        businessName: 'TOVIS Studio',
        timeZone: 'America/Los_Angeles',
        location: 'Main Studio',
      },
    },
    ...(overrides ?? {}),
  }
}

function makeAftercareAccessToken(
  overrides?: Partial<Record<string, unknown>>,
) {
  const aftercareSummary =
    overrides?.aftercareSummary !== undefined
      ? overrides.aftercareSummary
      : makeAftercareSummary()

  return {
    id: 'token_row_1',
    kind: ClientActionTokenKind.AFTERCARE_ACCESS,
    singleUse: true,
    bookingId: 'booking_1',
    aftercareSummaryId: 'aftercare_1',
    clientId: 'client_1',
    professionalId: 'pro_1',
    expiresAt: new Date('2026-04-20T12:00:00.000Z'),
    firstUsedAt: null,
    lastUsedAt: null,
    useCount: 0,
    revokedAt: null,
    revokeReason: null,
    aftercareSummary,
    ...(overrides ?? {}),
  }
}

function makeTokenUsage(
  overrides?: Partial<Record<string, unknown>>,
) {
  return {
    id: 'token_row_1',
    expiresAt: new Date('2026-04-20T12:00:00.000Z'),
    firstUsedAt: new Date('2026-04-12T12:00:00.000Z'),
    lastUsedAt: new Date('2026-04-12T12:00:00.000Z'),
    useCount: 1,
    singleUse: true,
    ...(overrides ?? {}),
  }
}

describe('resolveAftercareAccessByToken', () => {
  const NOW = new Date('2026-04-12T12:00:00.000Z')

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    vi.clearAllMocks()

    mocks.hashClientActionToken.mockImplementation(
      (rawToken: string) => `hashed:${rawToken}`,
    )
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('throws AFTERCARE_TOKEN_MISSING when raw token is blank after trimming', async () => {
    await expect(
      resolveAftercareAccessByToken({ rawToken: '   ' }),
    ).rejects.toMatchObject({
      code: 'AFTERCARE_TOKEN_MISSING',
      userMessage: 'That aftercare link is invalid or expired.',
    })

    expect(mocks.hashClientActionToken).not.toHaveBeenCalled()
    expect(mocks.prisma.clientActionToken.findUnique).not.toHaveBeenCalled()
  })

  it('throws AFTERCARE_TOKEN_INVALID when token record is not found and does not fall back to legacy publicToken lookup', async () => {
    mocks.prisma.clientActionToken.findUnique.mockResolvedValueOnce(null)

    await expect(
      resolveAftercareAccessByToken({ rawToken: ' token_1 ' }),
    ).rejects.toMatchObject({
      code: 'AFTERCARE_TOKEN_INVALID',
      userMessage: 'That aftercare link is invalid or expired.',
    })

    expect(mocks.hashClientActionToken).toHaveBeenCalledWith('token_1')
    expect(mocks.prisma.clientActionToken.findUnique).toHaveBeenCalledWith({
      where: { tokenHash: 'hashed:token_1' },
      select: expect.any(Object),
    })
    expect(mocks.prisma.aftercareSummary.findUnique).not.toHaveBeenCalled()
  })

  it('throws AFTERCARE_TOKEN_INVALID when token kind is not AFTERCARE_ACCESS', async () => {
    mocks.prisma.clientActionToken.findUnique.mockResolvedValueOnce(
      makeAftercareAccessToken({
        kind: ClientActionTokenKind.CONSULTATION_ACTION,
      }),
    )

    await expect(
      resolveAftercareAccessByToken({ rawToken: 'token_2' }),
    ).rejects.toMatchObject({
      code: 'AFTERCARE_TOKEN_INVALID',
      userMessage: 'That aftercare link is invalid or expired.',
    })
  })

  it('throws the used-link message when a single-use token was already consumed', async () => {
    mocks.prisma.clientActionToken.findUnique.mockResolvedValueOnce(
      makeAftercareAccessToken({
        firstUsedAt: new Date('2026-04-12T11:00:00.000Z'),
      }),
    )

    await expect(
      resolveAftercareAccessByToken({ rawToken: 'token_3' }),
    ).rejects.toMatchObject({
      code: 'AFTERCARE_TOKEN_INVALID',
      userMessage: 'That aftercare link has already been used.',
    })
  })

  it('throws AFTERCARE_TOKEN_INVALID when aftercare summary has not been sent yet', async () => {
    mocks.prisma.clientActionToken.findUnique.mockResolvedValueOnce(
      makeAftercareAccessToken({
        aftercareSummary: makeAftercareSummary({
          sentToClientAt: null,
        }),
      }),
    )

    await expect(
      resolveAftercareAccessByToken({ rawToken: 'token_4' }),
    ).rejects.toMatchObject({
      code: 'AFTERCARE_TOKEN_INVALID',
      userMessage: 'That aftercare link is invalid or expired.',
    })
  })

  it('throws AFTERCARE_TOKEN_INVALID when token and aftercare booking context do not match', async () => {
    mocks.prisma.clientActionToken.findUnique.mockResolvedValueOnce(
      makeAftercareAccessToken({
        clientId: 'client_1',
        aftercareSummary: makeAftercareSummary({
          booking: {
            id: 'booking_1',
            clientId: 'client_999',
            professionalId: 'pro_1',
            serviceId: 'service_1',
            offeringId: 'offering_1',
            scheduledFor: new Date('2026-04-10T18:00:00.000Z'),
            status: 'COMPLETED',
            locationType: 'SALON',
            locationId: 'location_1',
            subtotalSnapshot: new Prisma.Decimal('125.00'),
            totalDurationMinutes: 75,
            service: {
              id: 'service_1',
              name: 'Haircut',
            },
            professional: {
              id: 'pro_1',
              businessName: 'TOVIS Studio',
              timeZone: 'America/Los_Angeles',
              location: 'Main Studio',
            },
          },
        }),
      }),
    )

    await expect(
      resolveAftercareAccessByToken({ rawToken: 'token_5' }),
    ).rejects.toMatchObject({
      code: 'AFTERCARE_TOKEN_INVALID',
      userMessage: 'That aftercare link is invalid or expired.',
    })
  })

  it('resolves token-backed access and consumes a single-use token exactly once', async () => {
    mocks.prisma.clientActionToken.findUnique
      .mockResolvedValueOnce(makeAftercareAccessToken())
      .mockResolvedValueOnce(makeTokenUsage())

    mocks.prisma.clientActionToken.updateMany.mockResolvedValueOnce({
      count: 1,
    })

    const result = await resolveAftercareAccessByToken({
      rawToken: 'token_6',
    })

    expect(mocks.prisma.clientActionToken.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'token_row_1',
        kind: ClientActionTokenKind.AFTERCARE_ACCESS,
        revokedAt: null,
        expiresAt: { gt: NOW },
        firstUsedAt: null,
      },
      data: {
        firstUsedAt: NOW,
        lastUsedAt: NOW,
        useCount: {
          increment: 1,
        },
      },
    })

    expect(result).toEqual({
      accessSource: 'clientActionToken',
      token: {
        id: 'token_row_1',
        expiresAt: new Date('2026-04-20T12:00:00.000Z'),
        firstUsedAt: new Date('2026-04-12T12:00:00.000Z'),
        lastUsedAt: new Date('2026-04-12T12:00:00.000Z'),
        useCount: 1,
        singleUse: true,
      },
      aftercare: {
        id: 'aftercare_1',
        bookingId: 'booking_1',
        publicToken: 'legacy_public_token_1',
        notes: 'Drink water. Avoid heat for 24 hours.',
        rebookMode: 'REQUEST',
        rebookedFor: null,
        rebookWindowStart: new Date('2026-04-15T00:00:00.000Z'),
        rebookWindowEnd: new Date('2026-05-15T00:00:00.000Z'),
        draftSavedAt: new Date('2026-04-10T12:00:00.000Z'),
        sentToClientAt: new Date('2026-04-11T12:00:00.000Z'),
        lastEditedAt: new Date('2026-04-11T11:00:00.000Z'),
        version: 3,
      },
      booking: {
        id: 'booking_1',
        clientId: 'client_1',
        professionalId: 'pro_1',
        serviceId: 'service_1',
        offeringId: 'offering_1',
        scheduledFor: new Date('2026-04-10T18:00:00.000Z'),
        status: 'COMPLETED',
        locationType: 'SALON',
        locationId: 'location_1',
        subtotalSnapshot: new Prisma.Decimal('125.00'),
        totalDurationMinutes: 75,
        service: {
          id: 'service_1',
          name: 'Haircut',
        },
        professional: {
          id: 'pro_1',
          businessName: 'TOVIS Studio',
          timeZone: 'America/Los_Angeles',
          location: 'Main Studio',
        },
      },
    })
  })

  it('retries multi-use access as an increment-only update when first-use marking loses a race', async () => {
    mocks.prisma.clientActionToken.findUnique
      .mockResolvedValueOnce(
        makeAftercareAccessToken({
          singleUse: false,
          firstUsedAt: null,
          useCount: 4,
        }),
      )
      .mockResolvedValueOnce(
        makeTokenUsage({
          firstUsedAt: new Date('2026-04-12T11:55:00.000Z'),
          lastUsedAt: NOW,
          useCount: 5,
          singleUse: false,
        }),
      )

    mocks.prisma.clientActionToken.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 })

    const result = await resolveAftercareAccessByToken({
      rawToken: 'token_7',
    })

    expect(mocks.prisma.clientActionToken.updateMany).toHaveBeenNthCalledWith(
      1,
      {
        where: {
          id: 'token_row_1',
          kind: ClientActionTokenKind.AFTERCARE_ACCESS,
          revokedAt: null,
          expiresAt: { gt: NOW },
          firstUsedAt: null,
        },
        data: {
          firstUsedAt: NOW,
          lastUsedAt: NOW,
          useCount: {
            increment: 1,
          },
        },
      },
    )

    expect(mocks.prisma.clientActionToken.updateMany).toHaveBeenNthCalledWith(
      2,
      {
        where: {
          id: 'token_row_1',
          kind: ClientActionTokenKind.AFTERCARE_ACCESS,
          revokedAt: null,
          expiresAt: { gt: NOW },
        },
        data: {
          lastUsedAt: NOW,
          useCount: {
            increment: 1,
          },
        },
      },
    )

    expect(result).toMatchObject({
      accessSource: 'clientActionToken',
      token: {
        id: 'token_row_1',
        firstUsedAt: new Date('2026-04-12T11:55:00.000Z'),
        lastUsedAt: NOW,
        useCount: 5,
        singleUse: false,
      },
    })
  })
})