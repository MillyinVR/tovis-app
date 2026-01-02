// app/api/holds/[id]/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } | Promise<{ id: string }> }

export async function DELETE(_req: Request, { params }: Ctx) {
  const user = await getCurrentUser().catch(() => null)
  if (!user || user.role !== 'CLIENT' || !user.clientProfile?.id) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 401 })
  }

  const { id } = await Promise.resolve(params)
  const holdId = (id || '').trim()
  if (!holdId) return NextResponse.json({ error: 'Missing hold id' }, { status: 400 })

  const hold = await prisma.bookingHold.findUnique({
    where: { id: holdId },
    select: { id: true, clientId: true },
  })

  // Already deleted? Cool. Nothing to do. Stop screaming in the terminal.
  if (!hold) return new NextResponse(null, { status: 204 })

  // Must belong to this client
  if (hold.clientId !== user.clientProfile.id) {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}


  await prisma.bookingHold.delete({ where: { id: holdId } })
  return new NextResponse(null, { status: 204 })
}
