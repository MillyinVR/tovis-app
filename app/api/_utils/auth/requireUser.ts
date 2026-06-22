// app/api/_utils/auth/requireUser.ts
import { Role } from '@prisma/client'

import { jsonFail } from '@/app/api/_utils'
import { canActAs } from '@/lib/auth/workspaces'
import { getCurrentUser } from '@/lib/currentUser'
import { captureAuthException } from '@/lib/observability/authEvents'

/**
 * Build the 403 for a role-gated route the current acting role can't reach.
 *
 * If the user is *entitled* to one of the allowed workspaces (e.g. a pro who is
 * acting as PRO hitting a client-only route — they could simply switch into
 * CLIENT), we tag the response with a stable `WORKSPACE_MISMATCH` code plus the
 * workspace they should switch into. The client interprets this to offer a
 * one-tap "switch workspace" prompt. For a genuine denial (the user cannot act
 * in one of the allowed roles) we return a plain Forbidden — no misleading prompt.
 */
function buildRoleMismatchResponse(
  user: CurrentUser,
  roles: readonly Role[],
): Response {
  const capability = {
    homeRole: user.homeRole,
    clientProfile: user.clientProfile,
    professionalProfile: user.professionalProfile,
  }

  const switchableTarget = roles.find((role) => canActAs(capability, role))

  if (switchableTarget) {
    return jsonFail(403, 'Forbidden', {
      code: 'WORKSPACE_MISMATCH',
      requiredWorkspace: switchableTarget,
    })
  }

  return jsonFail(403, 'Forbidden')
}

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
    captureAuthException({
      event: 'auth.require_user.current_user_failed',
      route: 'auth.requireUser',
      code: 'INTERNAL',
      error: err,
    })
    return { ok: false, res: jsonFail(500, 'Internal server error') }
  }

  if (!user) {
    return { ok: false, res: jsonFail(401, 'Unauthorized') }
  }

  const roles = opts.roles?.length ? opts.roles : null
  if (roles && !roles.includes(user.role)) {
    return { ok: false, res: buildRoleMismatchResponse(user, roles) }
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