// app/api/pro/reminders/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

export async function GET() {
  const user = await getCurrentUser()

  if (!user || user.role !== 'PRO' || !user.professionalProfile) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db: any = prisma

  const reminders = await db.reminder.findMany({
    where: {
      professionalId: user.professionalProfile.id,
    },
    include: {
      client: true,
      booking: {
        include: {
          service: true,
        },
      },
    },
    orderBy: {
      dueAt: 'asc',
    },
  })

  return NextResponse.json({ reminders })
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser()

  if (!user || user.role !== 'PRO' || !user.professionalProfile) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db: any = prisma

  const form = await req.formData()

  const title = String(form.get('title') || '').trim()
  const bodyRaw = form.get('body')
  const body =
    bodyRaw == null || String(bodyRaw).trim() === ''
      ? null
      : String(bodyRaw).trim()

  const dueAtRaw = form.get('dueAt')
  const clientIdRaw = form.get('clientId')
  const bookingIdRaw = form.get('bookingId')
  const typeRaw = form.get('type')

  if (!title) {
    return NextResponse.json({ error: 'Title is required.' }, { status: 400 })
  }

  if (!dueAtRaw || typeof dueAtRaw !== 'string') {
    return NextResponse.json({ error: 'Due date/time is required.' }, { status: 400 })
  }

  const dueAt = new Date(dueAtRaw)
  if (Number.isNaN(dueAt.getTime())) {
    return NextResponse.json({ error: 'Invalid due date/time.' }, { status: 400 })
  }

  const clientId =
    clientIdRaw && typeof clientIdRaw === 'string' && clientIdRaw !== ''
      ? clientIdRaw
      : null

  const bookingId =
    bookingIdRaw && typeof bookingIdRaw === 'string' && bookingIdRaw !== ''
      ? bookingIdRaw
      : null

  const type =
    typeRaw && typeof typeRaw === 'string' && typeRaw !== ''
      ? (typeRaw as any)
      : 'GENERAL'

  await db.reminder.create({
    data: {
      professionalId: user.professionalProfile.id,
      clientId,
      bookingId,
      title,
      body,
      dueAt,
      type,
    },
  })

  // redirect back to reminders page so regular HTML form submits "just work"
  return NextResponse.redirect(new URL('/pro/reminders', req.url))
}
