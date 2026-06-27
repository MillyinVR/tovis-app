// app/api/v1/devices/[deviceId]/route.ts
//
// Per-device session revocation — "sign this phone out". Revokes the session
// bound to a single deviceId (stamps DeviceSessionRevocation.revokedAt, so any
// token for this device issued at/before now is rejected by getCurrentUser) and
// deactivates that device's push tokens. The user's other devices are untouched
// — unlike an authVersion bump, which signs out everywhere.
import { jsonFail, jsonOk } from '@/app/api/_utils/responses'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { revokeDeviceSession } from '@/lib/auth/deviceSessions'
import { deactivateDeviceTokensByDeviceId } from '@/lib/notifications/devices/deviceTokens'
import { safeError } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ deviceId: string }> },
) {
  const auth = await requireUser()
  if (!auth.ok) return auth.res

  const { deviceId: rawDeviceId } = await params
  const deviceId = rawDeviceId?.trim()

  if (!deviceId) {
    return jsonFail(400, 'deviceId is required', { code: 'MISSING_DEVICE_ID' })
  }

  try {
    // Scoped to the owner: revocation upserts on (userId, deviceId), and the
    // push deactivation filters by userId, so one user can't revoke another's.
    const [revokedAt, pushDeactivated] = await Promise.all([
      revokeDeviceSession({ userId: auth.user.id, deviceId }),
      deactivateDeviceTokensByDeviceId({ userId: auth.user.id, deviceId }),
    ])

    return jsonOk(
      {
        ok: true,
        deviceId,
        revokedAt: revokedAt.toISOString(),
        pushTokensDeactivated: pushDeactivated,
      },
      200,
    )
  } catch (error: unknown) {
    console.error('DELETE /api/v1/devices/[deviceId] error', {
      error: safeError(error),
    })
    return jsonFail(500, 'Failed to revoke device.')
  }
}
