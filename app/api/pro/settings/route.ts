// app/api/pro/settings/route.ts

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

export const dynamic = 'force-dynamic'

function pickBoolean(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null
}

function isProRole(role: unknown) {
  const r = typeof role === 'string' ? role.toUpperCase() : ''
  return r === 'PROFESSIONAL' || r === 'PRO'
}

export async function PATCH(req: Request) {
  try {
    const user = await getCurrentUser().catch(() => null)

    if (!user || !isProRole((user as any).role) || !(user as any).professionalProfile?.id) {
      return NextResponse.json(
        {
          error: 'Only professionals can update settings.',
          debug: {
            hasUser: Boolean(user),
            role: (user as any)?.role ?? null,
            hasProfessionalProfile: Boolean((user as any)?.professionalProfile?.id),
          },
        },
        { status: 401 },
      )
    }

    const body = await req.json().catch(() => ({} as any))
    const autoAcceptBookings = pickBoolean(body?.autoAcceptBookings)

    if (autoAcceptBookings === null) {
      return NextResponse.json(
        { error: 'Missing or invalid autoAcceptBookings (boolean).' },
        { status: 400 },
      )
    }

    const professionalProfile = await prisma.professionalProfile.update({
      where: { id: (user as any).professionalProfile.id },
      data: { autoAcceptBookings },
      select: { id: true, autoAcceptBookings: true },
    })

    return NextResponse.json({ ok: true, professionalProfile }, { status: 200 })
  } catch (e) {
    console.error('PATCH /api/pro/settings error:', e)
    return NextResponse.json({ error: 'Failed to update settings.' }, { status: 500 })
  }
}
