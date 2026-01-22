// app/api/_utils/requireUser.ts
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/currentUser'
import type { Role } from '@prisma/client'

type RequireUserOptions = {
  roles?: Role[] // allowed roles; if omitted, any logged-in user is allowed
}

export async function requireUser(opts: RequireUserOptions = {}) {
  const user = await getCurrentUser().catch(() => null)

  if (!user) {
    return {
      user: null as any,
      res: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    }
  }

  const roles = opts.roles?.length ? opts.roles : null
  if (roles && !roles.includes(user.role as Role)) {
    return {
      user: null as any,
      res: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    }
  }

  return { user, res: null as any }
}
