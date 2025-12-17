// app/api/pro/working-hours/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

export async function GET() {
  const user = await getCurrentUser()

  if (!user || user.role !== 'PRO' || !user.professionalProfile) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db: any = prisma

  const pro = await db.professionalProfile.findUnique({
    where: { id: user.professionalProfile.id },
    select: { workingHours: true },
  })

  return NextResponse.json({
    workingHours: pro?.workingHours ?? null,
  })
}

export async function POST(request: Request) {
  const user = await getCurrentUser()

  if (!user || user.role !== 'PRO' || !user.professionalProfile) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const { workingHours } = body as { workingHours?: unknown }

  if (!workingHours || typeof workingHours !== 'object') {
    return NextResponse.json(
      { error: 'workingHours must be an object' },
      { status: 400 },
    )
  }

  const db: any = prisma

  await db.professionalProfile.update({
    where: { id: user.professionalProfile.id },
    data: {
      // store as raw JSON
      workingHours,
    },
  })

  return NextResponse.json({ ok: true })
}
