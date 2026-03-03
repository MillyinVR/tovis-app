// app/api/pro/reminders/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import { ReminderType } from '@prisma/client'
import { assertProCanViewClient } from '@/lib/clientVisibility'

export const dynamic = 'force-dynamic'

function formString(form: FormData, key: string): string | null {
  const v = form.get(key)
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s ? s : null
}

function parseReminderType(raw: string | null): ReminderType {
  if (!raw) return ReminderType.GENERAL
  const upper = raw.trim().toUpperCase()
  if ((Object.values(ReminderType) as string[]).includes(upper)) {
    return upper as ReminderType
  }
  return ReminderType.GENERAL
}

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

export async function POST(req: Request) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const professionalId = auth.professionalId

    const form = await req.formData()

    const title = formString(form, 'title')
    if (!title) return jsonFail(400, 'Title is required.')

    const body = formString(form, 'body') // null allowed

    const dueAtRaw = formString(form, 'dueAt')
    if (!dueAtRaw) return jsonFail(400, 'Due date/time is required.')

    const dueAt = new Date(dueAtRaw)
    if (!Number.isFinite(dueAt.getTime())) {
      return jsonFail(400, 'Invalid due date/time.')
    }

    const clientId = formString(form, 'clientId')
    const bookingId = formString(form, 'bookingId')
    const type = parseReminderType(formString(form, 'type'))

    // ✅ single source of truth visibility gate (client scope)
    if (clientId) {
      const gate = await assertProCanViewClient(professionalId, clientId)
      if (!gate.ok) return jsonFail(403, 'Forbidden.')
    }

    // ✅ prevent attaching reminders to someone else’s booking
    if (bookingId) {
      const b = await prisma.booking.findFirst({
        where: { id: bookingId, professionalId },
        select: { id: true, clientId: true },
      })
      if (!b) return jsonFail(404, 'Booking not found.')

      // Optional consistency check: if both provided, they must match
      if (clientId && b.clientId !== clientId) {
        return jsonFail(400, 'Booking does not belong to that client.')
      }
    }

    const created = await prisma.reminder.create({
      data: {
        professionalId,
        clientId,
        bookingId,
        title,
        body,
        dueAt,
        type,
      },
      select: { id: true },
    })

    // Keep HTML form flow (browser form POST -> redirect)
    const accept = req.headers.get('accept') || ''
    if (accept.includes('text/html')) {
      return Response.redirect(new URL('/pro/reminders', req.url), 303)
    }

    // API/fetch flow
    return jsonOk({ id: created.id }, 201)
  } catch (e) {
    console.error('POST /api/pro/reminders error', e)
    return jsonFail(500, 'Internal server error')
  }
}