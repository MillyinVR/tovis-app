import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  isUserPairBlocked: vi.fn(),
  professionalFindUnique: vi.fn(),
  clientFindUnique: vi.fn(),
}))

vi.mock('@/lib/blocks/userBlocks', () => ({
  isUserPairBlocked: mocks.isUserPairBlocked,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    professionalProfile: { findUnique: mocks.professionalFindUnique },
    clientProfile: { findUnique: mocks.clientFindUnique },
  },
}))

import { isBlockedNotificationParty } from './blockedNotificationParty'

describe('isBlockedNotificationParty', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.isUserPairBlocked.mockResolvedValue(false)
    mocks.professionalFindUnique.mockResolvedValue({ userId: 'user_pro' })
    mocks.clientFindUnique.mockResolvedValue({ userId: 'user_client' })
  })

  it('resolves a pro inbox id to its User before checking the pair', async () => {
    // professionalId !== userId, and a block is keyed on User — checking the
    // profile id against a block row would silently never match.
    await expect(
      isBlockedNotificationParty({
        actor: { kind: 'user', userId: 'user_actor' },
        recipient: { kind: 'pro', professionalId: 'pro_1' },
      }),
    ).resolves.toBe(false)

    expect(mocks.professionalFindUnique).toHaveBeenCalledWith({
      where: { id: 'pro_1' },
      select: { userId: true },
    })
    expect(mocks.isUserPairBlocked).toHaveBeenCalledWith(expect.anything(), {
      userIdA: 'user_actor',
      userIdB: 'user_pro',
    })
  })

  it('resolves a client inbox id to its User before checking the pair', async () => {
    await isBlockedNotificationParty({
      actor: { kind: 'client', clientId: 'client_actor' },
      recipient: { kind: 'client', clientId: 'client_recipient' },
    })

    expect(mocks.clientFindUnique).toHaveBeenNthCalledWith(1, {
      where: { id: 'client_actor' },
      select: { userId: true },
    })
    expect(mocks.clientFindUnique).toHaveBeenNthCalledWith(2, {
      where: { id: 'client_recipient' },
      select: { userId: true },
    })
  })

  it('reports blocked when the pair check says so', async () => {
    mocks.isUserPairBlocked.mockResolvedValue(true)

    await expect(
      isBlockedNotificationParty({
        actor: { kind: 'user', userId: 'user_actor' },
        recipient: { kind: 'user', userId: 'user_recipient' },
      }),
    ).resolves.toBe(true)
  })

  it('takes a user party at face value, with no profile lookup', async () => {
    await isBlockedNotificationParty({
      actor: { kind: 'user', userId: ' user_actor ' },
      recipient: { kind: 'user', userId: 'user_recipient' },
    })

    expect(mocks.professionalFindUnique).not.toHaveBeenCalled()
    expect(mocks.clientFindUnique).not.toHaveBeenCalled()
    expect(mocks.isUserPairBlocked).toHaveBeenCalledWith(expect.anything(), {
      userIdA: 'user_actor',
      userIdB: 'user_recipient',
    })
  })

  it('is not blocked when a client party has no User account at all', async () => {
    // ClientProfile.userId is NULLABLE — a record nobody has signed into can
    // neither block nor be blocked, exactly as buildLookPostBlockFilter treats
    // it. Answering "blocked" here would silently drop unrelated notifications.
    mocks.clientFindUnique.mockResolvedValue({ userId: null })

    await expect(
      isBlockedNotificationParty({
        actor: { kind: 'user', userId: 'user_actor' },
        recipient: { kind: 'client', clientId: 'client_1' },
      }),
    ).resolves.toBe(false)
    expect(mocks.isUserPairBlocked).not.toHaveBeenCalled()
  })

  it('is not blocked when the party names no profile row', async () => {
    mocks.professionalFindUnique.mockResolvedValue(null)

    await expect(
      isBlockedNotificationParty({
        actor: { kind: 'user', userId: 'user_actor' },
        recipient: { kind: 'pro', professionalId: 'pro_missing' },
      }),
    ).resolves.toBe(false)
    expect(mocks.isUserPairBlocked).not.toHaveBeenCalled()
  })

  it('short-circuits an unresolvable ACTOR before reading the recipient', async () => {
    await expect(
      isBlockedNotificationParty({
        actor: { kind: 'user', userId: '   ' },
        recipient: { kind: 'pro', professionalId: 'pro_1' },
      }),
    ).resolves.toBe(false)

    expect(mocks.professionalFindUnique).not.toHaveBeenCalled()
    expect(mocks.isUserPairBlocked).not.toHaveBeenCalled()
  })

  it('propagates a read failure instead of defaulting to "deliver it anyway"', async () => {
    // Fail CLOSED: callers are best-effort behind a .catch, so a throw costs one
    // notification. Swallowing it would turn any database blip into a delivered
    // notification from someone the recipient blocked.
    mocks.isUserPairBlocked.mockRejectedValue(new Error('db down'))

    await expect(
      isBlockedNotificationParty({
        actor: { kind: 'user', userId: 'user_actor' },
        recipient: { kind: 'user', userId: 'user_recipient' },
      }),
    ).rejects.toThrow('db down')
  })

  it('uses the caller transaction when one is given', async () => {
    const tx = {
      professionalProfile: { findUnique: vi.fn().mockResolvedValue({ userId: 'user_pro' }) },
      clientProfile: { findUnique: vi.fn() },
    }

    await isBlockedNotificationParty({
      actor: { kind: 'user', userId: 'user_actor' },
      recipient: { kind: 'pro', professionalId: 'pro_1' },
      // @ts-expect-error — a minimal stand-in for Prisma.TransactionClient.
      db: tx,
    })

    expect(tx.professionalProfile.findUnique).toHaveBeenCalled()
    expect(mocks.professionalFindUnique).not.toHaveBeenCalled()
    expect(mocks.isUserPairBlocked).toHaveBeenCalledWith(tx, expect.anything())
  })
})
