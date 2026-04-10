import { jsonOk } from '@/app/api/_utils'
import { requireUser } from '@/app/api/_utils/auth/requireUser'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const PRO_HOME = '/pro/calendar'
const CLIENT_HOME = '/looks'
const ADMIN_HOME = '/admin'

function getDefaultNextUrl(role: 'CLIENT' | 'PRO' | 'ADMIN'): string {
  if (role === 'ADMIN') return ADMIN_HOME
  if (role === 'PRO') return PRO_HOME
  return CLIENT_HOME
}

export async function GET() {
  const auth = await requireUser({ allowVerificationSession: true })
  if (!auth.ok) return auth.res

  const user = auth.user

  return jsonOk({
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
    },
    sessionKind: user.sessionKind,
    isPhoneVerified: user.isPhoneVerified,
    isEmailVerified: user.isEmailVerified,
    isFullyVerified: user.isFullyVerified,
    requiresPhoneVerification: !user.isPhoneVerified,
    requiresEmailVerification: !user.isEmailVerified,
    nextUrl: getDefaultNextUrl(user.role),
  })
}