// app/api/auth/verification/status/route.ts
import { jsonOk } from '@/app/api/_utils'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { getPostVerificationNextUrl } from '@/lib/proTrustState'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const auth = await requireUser({ allowVerificationSession: true })
  if (!auth.ok) return auth.res

  const user = auth.user

  return jsonOk({
    user: {
      id: user.id,
      email: user.email,
      phone: user.phone,
      role: user.role,
    },
    sessionKind: user.sessionKind,
    isPhoneVerified: user.isPhoneVerified,
    isEmailVerified: user.isEmailVerified,
    isFullyVerified: user.isFullyVerified,
    requiresPhoneVerification: !user.isPhoneVerified,
    requiresEmailVerification: !user.isEmailVerified,
    nextUrl: getPostVerificationNextUrl({
      role: user.role,
      professionalVerificationStatus:
        user.professionalProfile?.verificationStatus ?? null,
    }),
  })
}