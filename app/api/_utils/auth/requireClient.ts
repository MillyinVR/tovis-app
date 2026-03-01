// app/api/_utils/auth/requireClient.ts
import { requireUser } from './requireUser'
import { jsonFail } from '@/app/api/_utils'
import { getCurrentUser } from '@/lib/currentUser'
import { Role } from '@prisma/client'

type CurrentUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>

export type RequireClientOk = {
  ok: true
  user: CurrentUser
  clientId: string
}

export type RequireClientFail = {
  ok: false
  res: Response
}

export type RequireClientResult = RequireClientOk | RequireClientFail

export async function requireClient(): Promise<RequireClientResult> {
  const auth = await requireUser({ roles: [Role.CLIENT] })
  if (!auth.ok) return auth // Response-based fail shape stays consistent

  const clientId = auth.user.clientProfile?.id
  if (!clientId) {
    // Authenticated but missing a client profile -> forbidden
    return { ok: false, res: jsonFail(403, 'Only clients can perform this action.') }
  }

  return { ok: true, user: auth.user, clientId }
}