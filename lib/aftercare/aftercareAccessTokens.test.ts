// lib/aftercare/aftercareAccessTokens.test.ts
import {
  AftercareRebookMode,
  BookingStatus,
  ClientActionTokenKind,
  Prisma,
  ServiceLocationType,
} from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BookingError } from '@/lib/booking/errors'

const NOW = new Date('2026-03-11T19:00:00.000Z')
const EXPIRES_AT = new Date('2026-03-20T19:00:00.000Z')

const mocks = vi.hoisted(() => ({
  clientActionTokenFindUnique: vi.fn(),
  clientActionTokenUpdateMany: vi.fn(),
  hashClientActionToken: vi.fn(),
  buildPublicAftercareTokenActorKey: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    clientActionToken: {
      findUnique: mocks.clientActionTokenFindUnique,
      updateMany: mocks.clientActionTokenUpdateMany,
    },
  },
}))

vi.mock('@/lib/consultation/clientActionTokens', () => ({
  hashClientActionToken: mocks.hashClientActionToken,
}))

vi.mock('@/lib/idempotency', () => ({
  buildPublicAftercareTokenActorKey: mocks.buildPublicAftercareTokenActorKey,
}))

import {
  markAftercareAccessTokenUsed,
  resolveAftercareAccessTokenForMutation,
  resolveAftercareAccessTokenForRead,
} from './aftercareAccessTokens'

function makeTokenRecord(overrides?: {
  id?: string
  kind?: ClientActionTokenKind
  bookingId?: string | null
  aftercareSummaryId?: string | null
  clientId?: string | null
  professionalId?: string | null
  expiresAt?: Date
  firstUsedAt?: Date | null
  lastUsedAt?: Date | null
  useCount?: number
  revokedAt?: Date | null
  revokeReason?: string | null
  singleUse?: boolean
  aftercareSummary?: ReturnType<typeof makeAftercareSummary> | null
}) {
    const aftercareSummaryId =
    overrides && 'aftercareSummaryId' in overrides
        ? overrides.aftercareSummaryId
        : 'aftercare_1'

    const bookingId =
    overrides && 'bookingId' in overrides ? overrides.bookingId : 'booking_old'

    const clientId =
    overrides && 'clientId' in overrides ? overrides.clientId : 'client_1'

    const professionalId =
    overrides && 'professionalId' in overrides
        ? overrides.professionalId
        : 'pro_1'

  return {
    id: overrides?.id ?? 'token_row_1',
    kind: overrides?.kind ?? ClientActionTokenKind.AFTERCARE_ACCESS,
    singleUse: overrides?.singleUse ?? false,
    bookingId,
    aftercareSummaryId,
    clientId,
    professionalId,
    expiresAt: overrides?.expiresAt ?? EXPIRES_AT,
    firstUsedAt:
      overrides && 'firstUsedAt' in overrides
        ? (overrides.firstUsedAt ?? null)
        : null,
    lastUsedAt:
      overrides && 'lastUsedAt' in overrides
        ? (overrides.lastUsedAt ?? null)
        : null,
    useCount: overrides?.useCount ?? 0,
    revokedAt:
      overrides && 'revokedAt' in overrides ? (overrides.revokedAt ?? null) : null,
    revokeReason:
      overrides && 'revokeReason' in overrides
        ? (overrides.revokeReason ?? null)
        : null,
    aftercareSummary:
    overrides && 'aftercareSummary' in overrides
        ? (overrides.aftercareSummary ?? null)
        : aftercareSummaryId
        ? makeAftercareSummary({
            id: aftercareSummaryId,
            bookingId: bookingId ?? 'booking_old',
            clientId: clientId ?? 'client_1',
            professionalId: professionalId ?? 'pro_1',
            })
        : null,
  }
}

function makeAftercareSummary(overrides?: {
  id?: string
  bookingId?: string
  clientId?: string
  professionalId?: string
  serviceId?: string | null
  offeringId?: string | null
  sentToClientAt?: Date | null
}) {
  const bookingId = overrides?.bookingId ?? 'booking_old'
  const clientId = overrides?.clientId ?? 'client_1'
  const professionalId = overrides?.professionalId ?? 'pro_1'

  return {
    id: overrides?.id ?? 'aftercare_1',
    bookingId,
    notes: 'Aftercare instructions',
    rebookMode: AftercareRebookMode.BOOKED_NEXT_APPOINTMENT,
    rebookedFor: new Date('2026-04-01T19:00:00.000Z'),
    rebookWindowStart: null,
    rebookWindowEnd: null,
    draftSavedAt: new Date('2026-03-11T18:00:00.000Z'),
    sentToClientAt:
      overrides && 'sentToClientAt' in overrides
        ? (overrides.sentToClientAt ?? null)
        : new Date('2026-03-11T18:30:00.000Z'),
    lastEditedAt: new Date('2026-03-11T18:15:00.000Z'),
    version: 2,
    booking: {
      id: bookingId,
      clientId,
      professionalId,
      serviceId:
        overrides && 'serviceId' in overrides ? (overrides.serviceId ?? null) : 'service_1',
      offeringId:
        overrides && 'offeringId' in overrides
          ? (overrides.offeringId ?? null)
          : 'offering_1',
      scheduledFor: new Date('2026-03-10T19:00:00.000Z'),
      status: BookingStatus.COMPLETED,
      locationType: ServiceLocationType.SALON,
      locationId: 'loc_1',
      subtotalSnapshot: new Prisma.Decimal('100.00'),
      totalDurationMinutes: 60,
      service: {
        id: 'service_1',
        name: 'Haircut',
      },
      professional: {
        id: professionalId,
        businessName: 'TOVIS Studio',
        timeZone: 'America/Los_Angeles',
        location: null,
      },
    },
  }
}

function makeUsageRecord(overrides?: {
  id?: string
  expiresAt?: Date
  firstUsedAt?: Date | null
  lastUsedAt?: Date | null
  useCount?: number
  singleUse?: boolean
}) {
  return {
    id: overrides?.id ?? 'token_row_1',
    expiresAt: overrides?.expiresAt ?? EXPIRES_AT,
    firstUsedAt:
      overrides && 'firstUsedAt' in overrides
        ? (overrides.firstUsedAt ?? null)
        : null,
    lastUsedAt:
      overrides && 'lastUsedAt' in overrides
        ? (overrides.lastUsedAt ?? null)
        : null,
    useCount: overrides?.useCount ?? 0,
    singleUse: overrides?.singleUse ?? false,
  }
}

type ExpectedBookingErrorCode = BookingError['code']

async function expectBookingError(
  action: Promise<unknown>,
  code: ExpectedBookingErrorCode,
): Promise<void> {
  await expect(action).rejects.toMatchObject({
    code,
  } satisfies Partial<BookingError>)
}

describe('lib/aftercare/aftercareAccessTokens', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(NOW)

    mocks.hashClientActionToken.mockImplementation(
      (rawToken: string) => `hash:${rawToken}`,
    )

    mocks.buildPublicAftercareTokenActorKey.mockImplementation(
      (tokenId: string) => `aftercare-token:${tokenId}`,
    )

    mocks.clientActionTokenFindUnique.mockResolvedValue(makeTokenRecord())
    mocks.clientActionTokenUpdateMany.mockResolvedValue({ count: 1 })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('resolveAftercareAccessTokenForRead', () => {
    it('resolves a valid ClientActionToken without mutating usage', async () => {
      const result = await resolveAftercareAccessTokenForRead({
        rawToken: ' raw_token_1 ',
      })

      expect(mocks.hashClientActionToken).toHaveBeenCalledWith('raw_token_1')

      expect(mocks.clientActionTokenFindUnique).toHaveBeenCalledWith({
        where: {
          tokenHash: 'hash:raw_token_1',
        },
        select: expect.any(Object),
      })

      expect(mocks.clientActionTokenUpdateMany).not.toHaveBeenCalled()

      expect(result).toEqual({
        accessSource: 'clientActionToken',
        idempotencyActorKey: 'aftercare-token:token_row_1',
        token: {
          id: 'token_row_1',
          expiresAt: EXPIRES_AT,
          firstUsedAt: null,
          lastUsedAt: null,
          useCount: 0,
          singleUse: false,
        },
        aftercare: {
          id: 'aftercare_1',
          bookingId: 'booking_old',
          notes: 'Aftercare instructions',
          rebookMode: AftercareRebookMode.BOOKED_NEXT_APPOINTMENT,
          rebookedFor: new Date('2026-04-01T19:00:00.000Z'),
          rebookWindowStart: null,
          rebookWindowEnd: null,
          draftSavedAt: new Date('2026-03-11T18:00:00.000Z'),
          sentToClientAt: new Date('2026-03-11T18:30:00.000Z'),
          lastEditedAt: new Date('2026-03-11T18:15:00.000Z'),
          version: 2,
        },
        booking: {
          id: 'booking_old',
          clientId: 'client_1',
          professionalId: 'pro_1',
          serviceId: 'service_1',
          offeringId: 'offering_1',
          scheduledFor: new Date('2026-03-10T19:00:00.000Z'),
          status: BookingStatus.COMPLETED,
          locationType: ServiceLocationType.SALON,
          locationId: 'loc_1',
          subtotalSnapshot: new Prisma.Decimal('100.00'),
          totalDurationMinutes: 60,
          service: {
            id: 'service_1',
            name: 'Haircut',
          },
          professional: {
            id: 'pro_1',
            businessName: 'TOVIS Studio',
            timeZone: 'America/Los_Angeles',
            location: null,
          },
        },
      })
    })

    it('throws AFTERCARE_TOKEN_MISSING for a blank token', async () => {
      await expectBookingError(
        resolveAftercareAccessTokenForRead({
          rawToken: '   ',
        }),
        'AFTERCARE_TOKEN_MISSING',
      )

      expect(mocks.hashClientActionToken).not.toHaveBeenCalled()
      expect(mocks.clientActionTokenFindUnique).not.toHaveBeenCalled()
      expect(mocks.clientActionTokenUpdateMany).not.toHaveBeenCalled()
    })

    it('throws AFTERCARE_TOKEN_INVALID when token is not found', async () => {
      mocks.clientActionTokenFindUnique.mockResolvedValueOnce(null)

      await expectBookingError(
        resolveAftercareAccessTokenForRead({
          rawToken: 'missing_token',
        }),
        'AFTERCARE_TOKEN_INVALID',
      )

      expect(mocks.clientActionTokenUpdateMany).not.toHaveBeenCalled()
    })

    it('throws AFTERCARE_TOKEN_INVALID when token kind is wrong', async () => {
      mocks.clientActionTokenFindUnique.mockResolvedValueOnce(
        makeTokenRecord({
          kind: ClientActionTokenKind.CONSULTATION_ACTION,
        }),
      )

      await expectBookingError(
        resolveAftercareAccessTokenForRead({
          rawToken: 'wrong_kind',
        }),
        'AFTERCARE_TOKEN_INVALID',
      )
    })

    it('throws AFTERCARE_TOKEN_INVALID when token is revoked', async () => {
      mocks.clientActionTokenFindUnique.mockResolvedValueOnce(
        makeTokenRecord({
          revokedAt: new Date('2026-03-11T18:00:00.000Z'),
          revokeReason: 'manual revoke',
        }),
      )

      await expectBookingError(
        resolveAftercareAccessTokenForRead({
          rawToken: 'revoked_token',
        }),
        'AFTERCARE_TOKEN_INVALID',
      )
    })

    it('throws AFTERCARE_TOKEN_INVALID when token is expired', async () => {
      mocks.clientActionTokenFindUnique.mockResolvedValueOnce(
        makeTokenRecord({
          expiresAt: new Date('2026-03-11T18:59:59.999Z'),
        }),
      )

      await expectBookingError(
        resolveAftercareAccessTokenForRead({
          rawToken: 'expired_token',
        }),
        'AFTERCARE_TOKEN_INVALID',
      )
    })

    it('throws AFTERCARE_TOKEN_INVALID when single-use token was already used', async () => {
      mocks.clientActionTokenFindUnique.mockResolvedValueOnce(
        makeTokenRecord({
          singleUse: true,
          firstUsedAt: new Date('2026-03-11T18:00:00.000Z'),
          lastUsedAt: new Date('2026-03-11T18:00:00.000Z'),
          useCount: 1,
        }),
      )

      await expectBookingError(
        resolveAftercareAccessTokenForRead({
          rawToken: 'already_used',
        }),
        'AFTERCARE_TOKEN_INVALID',
      )
    })

    it('throws AFTERCARE_TOKEN_INVALID when aftercareSummaryId is missing', async () => {
      mocks.clientActionTokenFindUnique.mockResolvedValueOnce(
        makeTokenRecord({
          aftercareSummaryId: null,
        }),
      )

      await expectBookingError(
        resolveAftercareAccessTokenForRead({
          rawToken: 'missing_summary_id',
        }),
        'AFTERCARE_TOKEN_INVALID',
      )
    })

    it('throws AFTERCARE_TOKEN_INVALID when aftercare summary is missing', async () => {
      mocks.clientActionTokenFindUnique.mockResolvedValueOnce(
        makeTokenRecord({
          aftercareSummary: null,
        }),
      )

      await expectBookingError(
        resolveAftercareAccessTokenForRead({
          rawToken: 'missing_summary',
        }),
        'AFTERCARE_TOKEN_INVALID',
      )
    })

    it('throws AFTERCARE_TOKEN_INVALID when aftercare was not sent to client', async () => {
      mocks.clientActionTokenFindUnique.mockResolvedValueOnce(
        makeTokenRecord({
          aftercareSummary: makeAftercareSummary({
            sentToClientAt: null,
          }),
        }),
      )

      await expectBookingError(
        resolveAftercareAccessTokenForRead({
          rawToken: 'not_sent',
        }),
        'AFTERCARE_TOKEN_INVALID',
      )
    })

    it('throws AFTERCARE_TOKEN_INVALID when aftercare id mismatches token summary id', async () => {
      mocks.clientActionTokenFindUnique.mockResolvedValueOnce(
        makeTokenRecord({
          aftercareSummaryId: 'aftercare_token_id',
          aftercareSummary: makeAftercareSummary({
            id: 'aftercare_actual_id',
          }),
        }),
      )

      await expectBookingError(
        resolveAftercareAccessTokenForRead({
          rawToken: 'summary_mismatch',
        }),
        'AFTERCARE_TOKEN_INVALID',
      )
    })

    it('throws AFTERCARE_TOKEN_INVALID when booking id mismatches token booking id', async () => {
      mocks.clientActionTokenFindUnique.mockResolvedValueOnce(
        makeTokenRecord({
          bookingId: 'booking_token',
          aftercareSummary: makeAftercareSummary({
            bookingId: 'booking_actual',
          }),
        }),
      )

      await expectBookingError(
        resolveAftercareAccessTokenForRead({
          rawToken: 'booking_mismatch',
        }),
        'AFTERCARE_TOKEN_INVALID',
      )
    })

    it('throws AFTERCARE_TOKEN_INVALID when client id mismatches token client id', async () => {
      mocks.clientActionTokenFindUnique.mockResolvedValueOnce(
        makeTokenRecord({
          clientId: 'client_token',
          aftercareSummary: makeAftercareSummary({
            clientId: 'client_actual',
          }),
        }),
      )

      await expectBookingError(
        resolveAftercareAccessTokenForRead({
          rawToken: 'client_mismatch',
        }),
        'AFTERCARE_TOKEN_INVALID',
      )
    })

    it('throws AFTERCARE_TOKEN_INVALID when professional id mismatches token professional id', async () => {
      mocks.clientActionTokenFindUnique.mockResolvedValueOnce(
        makeTokenRecord({
          professionalId: 'pro_token',
          aftercareSummary: makeAftercareSummary({
            professionalId: 'pro_actual',
          }),
        }),
      )

      await expectBookingError(
        resolveAftercareAccessTokenForRead({
          rawToken: 'pro_mismatch',
        }),
        'AFTERCARE_TOKEN_INVALID',
      )
    })
  })

  describe('resolveAftercareAccessTokenForMutation', () => {
    it('resolves using the read path without mutating usage', async () => {
      const result = await resolveAftercareAccessTokenForMutation({
        rawToken: 'mutation_token',
      })

      expect(result.token.id).toBe('token_row_1')
      expect(result.idempotencyActorKey).toBe('aftercare-token:token_row_1')
      expect(mocks.clientActionTokenUpdateMany).not.toHaveBeenCalled()
    })
  })

  describe('markAftercareAccessTokenUsed', () => {
    it('marks first use for a reusable token', async () => {
      mocks.clientActionTokenFindUnique
        .mockResolvedValueOnce(
          makeUsageRecord({
            firstUsedAt: null,
            lastUsedAt: null,
            useCount: 0,
            singleUse: false,
          }),
        )
        .mockResolvedValueOnce(
          makeUsageRecord({
            firstUsedAt: NOW,
            lastUsedAt: NOW,
            useCount: 1,
            singleUse: false,
          }),
        )

      const result = await markAftercareAccessTokenUsed({
        tokenId: 'token_row_1',
        now: NOW,
      })

      expect(mocks.clientActionTokenFindUnique).toHaveBeenNthCalledWith(1, {
        where: {
          id: 'token_row_1',
        },
        select: expect.any(Object),
      })

      expect(mocks.clientActionTokenUpdateMany).toHaveBeenCalledWith({
        where: {
          id: 'token_row_1',
          kind: ClientActionTokenKind.AFTERCARE_ACCESS,
          revokedAt: null,
          expiresAt: {
            gt: NOW,
          },
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
        id: 'token_row_1',
        expiresAt: EXPIRES_AT,
        firstUsedAt: NOW,
        lastUsedAt: NOW,
        useCount: 1,
        singleUse: false,
      })
    })

    it('marks repeat use for a reusable token', async () => {
      const previousUse = new Date('2026-03-11T18:30:00.000Z')

      mocks.clientActionTokenFindUnique
        .mockResolvedValueOnce(
          makeUsageRecord({
            firstUsedAt: previousUse,
            lastUsedAt: previousUse,
            useCount: 2,
            singleUse: false,
          }),
        )
        .mockResolvedValueOnce(
          makeUsageRecord({
            firstUsedAt: previousUse,
            lastUsedAt: NOW,
            useCount: 3,
            singleUse: false,
          }),
        )

      const result = await markAftercareAccessTokenUsed({
        tokenId: 'token_row_1',
        now: NOW,
      })

      expect(mocks.clientActionTokenUpdateMany).toHaveBeenCalledWith({
        where: {
          id: 'token_row_1',
          kind: ClientActionTokenKind.AFTERCARE_ACCESS,
          revokedAt: null,
          expiresAt: {
            gt: NOW,
          },
        },
        data: {
          lastUsedAt: NOW,
          useCount: {
            increment: 1,
          },
        },
      })

      expect(result).toEqual({
        id: 'token_row_1',
        expiresAt: EXPIRES_AT,
        firstUsedAt: previousUse,
        lastUsedAt: NOW,
        useCount: 3,
        singleUse: false,
      })
    })

    it('marks a single-use token exactly once', async () => {
      mocks.clientActionTokenFindUnique
        .mockResolvedValueOnce(
          makeUsageRecord({
            firstUsedAt: null,
            lastUsedAt: null,
            useCount: 0,
            singleUse: true,
          }),
        )
        .mockResolvedValueOnce(
          makeUsageRecord({
            firstUsedAt: NOW,
            lastUsedAt: NOW,
            useCount: 1,
            singleUse: true,
          }),
        )

      const result = await markAftercareAccessTokenUsed({
        tokenId: 'token_row_1',
        now: NOW,
      })

      expect(mocks.clientActionTokenUpdateMany).toHaveBeenCalledWith({
        where: {
          id: 'token_row_1',
          kind: ClientActionTokenKind.AFTERCARE_ACCESS,
          revokedAt: null,
          expiresAt: {
            gt: NOW,
          },
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
        id: 'token_row_1',
        expiresAt: EXPIRES_AT,
        firstUsedAt: NOW,
        lastUsedAt: NOW,
        useCount: 1,
        singleUse: true,
      })
    })

    it('throws AFTERCARE_TOKEN_INVALID when token id is not found for usage update', async () => {
      mocks.clientActionTokenFindUnique.mockResolvedValueOnce(null)

      await expectBookingError(
        markAftercareAccessTokenUsed({
          tokenId: 'missing_token_row',
          now: NOW,
        }),
        'AFTERCARE_TOKEN_INVALID',
      )

      expect(mocks.clientActionTokenUpdateMany).not.toHaveBeenCalled()
    })

    it('throws AFTERCARE_TOKEN_INVALID when token is expired before usage update', async () => {
      mocks.clientActionTokenFindUnique.mockResolvedValueOnce(
        makeUsageRecord({
          expiresAt: new Date('2026-03-11T18:59:59.999Z'),
        }),
      )

      await expectBookingError(
        markAftercareAccessTokenUsed({
          tokenId: 'expired_token_row',
          now: NOW,
        }),
        'AFTERCARE_TOKEN_INVALID',
      )

      expect(mocks.clientActionTokenUpdateMany).not.toHaveBeenCalled()
    })

    it('throws AFTERCARE_TOKEN_INVALID when single-use token cannot be consumed exactly once', async () => {
      mocks.clientActionTokenFindUnique.mockResolvedValueOnce(
        makeUsageRecord({
          firstUsedAt: null,
          singleUse: true,
        }),
      )

      mocks.clientActionTokenUpdateMany.mockResolvedValueOnce({
        count: 0,
      })

      await expectBookingError(
        markAftercareAccessTokenUsed({
          tokenId: 'token_row_1',
          now: NOW,
        }),
        'AFTERCARE_TOKEN_INVALID',
      )
    })

    it('falls through to repeat-use update when reusable first-use race loses', async () => {
      mocks.clientActionTokenFindUnique
        .mockResolvedValueOnce(
          makeUsageRecord({
            firstUsedAt: null,
            lastUsedAt: null,
            useCount: 0,
            singleUse: false,
          }),
        )
        .mockResolvedValueOnce(
          makeUsageRecord({
            firstUsedAt: NOW,
            lastUsedAt: NOW,
            useCount: 1,
            singleUse: false,
          }),
        )

      mocks.clientActionTokenUpdateMany
        .mockResolvedValueOnce({
          count: 0,
        })
        .mockResolvedValueOnce({
          count: 1,
        })

      const result = await markAftercareAccessTokenUsed({
        tokenId: 'token_row_1',
        now: NOW,
      })

      expect(mocks.clientActionTokenUpdateMany).toHaveBeenNthCalledWith(1, {
        where: {
          id: 'token_row_1',
          kind: ClientActionTokenKind.AFTERCARE_ACCESS,
          revokedAt: null,
          expiresAt: {
            gt: NOW,
          },
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

      expect(mocks.clientActionTokenUpdateMany).toHaveBeenNthCalledWith(2, {
        where: {
          id: 'token_row_1',
          kind: ClientActionTokenKind.AFTERCARE_ACCESS,
          revokedAt: null,
          expiresAt: {
            gt: NOW,
          },
        },
        data: {
          lastUsedAt: NOW,
          useCount: {
            increment: 1,
          },
        },
      })

      expect(result.useCount).toBe(1)
    })

    it('throws AFTERCARE_TOKEN_INVALID when repeat-use update fails', async () => {
      const previousUse = new Date('2026-03-11T18:30:00.000Z')

      mocks.clientActionTokenFindUnique.mockResolvedValueOnce(
        makeUsageRecord({
          firstUsedAt: previousUse,
          lastUsedAt: previousUse,
          useCount: 2,
          singleUse: false,
        }),
      )

      mocks.clientActionTokenUpdateMany.mockResolvedValueOnce({
        count: 0,
      })

      await expectBookingError(
        markAftercareAccessTokenUsed({
          tokenId: 'token_row_1',
          now: NOW,
        }),
        'AFTERCARE_TOKEN_INVALID',
      )
    })
  })
})