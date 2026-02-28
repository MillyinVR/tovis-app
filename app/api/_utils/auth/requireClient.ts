// app/api/_utils/auth/requireClient.ts
import { NextResponse } from 'next/server'
import { requireUser } from './requireUser'
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
  res: NextResponse
}

export type RequireClientResult = RequireClientOk | RequireClientFail

export async function requireClient(): Promise<RequireClientResult> {
  const auth = await requireUser({ roles: [Role.CLIENT] })
  if (!auth.ok) return auth

  const clientId = auth.user.clientProfile?.id
  if (!clientId) {
    return {
      ok: false,
      res: NextResponse.json({ ok: false, error: 'Only clients can perform this action.' }, { status: 403 }),
    }
  }

  return { ok: true, user: auth.user, clientId }
}