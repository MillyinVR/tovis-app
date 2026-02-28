// app/api/_utils/auth/requireUser.ts
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/currentUser'
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
  res: NextResponse
}

export type RequireUserResult = RequireUserOk | RequireUserFail

export async function requireUser(opts: RequireUserOptions = {}): Promise<RequireUserResult> {
  const user = await getCurrentUser().catch(() => null)

  if (!user) {
    return {
      ok: false,
      res: NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 }),
    }
  }

  const roles = opts.roles?.length ? opts.roles : null
  if (roles && !roles.includes(user.role)) {
    return {
      ok: false,
      res: NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 }),
    }
  }

  return { ok: true, user }
}