// app/api/_utils/auth/requireUser.ts
import { Role } from '@prisma/client'

import { jsonFail } from '@/app/api/_utils'
import { getCurrentUser } from '@/lib/currentUser'

type RequireUserOptions = {
  roles?: readonly Role[]
  allowVerificationSession?: boolean
}

type CurrentUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>

export type RequireUserOk = {
  ok: true
  user: CurrentUser
}

export type RequireUserFail = {
  ok: false
  res: Response
}

export type RequireUserResult = RequireUserOk | RequireUserFail

function buildVerificationRequiredResponse(): Response {
  return jsonFail(403, 'Account verification is required.', {
    code: 'VERIFICATION_REQUIRED',
  })
}

export async function requireUser(
  opts: RequireUserOptions = {},
): Promise<RequireUserResult> {
  let user: Awaited<ReturnType<typeof getCurrentUser>>

  try {
    user = await getCurrentUser()
  } catch (err: unknown) {
    console.error('requireUser: getCurrentUser failed', err)
    return { ok: false, res: jsonFail(500, 'Internal server error') }
  }

  if (!user) {
    return { ok: false, res: jsonFail(401, 'Unauthorized') }
  }

  const roles = opts.roles?.length ? opts.roles : null
  if (roles && !roles.includes(user.role)) {
    return { ok: false, res: jsonFail(403, 'Forbidden') }
  }

  const allowVerificationSession = opts.allowVerificationSession ?? false

  if (!allowVerificationSession) {
    if (user.sessionKind !== 'ACTIVE') {
      return { ok: false, res: buildVerificationRequiredResponse() }
    }

    if (!user.isFullyVerified) {
      return { ok: false, res: buildVerificationRequiredResponse() }
    }
  }

  return { ok: true, user }
}