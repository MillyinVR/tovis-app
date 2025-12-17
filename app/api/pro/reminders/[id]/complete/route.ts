import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

type Ctx = { params: { id: string } | Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await Promise.resolve(params)

    const user = await getCurrentUser()
    if (!user || user.role !== 'PRO' || !user.professionalProfile) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const reminder = await prisma.reminder.findUnique({ where: { id } })

    if (!reminder || reminder.professionalId !== user.professionalProfile.id) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    await prisma.reminder.update({
      where: { id },
      data: { completedAt: new Date() },
    })

    return NextResponse.redirect(new URL('/pro/reminders', req.url))
  } catch (e) {
    console.error('POST /api/pro/reminders/[id]/complete error', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
