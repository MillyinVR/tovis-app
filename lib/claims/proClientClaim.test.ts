import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ClientClaimStatus,
  ContactMethod,
  ProClientInviteStatus,
} from '@prisma/client'

const mocks = vi.hoisted(() => {
  const tx = {
    proClientInvite: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    clientProfile: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
  }

  return {
    prisma: {
      $transaction: vi.fn(),
    },
    tx,
  }
})

vi.mock('@/lib/prisma', () => ({
  prisma: mocks.prisma,
}))

import { acceptProClientClaimLink } from './proClientClaim'

function makeInvite(overrides?: {
  id?: string
  bookingId?: string
  clientId?: string
  status?: ProClientInviteStatus
  acceptedAt?: Date | null
  revokedAt?: Date | null
  preferredContactMethod?: ContactMethod | null
  client?: {
    id?: string
    userId?: string | null
    claimStatus?: ClientClaimStatus
    preferredContactMethod?: ContactMethod | null
  } | null
}) {
  return {
    id: overrides?.id ?? 'invite_1',
    bookingId: overrides?.bookingId ?? 'booking_1',
    clientId: overrides?.clientId ?? 'client_1',
    status: overrides?.status ?? ProClientInviteStatus.PENDING,
    acceptedAt:
      overrides?.acceptedAt !== undefined ? overrides.acceptedAt : null,
    revokedAt: overrides?.revokedAt !== undefined ? overrides.revokedAt : null,
    preferredContactMethod:
      overrides?.preferredContactMethod !== undefined
        ? overrides.preferredContactMethod
        : ContactMethod.EMAIL,
    client:
      overrides?.client !== undefined
        ? overrides.client
        : {
            id: 'client_1',
            userId: null,
            claimStatus: ClientClaimStatus.UNCLAIMED,
            preferredContactMethod: null,
          },
  }
}

function makeActingClient(overrides?: {
  id?: string
  userId?: string | null
  claimStatus?: ClientClaimStatus
  preferredContactMethod?: ContactMethod | null
}) {
  return {
    id: overrides?.id ?? 'client_1',
    userId: overrides?.userId !== undefined ? overrides.userId : null,
    claimStatus:
      overrides?.claimStatus ?? ClientClaimStatus.UNCLAIMED,
    preferredContactMethod:
      overrides?.preferredContactMethod !== undefined
        ? overrides.preferredContactMethod
        : null,
  }
}

describe('acceptProClientClaimLink', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-12T12:00:00.000Z'))

    mocks.prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof mocks.tx) => Promise<unknown>) =>
        callback(mocks.tx),
    )

    mocks.tx.proClientInvite.findUnique.mockResolvedValue(makeInvite())
    mocks.tx.proClientInvite.updateMany.mockResolvedValue({ count: 1 })
    mocks.tx.clientProfile.findUnique.mockResolvedValue(makeActingClient())
    mocks.tx.clientProfile.updateMany.mockResolvedValue({ count: 1 })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('throws when token is blank after trimming', async () => {
    await expect(
      acceptProClientClaimLink({
        token: '   ',
        actingUserId: 'user_1',
        actingClientId: 'client_1',
      }),
    ).rejects.toThrow('acceptProClientClaimLink: token is required.')

    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })

  it('throws when actingUserId is blank after trimming', async () => {
    await expect(
      acceptProClientClaimLink({
        token: 'token_1',
        actingUserId: '   ',
        actingClientId: 'client_1',
      }),
    ).rejects.toThrow('acceptProClientClaimLink: actingUserId is required.')

    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })

  it('throws when actingClientId is blank after trimming', async () => {
    await expect(
      acceptProClientClaimLink({
        token: 'token_1',
        actingUserId: 'user_1',
        actingClientId: '   ',
      }),
    ).rejects.toThrow('acceptProClientClaimLink: actingClientId is required.')

    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })

  it('returns not_found when invite does not exist', async () => {
    mocks.tx.proClientInvite.findUnique.mockResolvedValueOnce(null)

    const result = await acceptProClientClaimLink({
      token: 'token_1',
      actingUserId: 'user_1',
      actingClientId: 'client_1',
    })

    expect(result).toEqual({ kind: 'not_found' })
  })

  it('returns not_found when invite exists but linked client identity is missing', async () => {
    mocks.tx.proClientInvite.findUnique.mockResolvedValueOnce(
      makeInvite({
        client: null,
      }),
    )

    const result = await acceptProClientClaimLink({
      token: 'token_1',
      actingUserId: 'user_1',
      actingClientId: 'client_1',
    })

    expect(result).toEqual({ kind: 'not_found' })
  })

  it('returns revoked when invite status is REVOKED', async () => {
    mocks.tx.proClientInvite.findUnique.mockResolvedValueOnce(
      makeInvite({
        status: ProClientInviteStatus.REVOKED,
      }),
    )

    const result = await acceptProClientClaimLink({
      token: 'token_1',
      actingUserId: 'user_1',
      actingClientId: 'client_1',
    })

    expect(result).toEqual({ kind: 'revoked' })
    expect(mocks.tx.clientProfile.findUnique).not.toHaveBeenCalled()
  })

  it('returns revoked when revokedAt is already set even if status is still PENDING', async () => {
    mocks.tx.proClientInvite.findUnique.mockResolvedValueOnce(
      makeInvite({
        status: ProClientInviteStatus.PENDING,
        revokedAt: new Date('2026-04-12T11:00:00.000Z'),
      }),
    )

    const result = await acceptProClientClaimLink({
      token: 'token_1',
      actingUserId: 'user_1',
      actingClientId: 'client_1',
    })

    expect(result).toEqual({ kind: 'revoked' })
  })

  it('returns client_not_found when acting client profile does not exist', async () => {
    mocks.tx.clientProfile.findUnique.mockResolvedValueOnce(null)

    const result = await acceptProClientClaimLink({
      token: 'token_1',
      actingUserId: 'user_1',
      actingClientId: 'client_1',
    })

    expect(result).toEqual({ kind: 'client_not_found' })
  })

  it('returns client_mismatch when invite belongs to a different unclaimed client identity', async () => {
    mocks.tx.proClientInvite.findUnique.mockResolvedValueOnce(
      makeInvite({
        client: {
          id: 'client_other',
          userId: null,
          claimStatus: ClientClaimStatus.UNCLAIMED,
          preferredContactMethod: null,
        },
      }),
    )

    const result = await acceptProClientClaimLink({
      token: 'token_1',
      actingUserId: 'user_1',
      actingClientId: 'client_1',
    })

    expect(result).toEqual({ kind: 'client_mismatch' })
    expect(mocks.tx.clientProfile.updateMany).not.toHaveBeenCalled()
    expect(mocks.tx.proClientInvite.updateMany).not.toHaveBeenCalled()
  })

  it('returns already_claimed when invite belongs to a different claimed client identity', async () => {
    mocks.tx.proClientInvite.findUnique.mockResolvedValueOnce(
      makeInvite({
        client: {
          id: 'client_other',
          userId: 'user_other',
          claimStatus: ClientClaimStatus.CLAIMED,
          preferredContactMethod: null,
        },
      }),
    )

    const result = await acceptProClientClaimLink({
      token: 'token_1',
      actingUserId: 'user_1',
      actingClientId: 'client_1',
    })

    expect(result).toEqual({ kind: 'already_claimed' })
    expect(mocks.tx.clientProfile.updateMany).not.toHaveBeenCalled()
  })

  it('returns already_claimed when linked client identity is already claimed', async () => {
    mocks.tx.proClientInvite.findUnique.mockResolvedValueOnce(
      makeInvite({
        client: {
          id: 'client_1',
          userId: null,
          claimStatus: ClientClaimStatus.CLAIMED,
          preferredContactMethod: null,
        },
      }),
    )

    const result = await acceptProClientClaimLink({
      token: 'token_1',
      actingUserId: 'user_1',
      actingClientId: 'client_1',
    })

    expect(result).toEqual({ kind: 'already_claimed' })
    expect(mocks.tx.clientProfile.updateMany).not.toHaveBeenCalled()
  })

  it('returns already_claimed when linked client has a different linked user already', async () => {
    mocks.tx.proClientInvite.findUnique.mockResolvedValueOnce(
      makeInvite({
        client: {
          id: 'client_1',
          userId: 'user_other',
          claimStatus: ClientClaimStatus.UNCLAIMED,
          preferredContactMethod: null,
        },
      }),
    )

    const result = await acceptProClientClaimLink({
      token: 'token_1',
      actingUserId: 'user_1',
      actingClientId: 'client_1',
    })

    expect(result).toEqual({ kind: 'already_claimed' })
    expect(mocks.tx.clientProfile.updateMany).not.toHaveBeenCalled()
  })

  it('claims the client identity successfully and writes preferredContactMethod when acting client does not have one', async () => {
    mocks.tx.proClientInvite.findUnique.mockResolvedValueOnce(
      makeInvite({
        id: 'invite_1',
        bookingId: 'booking_1',
        preferredContactMethod: ContactMethod.EMAIL,
        client: {
          id: 'client_1',
          userId: null,
          claimStatus: ClientClaimStatus.UNCLAIMED,
          preferredContactMethod: null,
        },
      }),
    )

    mocks.tx.clientProfile.findUnique.mockResolvedValueOnce(
      makeActingClient({
        id: 'client_1',
        userId: null,
        claimStatus: ClientClaimStatus.UNCLAIMED,
        preferredContactMethod: null,
      }),
    )

    const result = await acceptProClientClaimLink({
      token: 'token_1',
      actingUserId: 'user_1',
      actingClientId: 'client_1',
    })

    expect(mocks.tx.clientProfile.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'client_1',
        claimStatus: ClientClaimStatus.UNCLAIMED,
      },
      data: {
        claimStatus: ClientClaimStatus.CLAIMED,
        claimedAt: new Date('2026-04-12T12:00:00.000Z'),
        preferredContactMethod: ContactMethod.EMAIL,
      },
    })

    expect(mocks.tx.proClientInvite.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'invite_1',
        revokedAt: null,
      },
      data: {
        status: ProClientInviteStatus.ACCEPTED,
        acceptedAt: new Date('2026-04-12T12:00:00.000Z'),
        acceptedByUserId: 'user_1',
      },
    })

    expect(result).toEqual({
      kind: 'ok',
      bookingId: 'booking_1',
    })
  })

  it('claims successfully without overwriting an existing preferredContactMethod', async () => {
    mocks.tx.proClientInvite.findUnique.mockResolvedValueOnce(
      makeInvite({
        preferredContactMethod: ContactMethod.EMAIL,
      }),
    )

    mocks.tx.clientProfile.findUnique.mockResolvedValueOnce(
      makeActingClient({
        id: 'client_1',
        preferredContactMethod: ContactMethod.SMS,
      }),
    )

    const result = await acceptProClientClaimLink({
      token: 'token_1',
      actingUserId: 'user_1',
      actingClientId: 'client_1',
    })

    expect(mocks.tx.clientProfile.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'client_1',
        claimStatus: ClientClaimStatus.UNCLAIMED,
      },
      data: {
        claimStatus: ClientClaimStatus.CLAIMED,
        claimedAt: new Date('2026-04-12T12:00:00.000Z'),
      },
    })

    expect(result).toEqual({
      kind: 'ok',
      bookingId: 'booking_1',
    })
  })

  it('preserves an existing invite acceptedAt timestamp when writing audit acceptance', async () => {
    mocks.tx.proClientInvite.findUnique.mockResolvedValueOnce(
      makeInvite({
        acceptedAt: new Date('2026-04-12T11:00:00.000Z'),
      }),
    )

    await acceptProClientClaimLink({
      token: 'token_1',
      actingUserId: 'user_1',
      actingClientId: 'client_1',
    })

    expect(mocks.tx.proClientInvite.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'invite_1',
        revokedAt: null,
      },
      data: {
        status: ProClientInviteStatus.ACCEPTED,
        acceptedAt: new Date('2026-04-12T11:00:00.000Z'),
        acceptedByUserId: 'user_1',
      },
    })
  })

  it('returns already_claimed when client claim update loses a race to a claimed state', async () => {
    mocks.tx.clientProfile.updateMany.mockResolvedValueOnce({ count: 0 })
    mocks.tx.clientProfile.findUnique
      .mockResolvedValueOnce(makeActingClient())
      .mockResolvedValueOnce({
        id: 'client_1',
        userId: 'user_1',
        claimStatus: ClientClaimStatus.CLAIMED,
      })

    const result = await acceptProClientClaimLink({
      token: 'token_1',
      actingUserId: 'user_1',
      actingClientId: 'client_1',
    })

    expect(result).toEqual({ kind: 'already_claimed' })
    expect(mocks.tx.proClientInvite.updateMany).not.toHaveBeenCalled()
  })

  it('returns client_not_found when client claim update loses a race to deletion', async () => {
    mocks.tx.clientProfile.updateMany.mockResolvedValueOnce({ count: 0 })
    mocks.tx.clientProfile.findUnique
      .mockResolvedValueOnce(makeActingClient())
      .mockResolvedValueOnce(null)

    const result = await acceptProClientClaimLink({
      token: 'token_1',
      actingUserId: 'user_1',
      actingClientId: 'client_1',
    })

    expect(result).toEqual({ kind: 'client_not_found' })
    expect(mocks.tx.proClientInvite.updateMany).not.toHaveBeenCalled()
  })

  it('returns conflict when client claim update does not succeed and client is still unclaimed', async () => {
    mocks.tx.clientProfile.updateMany.mockResolvedValueOnce({ count: 0 })
    mocks.tx.clientProfile.findUnique
      .mockResolvedValueOnce(makeActingClient())
      .mockResolvedValueOnce({
        id: 'client_1',
        userId: null,
        claimStatus: ClientClaimStatus.UNCLAIMED,
      })

    const result = await acceptProClientClaimLink({
      token: 'token_1',
      actingUserId: 'user_1',
      actingClientId: 'client_1',
    })

    expect(result).toEqual({ kind: 'conflict' })
    expect(mocks.tx.proClientInvite.updateMany).not.toHaveBeenCalled()
  })

  it('returns revoked when invite audit update loses a race to revocation', async () => {
    mocks.tx.proClientInvite.updateMany.mockResolvedValueOnce({ count: 0 })
    mocks.tx.proClientInvite.findUnique
      .mockResolvedValueOnce(makeInvite())
      .mockResolvedValueOnce({
        id: 'invite_1',
        status: ProClientInviteStatus.REVOKED,
        revokedAt: new Date('2026-04-12T12:00:00.000Z'),
      })

    const result = await acceptProClientClaimLink({
      token: 'token_1',
      actingUserId: 'user_1',
      actingClientId: 'client_1',
    })

    expect(result).toEqual({ kind: 'revoked' })
  })

  it('returns not_found when invite audit update loses a race to deletion', async () => {
    mocks.tx.proClientInvite.updateMany.mockResolvedValueOnce({ count: 0 })
    mocks.tx.proClientInvite.findUnique
      .mockResolvedValueOnce(makeInvite())
      .mockResolvedValueOnce(null)

    const result = await acceptProClientClaimLink({
      token: 'token_1',
      actingUserId: 'user_1',
      actingClientId: 'client_1',
    })

    expect(result).toEqual({ kind: 'not_found' })
  })

  it('returns conflict when invite audit update does not succeed and invite is still not revoked', async () => {
    mocks.tx.proClientInvite.updateMany.mockResolvedValueOnce({ count: 0 })
    mocks.tx.proClientInvite.findUnique
      .mockResolvedValueOnce(makeInvite())
      .mockResolvedValueOnce({
        id: 'invite_1',
        status: ProClientInviteStatus.PENDING,
        revokedAt: null,
      })

    const result = await acceptProClientClaimLink({
      token: 'token_1',
      actingUserId: 'user_1',
      actingClientId: 'client_1',
    })

    expect(result).toEqual({ kind: 'conflict' })
  })
})