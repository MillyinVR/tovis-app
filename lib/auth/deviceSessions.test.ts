import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockPrisma = vi.hoisted(() => ({
  deviceSessionRevocation: {
    upsert: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }))

import {
  isDeviceSessionRevoked,
  listDeviceSessionRevocations,
  revokeDeviceSession,
} from './deviceSessions'

describe('lib/auth/deviceSessions', () => {
  beforeEach(() => {
    mockPrisma.deviceSessionRevocation.upsert.mockReset()
    mockPrisma.deviceSessionRevocation.findUnique.mockReset()
    mockPrisma.deviceSessionRevocation.findMany.mockReset()
  })

  describe('revokeDeviceSession', () => {
    it('upserts the (userId, deviceId) row and moves revokedAt to now', async () => {
      const now = new Date('2026-06-27T12:00:00.000Z')
      mockPrisma.deviceSessionRevocation.upsert.mockResolvedValue({
        revokedAt: now,
      })

      const revokedAt = await revokeDeviceSession({
        userId: 'user_1',
        deviceId: ' device_abc ',
        now,
      })

      expect(revokedAt).toEqual(now)
      expect(mockPrisma.deviceSessionRevocation.upsert).toHaveBeenCalledWith({
        where: { userId_deviceId: { userId: 'user_1', deviceId: 'device_abc' } },
        create: { userId: 'user_1', deviceId: 'device_abc', revokedAt: now },
        update: { revokedAt: now },
        select: { revokedAt: true },
      })
    })

    it('throws on a blank deviceId', async () => {
      await expect(
        revokeDeviceSession({ userId: 'user_1', deviceId: '   ' }),
      ).rejects.toThrow('deviceId must be a non-empty string.')
    })
  })

  describe('isDeviceSessionRevoked', () => {
    it('is false when no revocation row exists', async () => {
      mockPrisma.deviceSessionRevocation.findUnique.mockResolvedValue(null)

      expect(
        await isDeviceSessionRevoked({
          userId: 'user_1',
          deviceId: 'device_abc',
          issuedAtSeconds: 1000,
        }),
      ).toBe(false)
    })

    it('is true when the token was issued before the revocation', async () => {
      // revokedAt = 2000s; token iat = 1000s → token predates revoke → revoked.
      mockPrisma.deviceSessionRevocation.findUnique.mockResolvedValue({
        revokedAt: new Date(2000 * 1000),
      })

      expect(
        await isDeviceSessionRevoked({
          userId: 'user_1',
          deviceId: 'device_abc',
          issuedAtSeconds: 1000,
        }),
      ).toBe(true)
    })

    it('is false when the token was issued after the revocation (a later re-login)', async () => {
      // revokedAt = 1000s; token iat = 2000s → fresher token → allowed.
      mockPrisma.deviceSessionRevocation.findUnique.mockResolvedValue({
        revokedAt: new Date(1000 * 1000),
      })

      expect(
        await isDeviceSessionRevoked({
          userId: 'user_1',
          deviceId: 'device_abc',
          issuedAtSeconds: 2000,
        }),
      ).toBe(false)
    })

    it('fails safe (revoked) when the token has no issued-at and a revocation exists', async () => {
      mockPrisma.deviceSessionRevocation.findUnique.mockResolvedValue({
        revokedAt: new Date(1000 * 1000),
      })

      expect(
        await isDeviceSessionRevoked({
          userId: 'user_1',
          deviceId: 'device_abc',
          issuedAtSeconds: null,
        }),
      ).toBe(true)
    })

    it('is false (and skips the query) for a blank deviceId', async () => {
      expect(
        await isDeviceSessionRevoked({
          userId: 'user_1',
          deviceId: '   ',
          issuedAtSeconds: 1000,
        }),
      ).toBe(false)
      expect(
        mockPrisma.deviceSessionRevocation.findUnique,
      ).not.toHaveBeenCalled()
    })
  })

  describe('listDeviceSessionRevocations', () => {
    it('returns the user revocation rows', async () => {
      const rows = [{ deviceId: 'device_abc', revokedAt: new Date() }]
      mockPrisma.deviceSessionRevocation.findMany.mockResolvedValue(rows)

      expect(await listDeviceSessionRevocations('user_1')).toEqual(rows)
      expect(mockPrisma.deviceSessionRevocation.findMany).toHaveBeenCalledWith({
        where: { userId: 'user_1' },
        select: { deviceId: true, revokedAt: true },
      })
    })
  })
})
