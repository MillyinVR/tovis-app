// app/api/_utils/auth/requirePro.ts
import { NextResponse } from 'next/server'
import type { Role } from '@prisma/client'
import { requireUser } from './requireUser'

export async function requirePro() {
  const { user, res } = await requireUser({ roles: ['PRO'] as Role[] })
  if (res) {
    return {
      user: null as any,
      professionalId: null as any,
      proId: null as any,
      res,
    }
  }

  const professionalId = user.professionalProfile?.id ?? null
  if (!professionalId) {
    return {
      user: null as any,
      professionalId: null as any,
      proId: null as any,
      res: NextResponse.json({ error: 'Only professionals can perform this action.' }, { status: 403 }),
    }
  }

  return {
    user,
    professionalId,
    proId: professionalId, // ✅ alias for cleaner calling code
    res: null as any,
  }
}
