// app/api/_utils/auth/requirePro.ts
import { NextResponse } from 'next/server'
import { requireUser } from './requireUser'
import { getCurrentUser } from '@/lib/currentUser'
import { Role } from '@prisma/client'

type CurrentUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>

export type RequireProOk = {
  ok: true
  user: CurrentUser
  professionalId: string
  proId: string // alias
}

export type RequireProFail = {
  ok: false
  res: NextResponse
}

export type RequireProResult = RequireProOk | RequireProFail

export async function requirePro(): Promise<RequireProResult> {
  const auth = await requireUser({ roles: [Role.PRO] })
  if (!auth.ok) return auth

  const professionalId = auth.user.professionalProfile?.id
  if (!professionalId) {
    return {
      ok: false,
      res: NextResponse.json({ ok: false, error: 'Only professionals can perform this action.' }, { status: 403 }),
    }
  }

  return {
    ok: true,
    user: auth.user,
    professionalId,
    proId: professionalId,
  }
}