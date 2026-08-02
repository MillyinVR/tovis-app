import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockPrisma = vi.hoisted(() => ({
  deviceToken: {
    upsert: vi.fn(),
    updateMany: vi.fn(),
  },
  // Array-form $transaction: resolve the promises the callers handed us so the
  // per-operation mocks still drive the results.
  $transaction: vi.fn((ops: unknown[]) => Promise.all(ops)),
}))

vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }))

import {
  deactivateDeviceToken,
  invalidateDeviceToken,
  registerDeviceToken,
} from './deviceTokens'

describe('registerDeviceToken', () => {
  beforeEach(() => vi.clearAllMocks())

  it('upserts by (platform, token) and reassigns to the current user + reactivates', async () => {
    mockPrisma.deviceToken.upsert.mockResolvedValue({ id: 'dt_1' })

    await registerDeviceToken({
      userId: 'user_2',
      platform: 'IOS',
      token: 'apns-abc',
      deviceId: '  dev-9  ',
    })

    const arg = mockPrisma.deviceToken.upsert.mock.calls[0]?.[0]
    expect(arg.where).toEqual({
      platform_token: { platform: 'IOS', token: 'apns-abc' },
    })
    // create + update both bind the CURRENT user and reactivate (token may have
    // moved installs / been unregistered before).
    expect(arg.create.userId).toBe('user_2')
    expect(arg.create.isActive).toBe(true)
    expect(arg.update.userId).toBe('user_2')
    expect(arg.update.isActive).toBe(true)
    // deviceId is trimmed.
    expect(arg.create.deviceId).toBe('dev-9')
  })

  it('normalizes an empty/whitespace deviceId to null', async () => {
    mockPrisma.deviceToken.upsert.mockResolvedValue({ id: 'dt_1' })

    await registerDeviceToken({
      userId: 'u',
      platform: 'ANDROID',
      token: 't',
      deviceId: '   ',
    })

    const arg = mockPrisma.deviceToken.upsert.mock.calls[0]?.[0]
    expect(arg.create.deviceId).toBeNull()
  })

  // An install holds one live push token; the provider rotates it and the old
  // value is dead immediately. Leaving the predecessor active made every future
  // notification fan out to it as well (13 active rows for one phone in prod).
  it('retires this install’s superseded tokens, atomically with the upsert', async () => {
    mockPrisma.deviceToken.upsert.mockResolvedValue({ id: 'dt_new' })
    mockPrisma.deviceToken.updateMany.mockResolvedValue({ count: 12 })

    const row = await registerDeviceToken({
      userId: 'user_2',
      platform: 'IOS',
      token: 'apns-new',
      deviceId: 'dev-9',
    })

    // The upsert's row is still what the caller gets back.
    expect(row).toEqual({ id: 'dt_new' })

    const where = mockPrisma.deviceToken.updateMany.mock.calls[0]?.[0]?.where
    expect(where).toEqual({
      userId: 'user_2',
      platform: 'IOS',
      deviceId: 'dev-9',
      token: { not: 'apns-new' },
      isActive: true,
    })
    expect(
      mockPrisma.deviceToken.updateMany.mock.calls[0]?.[0]?.data,
    ).toEqual({ isActive: false })

    // Both writes land together, so "new token active" and "old tokens off" can
    // never disagree.
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1)
    expect(mockPrisma.$transaction.mock.calls[0]?.[0]).toHaveLength(2)
  })

  it('never retires anything when the client sent no deviceId', async () => {
    mockPrisma.deviceToken.upsert.mockResolvedValue({ id: 'dt_1' })

    // Without a stable install id there is nothing that identifies "the same
    // install", so deactivating would silently kill the user's OTHER phones.
    const row = await registerDeviceToken({
      userId: 'u',
      platform: 'IOS',
      token: 't-new',
      deviceId: null,
    })

    expect(row).toEqual({ id: 'dt_1' })
    expect(mockPrisma.deviceToken.updateMany).not.toHaveBeenCalled()
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })

  it('does not retire the same install’s OTHER platform token', async () => {
    mockPrisma.deviceToken.upsert.mockResolvedValue({ id: 'dt_1' })
    mockPrisma.deviceToken.updateMany.mockResolvedValue({ count: 0 })

    await registerDeviceToken({
      userId: 'u',
      platform: 'ANDROID',
      token: 'fcm-new',
      deviceId: 'dev-9',
    })

    expect(
      mockPrisma.deviceToken.updateMany.mock.calls[0]?.[0]?.where?.platform,
    ).toBe('ANDROID')
  })
})

describe('deactivateDeviceToken', () => {
  beforeEach(() => vi.clearAllMocks())

  it('only deactivates a token owned by the calling user', async () => {
    mockPrisma.deviceToken.updateMany.mockResolvedValue({ count: 1 })

    const removed = await deactivateDeviceToken({
      userId: 'user_1',
      platform: 'IOS',
      token: 'apns-abc',
    })

    expect(removed).toBe(true)
    expect(mockPrisma.deviceToken.updateMany).toHaveBeenCalledWith({
      where: { platform: 'IOS', token: 'apns-abc', userId: 'user_1' },
      data: { isActive: false },
    })
  })

  it('returns false when no matching owned token exists', async () => {
    mockPrisma.deviceToken.updateMany.mockResolvedValue({ count: 0 })

    const removed = await deactivateDeviceToken({
      userId: 'user_1',
      platform: 'ANDROID',
      token: 'nope',
    })

    expect(removed).toBe(false)
  })
})

describe('invalidateDeviceToken', () => {
  beforeEach(() => vi.clearAllMocks())

  it('deactivates by (platform, token) WITHOUT scoping to a user', async () => {
    mockPrisma.deviceToken.updateMany.mockResolvedValue({ count: 1 })

    await invalidateDeviceToken({ platform: 'IOS', token: 'apns-dead' })

    expect(mockPrisma.deviceToken.updateMany).toHaveBeenCalledWith({
      where: { platform: 'IOS', token: 'apns-dead' },
      data: { isActive: false },
    })

    // No userId in the where clause — the provider reported the token dead.
    const arg = mockPrisma.deviceToken.updateMany.mock.calls[0]?.[0]
    expect(arg.where).not.toHaveProperty('userId')
  })
})
