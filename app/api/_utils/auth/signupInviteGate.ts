import { jsonFail } from '@/app/api/_utils/responses'
import {
  signupInviteFailureMessage,
  type SignupInviteFailureReason,
  validateSignupInviteCode,
} from '@/lib/auth/signupInvite'

export function signupInviteFailureResponse(
  reason: SignupInviteFailureReason,
): Response {
  return jsonFail(400, signupInviteFailureMessage(reason), {
    code:
      reason === 'missing'
        ? 'SIGNUP_INVITE_REQUIRED'
        : 'SIGNUP_INVITE_INVALID',
    reason,
  })
}

export async function requireValidSignupInviteCode(
  rawCode: string | null,
): Promise<Response | null> {
  const result = await validateSignupInviteCode({ rawCode })
  return result.ok ? null : signupInviteFailureResponse(result.reason)
}
