// app/api/pro/reminders/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const professionalId = auth.professionalId

    const reminders = await prisma.reminder.findMany({
      where: { professionalId },
      include: {
        client: true,
        booking: { include: { service: true } },
      },
      orderBy: { dueAt: 'asc' },
      take: 500,
    })

    return jsonOk({ reminders }, 200)
  } catch (e) {
    console.error('GET /api/pro/reminders error', e)
    return jsonFail(500, 'Internal server error')
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const professionalId = auth.professionalId

    const form = await req.formData()

    const title = String(form.get('title') || '').trim()
    if (!title) return jsonFail(400, 'Title is required.')

    const bodyRaw = form.get('body')
    const body = bodyRaw == null || String(bodyRaw).trim() === '' ? null : String(bodyRaw).trim()

    const dueAtRaw = form.get('dueAt')
    if (!dueAtRaw || typeof dueAtRaw !== 'string') {
      return jsonFail(400, 'Due date/time is required.')
    }

    const dueAt = new Date(dueAtRaw)
    if (!Number.isFinite(dueAt.getTime())) {
      return jsonFail(400, 'Invalid due date/time.')
    }

    const clientIdRaw = form.get('clientId')
    const bookingIdRaw = form.get('bookingId')
    const typeRaw = form.get('type')

    const clientId =
      clientIdRaw && typeof clientIdRaw === 'string' && clientIdRaw.trim() ? clientIdRaw.trim() : null

    const bookingId =
      bookingIdRaw && typeof bookingIdRaw === 'string' && bookingIdRaw.trim() ? bookingIdRaw.trim() : null

    const type =
      typeRaw && typeof typeRaw === 'string' && typeRaw.trim() ? (typeRaw.trim() as any) : 'GENERAL'

    await prisma.reminder.create({
      data: {
        professionalId,
        clientId,
        bookingId,
        title,
        body,
        dueAt,
        type,
      } as any,
    })

    // keep HTML form flow
    return NextResponse.redirect(new URL('/pro/reminders', req.url))
  } catch (e) {
    console.error('POST /api/pro/reminders error', e)
    return jsonFail(500, 'Internal server error')
  }
}
