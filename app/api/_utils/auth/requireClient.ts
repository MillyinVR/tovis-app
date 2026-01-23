// app/api/_utils/auth/requireClient.ts
import { NextResponse } from 'next/server'
import type { Role } from '@prisma/client'
import { requireUser } from './requireUser'

type RequireClientOk = {
  user: NonNullable<Awaited<ReturnType<typeof requireUser>>['user']>
  clientId: string
  res: null
}

type RequireClientFail = {
  user: null
  clientId: null
  res: NextResponse
}

export async function requireClient(): Promise<RequireClientOk | RequireClientFail> {
  const { user, res } = await requireUser({ roles: ['CLIENT'] as Role[] })

  if (res || !user) {
    return {
      user: null,
      clientId: null,
      res: res ?? NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401 }),
    }
  }

  const clientId = user.clientProfile?.id ?? null
  if (!clientId) {
    return {
      user: null,
      clientId: null,
      res: NextResponse.json({ ok: false, error: 'Only clients can perform this action.' }, { status: 403 }),
    }
  }

  return { user, clientId, res: null }
}
