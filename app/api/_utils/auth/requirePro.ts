import { requireUser } from './requireUser'
import { jsonFail } from '@/app/api/_utils'
import { getCurrentUser } from '@/lib/currentUser'
import { Role } from '@prisma/client'

type CurrentUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>

export type RequireProOk = {
  ok: true
  user: CurrentUser
  userId: string
  professionalId: string
  proId: string
}

export type RequireProFail = {
  ok: false
  res: Response
}

export type RequireProResult = RequireProOk | RequireProFail

export async function requirePro(): Promise<RequireProResult> {
  const auth = await requireUser({ roles: [Role.PRO] })
  if (!auth.ok) return auth

  const professionalId = auth.user.professionalProfile?.id
  if (!professionalId) {
    return {
      ok: false,
      res: jsonFail(403, 'Only professionals can perform this action.'),
    }
  }

  return {
    ok: true,
    user: auth.user,
    userId: auth.user.id,
    professionalId,
    proId: professionalId,
  }
}