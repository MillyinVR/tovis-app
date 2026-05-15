// lib/aftercare/unclaimedAftercareAccess.test.ts
import {
  AftercareRebookMode,
  BookingStatus,
  Prisma,
  ServiceLocationType,
} from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveAftercareAccessTokenForRead: vi.fn(),
  markAftercareAccessTokenUsed: vi.fn(),
}))

vi.mock('@/lib/aftercare/aftercareAccessTokens', () => ({
  resolveAftercareAccessTokenForRead: mocks.resolveAftercareAccessTokenForRead,
  markAftercareAccessTokenUsed: mocks.markAftercareAccessTokenUsed,
}))

import { resolveAftercareAccessByToken } from './unclaimedAftercareAccess'

const EXPIRES_AT = new Date('2026-04-20T12:00:00.000Z')
const FIRST_USED_AT = new Date('2026-04-12T12:00:00.000Z')
const LAST_USED_AT = new Date('2026-04-12T12:00:00.000Z')
const SCHEDULED_FOR = new Date('2026-04-10T18:00:00.000Z')

function makeResolvedReadAccess() {
  return {
    accessSource: 'clientActionToken' as const,
    idempotencyActorKey: 'aftercare-token:token_row_1',
    token: {
      id: 'token_row_1',
      expiresAt: EXPIRES_AT,
      firstUsedAt: null,
      lastUsedAt: null,
      useCount: 0,
      singleUse: true,
    },
    aftercare: {
      id: 'aftercare_1',
      bookingId: 'booking_1',
      notes: 'Drink water. Avoid heat for 24 hours.',
      rebookMode: AftercareRebookMode.BOOKED_NEXT_APPOINTMENT,
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
      scheduledFor: SCHEDULED_FOR,
      status: BookingStatus.COMPLETED,
      locationType: ServiceLocationType.SALON,
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
  }
}

function makeUsedToken() {
  return {
    id: 'token_row_1',
    expiresAt: EXPIRES_AT,
    firstUsedAt: FIRST_USED_AT,
    lastUsedAt: LAST_USED_AT,
    useCount: 1,
    singleUse: true,
  }
}

describe('resolveAftercareAccessByToken', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.resolveAftercareAccessTokenForRead.mockResolvedValue(
      makeResolvedReadAccess(),
    )

    mocks.markAftercareAccessTokenUsed.mockResolvedValue(makeUsedToken())
  })

  it('resolves through the shared read helper, marks token used, and omits idempotencyActorKey for read surfaces', async () => {
    const result = await resolveAftercareAccessByToken({
      rawToken: ' token_1 ',
    })

    expect(mocks.resolveAftercareAccessTokenForRead).toHaveBeenCalledWith({
      rawToken: ' token_1 ',
      tx: undefined,
    })

    expect(mocks.markAftercareAccessTokenUsed).toHaveBeenCalledWith({
      tokenId: 'token_row_1',
      tx: undefined,
    })

    expect(result).toEqual({
      accessSource: 'clientActionToken',
      token: {
        id: 'token_row_1',
        expiresAt: EXPIRES_AT,
        firstUsedAt: FIRST_USED_AT,
        lastUsedAt: LAST_USED_AT,
        useCount: 1,
        singleUse: true,
      },
      aftercare: {
        id: 'aftercare_1',
        bookingId: 'booking_1',
        notes: 'Drink water. Avoid heat for 24 hours.',
        rebookMode: AftercareRebookMode.BOOKED_NEXT_APPOINTMENT,
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
        scheduledFor: SCHEDULED_FOR,
        status: BookingStatus.COMPLETED,
        locationType: ServiceLocationType.SALON,
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

    expect('idempotencyActorKey' in result).toBe(false)
  })

  it('forwards tx to read resolution and token usage helpers', async () => {
    const tx = { __brand: 'tx' } as unknown as Prisma.TransactionClient

    await resolveAftercareAccessByToken({
      rawToken: 'token_with_tx',
      tx,
    })

    expect(mocks.resolveAftercareAccessTokenForRead).toHaveBeenCalledWith({
      rawToken: 'token_with_tx',
      tx,
    })

    expect(mocks.markAftercareAccessTokenUsed).toHaveBeenCalledWith({
      tokenId: 'token_row_1',
      tx,
    })
  })

  it('does not mark token used when read resolution fails', async () => {
    const error = Object.assign(new Error('missing token'), {
      code: 'AFTERCARE_TOKEN_INVALID',
    })

    mocks.resolveAftercareAccessTokenForRead.mockRejectedValueOnce(error)

    await expect(
      resolveAftercareAccessByToken({
        rawToken: 'bad_token',
      }),
    ).rejects.toMatchObject({
      code: 'AFTERCARE_TOKEN_INVALID',
    })

    expect(mocks.markAftercareAccessTokenUsed).not.toHaveBeenCalled()
  })

  it('propagates token usage failures', async () => {
    const error = Object.assign(new Error('usage failed'), {
      code: 'AFTERCARE_TOKEN_INVALID',
    })

    mocks.markAftercareAccessTokenUsed.mockRejectedValueOnce(error)

    await expect(
      resolveAftercareAccessByToken({
        rawToken: 'token_3',
      }),
    ).rejects.toMatchObject({
      code: 'AFTERCARE_TOKEN_INVALID',
    })

    expect(mocks.resolveAftercareAccessTokenForRead).toHaveBeenCalledWith({
      rawToken: 'token_3',
      tx: undefined,
    })

    expect(mocks.markAftercareAccessTokenUsed).toHaveBeenCalledWith({
      tokenId: 'token_row_1',
      tx: undefined,
    })
  })
})