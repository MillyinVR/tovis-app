// app/api/v1/devices/route.ts
//
// Native push-token registration. The app registers its APNs/FCM token on launch
// (POST) and unregisters on logout (DELETE). Bearer-auth like every native API
// path. The notification engine does not yet deliver to these tokens — this is
// the foundation only.
import { DevicePlatform } from '@prisma/client'

import { jsonFail, jsonOk } from '@/app/api/_utils/responses'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import { pickEnum, pickString } from '@/app/api/_utils/pick'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import {
  deactivateDeviceToken,
  listUserDevices,
  registerDeviceToken,
} from '@/lib/notifications/devices/deviceTokens'
import { listDeviceSessionRevocations } from '@/lib/auth/deviceSessions'
import { serializeDeviceToken } from '@/lib/dto/deviceToken'
import { serializeUserDevice } from '@/lib/dto/device'
import { safeError } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'

const ALLOWED_PLATFORMS = Object.values(DevicePlatform)

// Manage-devices list: every known device (those that registered a push token
// with a stable deviceId) plus its per-device revocation state, so a user can
// see and sign out a lost phone individually.
export async function GET() {
  const auth = await requireUser()
  if (!auth.ok) return auth.res

  try {
    const [devices, revocations] = await Promise.all([
      listUserDevices(auth.user.id),
      listDeviceSessionRevocations(auth.user.id),
    ])

    const revokedAtByDeviceId = new Map(
      revocations.map((r) => [r.deviceId, r.revokedAt]),
    )

    return jsonOk(
      {
        devices: devices.map((device) =>
          serializeUserDevice(
            device,
            revokedAtByDeviceId.get(device.deviceId) ?? null,
          ),
        ),
      },
      200,
    )
  } catch (error: unknown) {
    console.error('GET /api/v1/devices error', { error: safeError(error) })
    return jsonFail(500, 'Failed to load devices.')
  }
}

export async function POST(request: Request) {
  const auth = await requireUser()
  if (!auth.ok) return auth.res

  try {
    const body = await readJsonRecord(request)
    const platform = pickEnum(body.platform, ALLOWED_PLATFORMS)
    const token = pickString(body.token)
    const deviceId = pickString(body.deviceId)

    if (!platform) {
      return jsonFail(400, 'platform must be IOS or ANDROID', {
        code: 'INVALID_PLATFORM',
      })
    }
    if (!token) {
      return jsonFail(400, 'token is required', { code: 'MISSING_TOKEN' })
    }

    const row = await registerDeviceToken({
      userId: auth.user.id,
      platform,
      token,
      deviceId,
    })

    return jsonOk({ device: serializeDeviceToken(row) }, 200)
  } catch (error: unknown) {
    console.error('POST /api/v1/devices error', { error: safeError(error) })
    return jsonFail(500, 'Failed to register device.')
  }
}

export async function DELETE(request: Request) {
  const auth = await requireUser()
  if (!auth.ok) return auth.res

  try {
    const body = await readJsonRecord(request)
    const platform = pickEnum(body.platform, ALLOWED_PLATFORMS)
    const token = pickString(body.token)

    if (!platform) {
      return jsonFail(400, 'platform must be IOS or ANDROID', {
        code: 'INVALID_PLATFORM',
      })
    }
    if (!token) {
      return jsonFail(400, 'token is required', { code: 'MISSING_TOKEN' })
    }

    // Idempotent: succeeds whether or not a matching active token existed.
    const removed = await deactivateDeviceToken({
      userId: auth.user.id,
      platform,
      token,
    })

    return jsonOk({ ok: true, removed }, 200)
  } catch (error: unknown) {
    console.error('DELETE /api/v1/devices error', { error: safeError(error) })
    return jsonFail(500, 'Failed to unregister device.')
  }
}
