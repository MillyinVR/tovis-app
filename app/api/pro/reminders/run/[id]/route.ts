import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

type Params = {
  params: Promise<{ id: string }>
}

export async function PATCH(req: Request, props: Params) {
  const { id } = await props.params
  const user = await getCurrentUser()

  if (!user || user.role !== 'PRO' || !user.professionalProfile) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db: any = prisma
  const body = await req.json().catch(() => ({}))
  const { completed } = body as { completed?: boolean }

  if (typeof completed !== 'boolean') {
    return NextResponse.json(
      { error: 'completed:boolean is required' },
      { status: 400 },
    )
  }

  // ensure reminder belongs to this pro
  const existing = await db.reminder.findUnique({
    where: { id },
    select: { professionalId: true },
  })

  if (!existing || existing.professionalId !== user.professionalProfile.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const updated = await db.reminder.update({
    where: { id },
    data: {
      completedAt: completed ? new Date() : null,
    },
  })

  return NextResponse.json({
    id: updated.id,
    completedAt: updated.completedAt?.toISOString() ?? null,
  })
}
