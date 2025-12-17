// app/api/pro/profile/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

export async function PATCH(req: Request) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'PRO' || !user.professionalProfile) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))

    const businessName =
      typeof body.businessName === 'string' ? body.businessName.trim() : undefined
    const bio = typeof body.bio === 'string' ? body.bio.trim() : undefined
    const location =
      typeof body.location === 'string' ? body.location.trim() : undefined
    const avatarUrl =
      typeof body.avatarUrl === 'string' ? body.avatarUrl.trim() : undefined

    const professionType =
      typeof body.professionType === 'string' ? body.professionType : undefined

    const updated = await prisma.professionalProfile.update({
      where: { id: user.professionalProfile.id },
      data: {
        ...(businessName !== undefined ? { businessName } : {}),
        ...(bio !== undefined ? { bio } : {}),
        ...(location !== undefined ? { location } : {}),
        ...(avatarUrl !== undefined ? { avatarUrl } : {}),
        ...(professionType !== undefined ? { professionType: professionType as any } : {}),
      },
      select: {
        id: true,
        businessName: true,
        bio: true,
        location: true,
        avatarUrl: true,
        professionType: true,
      },
    })

    return NextResponse.json({ ok: true, profile: updated }, { status: 200 })
  } catch (e) {
    console.error('PATCH /api/pro/profile error', e)
    return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 })
  }
}
