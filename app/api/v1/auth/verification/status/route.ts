// app/api/v1/auth/verification/status/route.ts
import { jsonOk } from '@/app/api/_utils'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { setSessionCookie } from '@/app/api/_utils/auth/sessionCookie'
import { createActiveToken } from '@/lib/auth'
import { logAuthEvent } from '@/lib/observability/authEvents'
import { getPostVerificationNextUrl } from '@/lib/proTrustState'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request) {
  const auth = await requireUser({ allowVerificationSession: true })
  if (!auth.ok) return auth.res

  const user = auth.user

  // Heal stale verification sessions: verification can complete in a
  // different tab or device (e.g. the email link opened in a mail app), so
  // this browser may still hold a VERIFICATION-kind cookie even though the
  // user is fully verified. Without the upgrade, the verify screen and the
  // app shells redirect each other in a loop.
  const upgradeToActive =
    user.sessionKind === 'VERIFICATION' && user.isFullyVerified

  const sessionKind = upgradeToActive ? 'ACTIVE' : user.sessionKind

  const nextUrl =
    sessionKind === 'VERIFICATION' && !user.isFullyVerified
      ? null
      : getPostVerificationNextUrl({
          role: user.role,
          professionalVerificationStatus:
            user.professionalProfile?.verificationStatus ?? null,
        })

  const res = jsonOk({
    user: {
      id: user.id,
      email: user.email,
      phone: user.phone,
      role: user.role,
    },
    sessionKind,
    isPhoneVerified: user.isPhoneVerified,
    isEmailVerified: user.isEmailVerified,
    isFullyVerified: user.isFullyVerified,
    requiresPhoneVerification: !user.isPhoneVerified,
    requiresEmailVerification: !user.isEmailVerified,
    nextUrl,
  })

  if (upgradeToActive) {
    setSessionCookie({
      response: res,
      request,
      token: createActiveToken({
        userId: user.id,
        role: user.role,
        authVersion: user.authVersion,
        deviceId: user.deviceId, // preserve device binding through verification
      }),
    })

    logAuthEvent({
      level: 'info',
      event: 'auth.session.upgraded_from_stale_verification',
      route: 'auth.verification.status',
      userId: user.id,
    })
  }

  return res
}
