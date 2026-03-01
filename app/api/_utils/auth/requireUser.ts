// app/api/_utils/auth/requireUser.ts
import { getCurrentUser } from '@/lib/currentUser'
import { jsonFail } from '@/app/api/_utils'
import { Role } from '@prisma/client'

type RequireUserOptions = {
  roles?: readonly Role[] // allowed roles; if omitted, any logged-in user is allowed
}

export type RequireUserOk = {
  ok: true
  user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>
}

export type RequireUserFail = {
  ok: false
  res: Response
}

export type RequireUserResult = RequireUserOk | RequireUserFail

export async function requireUser(opts: RequireUserOptions = {}): Promise<RequireUserResult> {
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

  return { ok: true, user }
}