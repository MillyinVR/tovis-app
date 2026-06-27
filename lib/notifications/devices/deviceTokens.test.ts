import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockPrisma = vi.hoisted(() => ({
  deviceToken: {
    upsert: vi.fn(),
    updateMany: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }))

import { deactivateDeviceToken, registerDeviceToken } from './deviceTokens'

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
