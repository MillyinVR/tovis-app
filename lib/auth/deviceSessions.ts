// lib/auth/deviceSessions.ts
//
// Per-device session revocation. The auth session is a stateless JWT keyed by
// the per-user `authVersion` (bumping it kills EVERY session). To sign out a
// single lost/stolen device WITHOUT nuking the user's other sessions, native
// tokens additionally carry a stable `deviceId` claim; revoking a device stamps
// a `revokedAt` here, and `getCurrentUser` rejects any token for that
// `(userId, deviceId)` issued at or before that instant.
//
// One upserted row per device is enough: a later re-login on the same device
// mints a fresher token (`iat` > `revokedAt`) that passes again, and revoking
// again just moves `revokedAt` forward.

import { prisma } from '@/lib/prisma'

function normalizeDeviceId(deviceId: string): string {
  const trimmed = deviceId.trim()
  if (!trimmed) {
    throw new Error('deviceId must be a non-empty string.')
  }
  return trimmed
}

/**
 * Revoke the session bound to a single device. Idempotent — upserts the
 * `(userId, deviceId)` row and moves `revokedAt` to now. Returns the effective
 * revocation instant.
 */
export async function revokeDeviceSession(args: {
  userId: string
  deviceId: string
  now?: Date
}): Promise<Date> {
  const deviceId = normalizeDeviceId(args.deviceId)
  const revokedAt = args.now ?? new Date()

  const row = await prisma.deviceSessionRevocation.upsert({
    where: { userId_deviceId: { userId: args.userId, deviceId } },
    create: { userId: args.userId, deviceId, revokedAt },
    update: { revokedAt },
    select: { revokedAt: true },
  })

  return row.revokedAt
}

/**
 * True when a token for this device should be rejected: a revocation exists and
 * the token was issued at or before it. A token with no `iat` (should not happen
 * for tokens this app mints) fails safe — any revocation row rejects it.
 */
export async function isDeviceSessionRevoked(args: {
  userId: string
  deviceId: string
  issuedAtSeconds: number | null
}): Promise<boolean> {
  const deviceId = args.deviceId.trim()
  if (!deviceId) return false

  const row = await prisma.deviceSessionRevocation.findUnique({
    where: { userId_deviceId: { userId: args.userId, deviceId } },
    select: { revokedAt: true },
  })

  if (!row) return false
  if (args.issuedAtSeconds === null) return true

  return row.revokedAt.getTime() >= args.issuedAtSeconds * 1000
}

export type DeviceSessionRevocationState = {
  deviceId: string
  revokedAt: Date
}

/** All active per-device revocations for a user (for the device-list surface). */
export async function listDeviceSessionRevocations(
  userId: string,
): Promise<DeviceSessionRevocationState[]> {
  const rows = await prisma.deviceSessionRevocation.findMany({
    where: { userId },
    select: { deviceId: true, revokedAt: true },
  })

  return rows
}
