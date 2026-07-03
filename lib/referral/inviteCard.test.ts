// lib/referral/inviteCard.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NfcCardType } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  nfcCardFindFirst: vi.fn(),
  nfcCardCreate: vi.fn(),
  clientProfileFindUnique: vi.fn(),
  isUniqueConstraintError: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    nfcCard: {
      findFirst: mocks.nfcCardFindFirst,
      create: mocks.nfcCardCreate,
    },
    clientProfile: {
      findUnique: mocks.clientProfileFindUnique,
    },
  },
}))

vi.mock('@/lib/prismaErrors', () => ({
  isUniqueConstraintError: mocks.isUniqueConstraintError,
}))

import { getOrCreateClientInviteCard } from './inviteCard'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.nfcCardFindFirst.mockResolvedValue(null)
  mocks.clientProfileFindUnique.mockResolvedValue({ homeTenantId: 'tenant_1' })
  mocks.isUniqueConstraintError.mockReturnValue(false)
})

describe('getOrCreateClientInviteCard', () => {
  it('reuses the client’s existing active CLIENT_REFERRAL card', async () => {
    mocks.nfcCardFindFirst.mockResolvedValue({
      id: 'card_1',
      shortCode: 'ABCD2345',
    })

    const card = await getOrCreateClientInviteCard({
      userId: 'user_1',
      clientId: 'client_1',
    })

    expect(card).toEqual({
      cardId: 'card_1',
      shortCode: 'ABCD2345',
      shortCodeDisplay: 'TOV-ABCD-2345',
      path: '/c/ABCD2345',
    })

    expect(mocks.nfcCardFindFirst).toHaveBeenCalledWith({
      where: {
        claimedByUserId: 'user_1',
        type: NfcCardType.CLIENT_REFERRAL,
        isActive: true,
      },
      orderBy: { claimedAt: 'desc' },
      select: { id: true, shortCode: true },
    })
    expect(mocks.nfcCardCreate).not.toHaveBeenCalled()
  })

  it('mints a claimed virtual card in the client’s home tenant', async () => {
    mocks.nfcCardCreate.mockImplementation(
      ({ data }: { data: { shortCode: string } }) =>
        Promise.resolve({ id: 'card_new', shortCode: data.shortCode }),
    )

    const card = await getOrCreateClientInviteCard({
      userId: 'user_1',
      clientId: 'client_1',
    })

    expect(card.cardId).toBe('card_new')
    expect(card.path).toBe(`/c/${card.shortCode}`)

    const createArgs = mocks.nfcCardCreate.mock.calls[0]?.[0] as {
      data: Record<string, unknown>
    }
    expect(createArgs.data).toMatchObject({
      type: NfcCardType.CLIENT_REFERRAL,
      isActive: true,
      tenantId: 'tenant_1',
      claimedByUserId: 'user_1',
    })
    expect(createArgs.data.claimedAt).toBeInstanceOf(Date)
    expect(typeof createArgs.data.shortCode).toBe('string')
  })

  it('retries on short-code collisions', async () => {
    const collision = new Error('unique')
    mocks.isUniqueConstraintError.mockImplementation((e) => e === collision)
    mocks.nfcCardCreate
      .mockRejectedValueOnce(collision)
      .mockImplementationOnce(
        ({ data }: { data: { shortCode: string } }) =>
          Promise.resolve({ id: 'card_retry', shortCode: data.shortCode }),
      )

    const card = await getOrCreateClientInviteCard({
      userId: 'user_1',
      clientId: 'client_1',
    })

    expect(card.cardId).toBe('card_retry')
    expect(mocks.nfcCardCreate).toHaveBeenCalledTimes(2)
  })

  it('throws when the client profile is missing', async () => {
    mocks.clientProfileFindUnique.mockResolvedValue(null)

    await expect(
      getOrCreateClientInviteCard({ userId: 'user_1', clientId: 'client_x' }),
    ).rejects.toThrow('client profile not found')
  })
})
