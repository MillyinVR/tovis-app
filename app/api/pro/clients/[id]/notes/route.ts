import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id: clientId } = await context.params
  const user = await getCurrentUser()

  if (!user || user.role !== 'PRO' || !user.professionalProfile) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { title, body } = await req.json()

  if (!body || !body.trim()) {
    return NextResponse.json(
      { error: 'Note body is required.' },
      { status: 400 },
    )
  }

  const db: any = prisma

  await db.clientProfessionalNote.create({
    data: {
      clientId,
      professionalId: user.professionalProfile.id,
      title: title?.trim() || null,
      body: body.trim(),
      visibility: 'PROFESSIONALS_ONLY',
    },
  })

  return NextResponse.json({ ok: true })
}
