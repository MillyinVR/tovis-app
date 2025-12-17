import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params

  const user = await getCurrentUser()
  if (!user || user.role !== 'PRO' || !user.professionalProfile) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { alertBanner?: string | null }

  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const alertBanner =
    body.alertBanner && body.alertBanner.trim() !== ''
      ? body.alertBanner.trim()
      : null

  try {
    const updated = await prisma.clientProfile.update({
      where: { id },
      data: { alertBanner },
      select: {
        id: true,
        alertBanner: true,
      },
    })

    return NextResponse.json(updated)
  } catch (err) {
    console.error('Error updating client alertBanner', err)
    return NextResponse.json(
      { error: 'Failed to update client alert' },
      { status: 500 }
    )
  }
}
