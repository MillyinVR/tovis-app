// app/api/v1/auth/refresh/route.ts
//
// Re-issues an ACTIVE session token for a caller that still holds a valid one.
// This is the rotation primitive native clients use to keep a session alive
// without forcing a full re-login, and to roll the on-device token before it
// expires.
//
// Stateless by design — it reuses the existing JWT machinery and adds no new
// model. `requireUser()` runs `getCurrentUser()`, which DB-verifies authVersion,
// so a revoked session (sign-out-everywhere / password reset / authVersion
// bump) can no longer refresh: the old token fails auth and this route returns
// 401 instead of minting a fresh one. The re-minted token preserves the current
// ACTING role so a workspace switch survives a refresh.
//
// NOTE (deferred hardening, see docs/mobile/native-readiness-handoff.md):
// this re-issues the same 7-day TTL the web uses. True short-access +
// long-refresh rotation with per-device revocation lands with the DeviceToken
// model (Tier 1.1 / 4.2) — it needs that device record to be meaningful.

import { jsonOk } from '@/app/api/_utils'
import type { AuthRefreshResponseDTO } from '@/lib/dto/auth'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { setSessionCookie } from '@/app/api/_utils/auth/sessionCookie'
import { createActiveToken } from '@/lib/auth'

export async function POST(request: Request) {
  const auth = await requireUser()
  if (!auth.ok) return auth.res

  const { user } = auth

  const token = createActiveToken({
    userId: user.id,
    role: user.role, // acting role — preserves an active workspace switch
    authVersion: user.authVersion,
    deviceId: user.deviceId, // keep the device binding across rotation
  })

  // Native replays `token` as a bearer; web keeps using the refreshed cookie.
  const response = jsonOk({ token } satisfies AuthRefreshResponseDTO, 200)
  setSessionCookie({ response, request, token })
  return response
}
