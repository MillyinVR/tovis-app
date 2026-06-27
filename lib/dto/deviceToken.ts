// lib/dto/deviceToken.ts
//
// JSON-safe wire DTO for a registered push DeviceToken. Deliberately does NOT
// echo the raw push `token` back to the client — it's a delivery capability
// secret the caller already holds; there's no reason to return it (and it keeps
// it out of client logs).
import type { DeviceToken } from '@prisma/client'

export type DeviceTokenDTO = {
  id: string
  platform: string
  deviceId: string | null
  isActive: boolean
  lastSeenAt: string | null
  createdAt: string
}

export function serializeDeviceToken(row: DeviceToken): DeviceTokenDTO {
  return {
    id: row.id,
    platform: row.platform,
    deviceId: row.deviceId,
    isActive: row.isActive,
    lastSeenAt: row.lastSeenAt ? row.lastSeenAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  }
}
