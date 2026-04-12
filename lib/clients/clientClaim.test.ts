import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ClientClaimStatus,
  ContactMethod,
  ProClientInviteStatus,
} from '@prisma/client'

const mocks = vi.hoisted(() => {
  const tx = {
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
    getClientClaimLinkByToken: vi.fn(),
    markClientClaimLinkAcceptedAudit: vi.fn(),
  }
})

vi.mock('@/lib/prisma', () => ({
  prisma: mocks.prisma,
}))

vi.mock('./clientClaimLinks', () => ({
  getClientClaimLinkByToken: mocks.getClientClaimLinkByToken,
  markClientClaimLinkAcceptedAudit: mocks.markClientClaimLinkAcceptedAudit,
}))

import { acceptClientClaimFromLink } from './clientClaim'

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
    claimedAt?: Date | null
    preferredContactMethod?: ContactMethod | null
  } | null
}) {
  return {
    id: overrides?.id ?? 'invite_1',
    token: 'token_1',
    professionalId: 'pro_1',
    clientId: overrides?.clientId ?? 'client_1',
    bookingId: overrides?.bookingId ?? 'booking_1',
    invitedName: 'Tori Morales',
    invitedEmail: 'tori@example.com',
    invitedPhone: null,
    preferredContactMethod:
      overrides?.preferredContactMethod !== undefined
        ? overrides.preferredContactMethod
        : ContactMethod.EMAIL,
    status: overrides?.status ?? ProClientInviteStatus.PENDING,
    acceptedAt:
      overrides?.acceptedAt !== undefined ? overrides.acceptedAt : null,
    acceptedByUserId: null,
    revokedAt: overrides?.revokedAt !== undefined ? overrides.revokedAt : null,
    revokedByUserId: null,
    revokeReason: null,
    createdAt: new Date('2026-04-12T10:00:00.000Z'),
    updatedAt: new Date('2026-04-12T10:00:00.000Z'),
    client:
      overrides?.client !== undefined
        ? overrides.client
        : {
            id: 'client_1',
            userId: null,
            claimStatus: ClientClaimStatus.UNCLAIMED,
            claimedAt: null,
            preferredContactMethod: null,
          },
  }
}

function makeActingClient(overrides?: {
  id?: string
  userId?: string | null
  claimStatus?: ClientClaimStatus
  claimedAt?: Date | null
  preferredContactMethod?: ContactMethod | null
}) {
  return {
    id: overrides?.id ?? 'client_1',
    userId: overrides?.userId !== undefined ? overrides.userId : null,
    claimStatus:
      overrides?.claimStatus ?? ClientClaimStatus.UNCLAIMED,
    claimedAt:
      overrides?.claimedAt !== undefined ? overrides.claimedAt : null,
    preferredContactMethod:
      overrides?.preferredContactMethod !== undefined
        ? overrides.preferredContactMethod
        : null,
  }
}

describe('acceptClientClaimFromLink', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-12T12:00:00.000Z'))

    mocks.prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof mocks.tx) => Promise<unknown>) =>
        callback(mocks.tx),
    )

    mocks.getClientClaimLinkByToken.mockResolvedValue(makeInvite())
    mocks.tx.clientProfile.findUnique.mockResolvedValue(makeActingClient())
    mocks.tx.clientProfile.updateMany.mockResolvedValue({ count: 1 })
    mocks.markClientClaimLinkAcceptedAudit.mockResolvedValue('ok')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('throws when token is blank after trimming', async () => {
    await expect(
      acceptClientClaimFromLink({
        token: '   ',
        actingUserId: 'user_1',
        actingClientId: 'client_1',
      }),
    ).rejects.toThrow('clientClaim: token is required.')

    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })

  it('throws when actingUserId is blank after trimming', async () => {
    await expect(
      acceptClientClaimFromLink({
        token: 'token_1',
        actingUserId: '   ',
        actingClientId: 'client_1',
      }),
    ).rejects.toThrow('clientClaim: actingUserId is required.')

    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })

  it('throws when actingClientId is blank after trimming', async () => {
    await expect(
      acceptClientClaimFromLink({
        token: 'token_1',
        actingUserId: 'user_1',
        actingClientId: '   ',
      }),
    ).rejects.toThrow('clientClaim: actingClientId is required.')

    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })

  it('returns not_found when link does not exist', async () => {
    mocks.getClientClaimLinkByToken.mockResolvedValueOnce(null)

    const result = await acceptClientClaimFromLink({
      token: 'token_1',
      actingUserId: 'user_1',
      actingClientId: 'client_1',
    })

    expect(result).toEqual({ kind: 'not_found' })
    expect(mocks.getClientClaimLinkByToken).toHaveBeenCalledWith({
      token: 'token_1',
      tx: mocks.tx,
    })
  })

  it('returns not_found when link exists but linked client identity is missing', async () => {
    mocks.getClientClaimLinkByToken.mockResolvedValueOnce(
      makeInvite({ client: null }),
    )

    const result = await acceptClientClaimFromLink({
      token: 'token_1',
      actingUserId: 'user_1',
      actingClientId: 'client_1',
    })

    expect(result).toEqual({ kind: 'not_found' })
  })

  it('returns revoked when link status is REVOKED', async () => {
    mocks.getClientClaimLinkByToken.mockResolvedValueOnce(
      makeInvite({
        status: ProClientInviteStatus.REVOKED,
      }),
    )

    const result = await acceptClientClaimFromLink({
      token: 'token_1',
      actingUserId: 'user_1',
      actingClientId: 'client_1',
    })

    expect(result).toEqual({ kind: 'revoked' })
    expect(mocks.tx.clientProfile.findUnique).not.toHaveBeenCalled()
  })

  it('returns revoked when revokedAt is already set even if status is still PENDING', async () => {
    mocks.getClientClaimLinkByToken.mockResolvedValueOnce(
      makeInvite({
        status: ProClientInviteStatus.PENDING,
        revokedAt: new Date('2026-04-12T11:00:00.000Z'),
      }),
    )

    const result = await acceptClientClaimFromLink({
      token: 'token_1',
      actingUserId: 'user_1',
      actingClientId: 'client_1',
    })

    expect(result).toEqual({ kind: 'revoked' })
  })

  it('returns client_not_found when acting client profile does not exist', async () => {
    mocks.tx.clientProfile.findUnique.mockResolvedValueOnce(null)

    const result = await acceptClientClaimFromLink({
      token: 'token_1',
      actingUserId: 'user_1',
      actingClientId: 'client_1',
    })

    expect(result).toEqual({ kind: 'client_not_found' })
  })

  it('returns client_mismatch when link belongs to a different unclaimed client identity', async () => {
    mocks.getClientClaimLinkByToken.mockResolvedValueOnce(
      makeInvite({
        client: {
          id: 'client_other',
          userId: null,
          claimStatus: ClientClaimStatus.UNCLAIMED,
          claimedAt: null,
          preferredContactMethod: null,
        },
      }),
    )

    const result = await acceptClientClaimFromLink({
      token: 'token_1',
      actingUserId: 'user_1',
      actingClientId: 'client_1',
    })

    expect(result).toEqual({ kind: 'client_mismatch' })
    expect(mocks.tx.clientProfile.updateMany).not.toHaveBeenCalled()
    expect(mocks.markClientClaimLinkAcceptedAudit).not.toHaveBeenCalled()
  })

  it('returns already_claimed when link belongs to a different claimed client identity', async () => {
    mocks.getClientClaimLinkByToken.mockResolvedValueOnce(
      makeInvite({
        client: {
          id: 'client_other',
          userId: 'user_other',
          claimStatus: ClientClaimStatus.CLAIMED,
          claimedAt: new Date('2026-04-12T09:00:00.000Z'),
          preferredContactMethod: null,
        },
      }),
    )

    const result = await acceptClientClaimFromLink({
      token: 'token_1',
      actingUserId: 'user_1',
      actingClientId: 'client_1',
    })

    expect(result).toEqual({ kind: 'already_claimed' })
    expect(mocks.tx.clientProfile.updateMany).not.toHaveBeenCalled()
  })

  it('returns already_claimed when linked client identity is already claimed', async () => {
    mocks.getClientClaimLinkByToken.mockResolvedValueOnce(
      makeInvite({
        client: {
          id: 'client_1',
          userId: null,
          claimStatus: ClientClaimStatus.CLAIMED,
          claimedAt: new Date('2026-04-12T09:00:00.000Z'),
          preferredContactMethod: null,
        },
      }),
    )

    const result = await acceptClientClaimFromLink({
      token: 'token_1',
      actingUserId: 'user_1',
      actingClientId: 'client_1',
    })

    expect(result).toEqual({ kind: 'already_claimed' })
    expect(mocks.tx.clientProfile.updateMany).not.toHaveBeenCalled()
  })

  it('returns already_claimed when linked client has a different linked user already', async () => {
    mocks.getClientClaimLinkByToken.mockResolvedValueOnce(
      makeInvite({
        client: {
          id: 'client_1',
          userId: 'user_other',
          claimStatus: ClientClaimStatus.UNCLAIMED,
          claimedAt: null,
          preferredContactMethod: null,
        },
      }),
    )

    const result = await acceptClientClaimFromLink({
      token: 'token_1',
      actingUserId: 'user_1',
      actingClientId: 'client_1',
    })

    expect(result).toEqual({ kind: 'already_claimed' })
    expect(mocks.tx.clientProfile.updateMany).not.toHaveBeenCalled()
  })

  it('claims the client identity successfully and writes preferredContactMethod when acting client does not have one', async () => {
    mocks.getClientClaimLinkByToken.mockResolvedValueOnce(
      makeInvite({
        id: 'invite_1',
        bookingId: 'booking_1',
        preferredContactMethod: ContactMethod.EMAIL,
        client: {
          id: 'client_1',
          userId: null,
          claimStatus: ClientClaimStatus.UNCLAIMED,
          claimedAt: null,
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

    const result = await acceptClientClaimFromLink({
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

    expect(mocks.markClientClaimLinkAcceptedAudit).toHaveBeenCalledWith({
      inviteId: 'invite_1',
      actingUserId: 'user_1',
      acceptedAt: new Date('2026-04-12T12:00:00.000Z'),
      tx: mocks.tx,
    })

    expect(result).toEqual({
      kind: 'ok',
      bookingId: 'booking_1',
    })
  })

  it('claims successfully without overwriting an existing preferredContactMethod', async () => {
    mocks.getClientClaimLinkByToken.mockResolvedValueOnce(
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

    const result = await acceptClientClaimFromLink({
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

  it('preserves an existing invite acceptedAt timestamp when writing acceptance audit', async () => {
    mocks.getClientClaimLinkByToken.mockResolvedValueOnce(
      makeInvite({
        acceptedAt: new Date('2026-04-12T11:00:00.000Z'),
      }),
    )

    await acceptClientClaimFromLink({
      token: 'token_1',
      actingUserId: 'user_1',
      actingClientId: 'client_1',
    })

    expect(mocks.markClientClaimLinkAcceptedAudit).toHaveBeenCalledWith({
      inviteId: 'invite_1',
      actingUserId: 'user_1',
      acceptedAt: new Date('2026-04-12T11:00:00.000Z'),
      tx: mocks.tx,
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

    const result = await acceptClientClaimFromLink({
      token: 'token_1',
      actingUserId: 'user_1',
      actingClientId: 'client_1',
    })

    expect(result).toEqual({ kind: 'already_claimed' })
    expect(mocks.markClientClaimLinkAcceptedAudit).not.toHaveBeenCalled()
  })

  it('returns client_not_found when client claim update loses a race to deletion', async () => {
    mocks.tx.clientProfile.updateMany.mockResolvedValueOnce({ count: 0 })
    mocks.tx.clientProfile.findUnique
      .mockResolvedValueOnce(makeActingClient())
      .mockResolvedValueOnce(null)

    const result = await acceptClientClaimFromLink({
      token: 'token_1',
      actingUserId: 'user_1',
      actingClientId: 'client_1',
    })

    expect(result).toEqual({ kind: 'client_not_found' })
    expect(mocks.markClientClaimLinkAcceptedAudit).not.toHaveBeenCalled()
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

    const result = await acceptClientClaimFromLink({
      token: 'token_1',
      actingUserId: 'user_1',
      actingClientId: 'client_1',
    })

    expect(result).toEqual({ kind: 'conflict' })
    expect(mocks.markClientClaimLinkAcceptedAudit).not.toHaveBeenCalled()
  })

  it('returns revoked when acceptance audit loses a race to revocation', async () => {
    mocks.markClientClaimLinkAcceptedAudit.mockResolvedValueOnce('revoked')

    const result = await acceptClientClaimFromLink({
      token: 'token_1',
      actingUserId: 'user_1',
      actingClientId: 'client_1',
    })

    expect(result).toEqual({ kind: 'revoked' })
  })

  it('returns not_found when acceptance audit loses a race to deletion', async () => {
    mocks.markClientClaimLinkAcceptedAudit.mockResolvedValueOnce('not_found')

    const result = await acceptClientClaimFromLink({
      token: 'token_1',
      actingUserId: 'user_1',
      actingClientId: 'client_1',
    })

    expect(result).toEqual({ kind: 'not_found' })
  })

  it('returns conflict when acceptance audit does not succeed and link is still not revoked', async () => {
    mocks.markClientClaimLinkAcceptedAudit.mockResolvedValueOnce('conflict')

    const result = await acceptClientClaimFromLink({
      token: 'token_1',
      actingUserId: 'user_1',
      actingClientId: 'client_1',
    })

    expect(result).toEqual({ kind: 'conflict' })
  })
})