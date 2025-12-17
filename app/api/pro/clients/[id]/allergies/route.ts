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

  const { label, description, severity } = await req.json()

  if (!label || !label.trim()) {
    return NextResponse.json(
      { error: 'Label is required.' },
      { status: 400 },
    )
  }

  const db: any = prisma

  await db.clientAllergy.create({
    data: {
      clientId,
      label: label.trim(),
      description: description?.trim() || null,
      severity: severity || 'MODERATE',
      recordedByProfessionalId: user.professionalProfile.id,
    },
  })

  return NextResponse.json({ ok: true })
}
