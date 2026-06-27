// lib/notifications/devices/deviceTokens.ts
//
// DeviceToken lifecycle helpers. Native apps register their APNs/FCM push token
// here on launch (and after a token refresh); they unregister on logout. A push
// token is globally unique to one install, so registering reassigns it to the
// current user (handles a device that switched accounts) rather than leaving a
// stale row pointed at the previous user.
//
// This is the foundation only — the notification engine does not yet fan PUSH
// deliveries out to these tokens (wired in a later phase).
import type { DevicePlatform } from '@prisma/client'

import { prisma } from '@/lib/prisma'

export type RegisterDeviceTokenArgs = {
  userId: string
  platform: DevicePlatform
  token: string
  deviceId?: string | null
}

export async function registerDeviceToken(args: RegisterDeviceTokenArgs) {
  const deviceId = args.deviceId?.trim() || null
  const now = new Date()

  return prisma.deviceToken.upsert({
    where: { platform_token: { platform: args.platform, token: args.token } },
    create: {
      userId: args.userId,
      platform: args.platform,
      token: args.token,
      deviceId,
      isActive: true,
      lastSeenAt: now,
    },
    update: {
      // Reassign to the current user + reactivate (token may have moved installs
      // or been previously unregistered on logout).
      userId: args.userId,
      deviceId,
      isActive: true,
      lastSeenAt: now,
    },
  })
}

export type DeactivateDeviceTokenArgs = {
  userId: string
  platform: DevicePlatform
  token: string
}

// Soft-deactivate (not delete) and ONLY for a token owned by this user, so one
// user can't unregister another's device. Returns whether a row was affected.
export async function deactivateDeviceToken(
  args: DeactivateDeviceTokenArgs,
): Promise<boolean> {
  const result = await prisma.deviceToken.updateMany({
    where: {
      platform: args.platform,
      token: args.token,
      userId: args.userId,
    },
    data: { isActive: false },
  })

  return result.count > 0
}

// Soft-deactivate every push token this user holds for a given device, scoped
// to the owner. Used when revoking a device's session so it also stops receiving
// pushes. Returns how many rows were affected.
export async function deactivateDeviceTokensByDeviceId(args: {
  userId: string
  deviceId: string
}): Promise<number> {
  const deviceId = args.deviceId.trim()
  if (!deviceId) return 0

  const result = await prisma.deviceToken.updateMany({
    where: { userId: args.userId, deviceId },
    data: { isActive: false },
  })

  return result.count
}

export type UserDeviceSummary = {
  deviceId: string
  platforms: DevicePlatform[]
  pushActive: boolean
  lastSeenAt: Date | null
}

// One entry per known device (grouped by deviceId) for the manage-devices /
// revoke surface. Only devices that registered a push token with a stable
// deviceId are listed — that is the server's device registry today.
export async function listUserDevices(
  userId: string,
): Promise<UserDeviceSummary[]> {
  const rows = await prisma.deviceToken.findMany({
    where: { userId, deviceId: { not: null } },
    select: { deviceId: true, platform: true, isActive: true, lastSeenAt: true },
    orderBy: { lastSeenAt: 'desc' },
  })

  const byDevice = new Map<string, UserDeviceSummary>()

  for (const row of rows) {
    if (!row.deviceId) continue

    const existing = byDevice.get(row.deviceId)
    if (!existing) {
      byDevice.set(row.deviceId, {
        deviceId: row.deviceId,
        platforms: [row.platform],
        pushActive: row.isActive,
        lastSeenAt: row.lastSeenAt,
      })
      continue
    }

    if (!existing.platforms.includes(row.platform)) {
      existing.platforms.push(row.platform)
    }
    existing.pushActive = existing.pushActive || row.isActive
    if (
      row.lastSeenAt &&
      (!existing.lastSeenAt || row.lastSeenAt > existing.lastSeenAt)
    ) {
      existing.lastSeenAt = row.lastSeenAt
    }
  }

  return [...byDevice.values()]
}

export type InvalidateDeviceTokenArgs = {
  platform: DevicePlatform
  token: string
}

// Deactivate a token the PROVIDER reported as dead (APNs Unregistered/
// BadDeviceToken, FCM UNREGISTERED/INVALID_ARGUMENT, etc.). Unlike
// deactivateDeviceToken this is NOT scoped to a user: the provider has told us
// this exact (platform, token) install can no longer receive pushes, so it must
// be deactivated regardless of which user it is currently bound to.
export async function invalidateDeviceToken(
  args: InvalidateDeviceTokenArgs,
): Promise<void> {
  await prisma.deviceToken.updateMany({
    where: {
      platform: args.platform,
      token: args.token,
    },
    data: { isActive: false },
  })
}
