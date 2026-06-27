// lib/dto/device.ts
//
// Wire DTO for the manage-devices / per-device revocation surface
// (GET /api/v1/devices). JSON-safe: Date → ISO string.
import type { DevicePlatform } from '@prisma/client'

import type { UserDeviceSummary } from '@/lib/notifications/devices/deviceTokens'

export type UserDeviceDTO = {
  deviceId: string
  platforms: DevicePlatform[]
  /** At least one push token for this device is still active. */
  pushActive: boolean
  /** Most recent push-token activity for this device (ISO), or null. */
  lastSeenAt: string | null
  /** This device's session has been revoked. */
  revoked: boolean
  /** When the device session was revoked (ISO), or null. */
  revokedAt: string | null
}

export function serializeUserDevice(
  summary: UserDeviceSummary,
  revokedAt: Date | null,
): UserDeviceDTO {
  return {
    deviceId: summary.deviceId,
    platforms: summary.platforms,
    pushActive: summary.pushActive,
    lastSeenAt: summary.lastSeenAt ? summary.lastSeenAt.toISOString() : null,
    revoked: revokedAt !== null,
    revokedAt: revokedAt ? revokedAt.toISOString() : null,
  }
}
