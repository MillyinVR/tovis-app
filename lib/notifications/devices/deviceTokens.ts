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
