// app/api/_utils/auth/requireAdmin.ts
import { Role } from '@prisma/client'

import { getCurrentUser } from '@/lib/currentUser'

import { requireUser } from './requireUser'

type CurrentUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>

export type RequireAdminOk = {
  ok: true
  user: CurrentUser
  userId: string
}

export type RequireAdminFail = {
  ok: false
  res: Response
}

export type RequireAdminResult = RequireAdminOk | RequireAdminFail

export async function requireAdmin(): Promise<RequireAdminResult> {
  const auth = await requireUser({ roles: [Role.ADMIN] })
  if (!auth.ok) return auth

  return {
    ok: true,
    user: auth.user,
    userId: auth.user.id,
  }
}