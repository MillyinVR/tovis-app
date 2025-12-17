import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

type Body = {
  notes?: unknown
  rebookedFor?: unknown
  createRebookReminder?: unknown
  rebookReminderDaysBefore?: unknown
  createProductReminder?: unknown
  productReminderDaysAfter?: unknown
}

const NOTES_MAX = 4000

function toBool(x: unknown): boolean {
  return x === true || x === 'true' || x === 1 || x === '1'
}

function toInt(x: unknown, fallback: number): number {
  const n =
    typeof x === 'number'
      ? x
      : typeof x === 'string'
        ? parseInt(x.trim(), 10)
        : NaN
  return Number.isFinite(n) ? n : fallback
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function parseOptionalISODate(x: unknown): Date | null | 'invalid' {
  if (x === null || x === undefined || x === '') return null
  if (typeof x !== 'string') return 'invalid'
  const d = new Date(x)
  if (Number.isNaN(d.getTime())) return 'invalid'
  return d
}

function makeDedupeKey(bookingId: string, type: 'REBOOK' | 'PRODUCT_FOLLOWUP') {
  return `aftercare:${bookingId}:${type}`
}

export async function POST(
  request: Request,
  props: { params: Promise<{ id: string }> },
) {
  try {
    const { id: bookingId } = await props.params
    if (!bookingId) {
      return NextResponse.json({ error: 'Missing booking id.' }, { status: 400 })
    }

    const user = await getCurrentUser()
    if (!user || user.role !== 'PRO' || !user.professionalProfile) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 401 })
    }

    const body = (await request.json().catch(() => ({}))) as Body

    const notes =
      typeof body.notes === 'string'
        ? body.notes.trim().slice(0, NOTES_MAX)
        : ''

    const rebookedForParsed = parseOptionalISODate(body.rebookedFor)
    if (rebookedForParsed === 'invalid') {
      return NextResponse.json({ error: 'Invalid rebook date.' }, { status: 400 })
    }

    const createRebookReminder = toBool(body.createRebookReminder)
    const createProductReminder = toBool(body.createProductReminder)

    const rebookReminderDaysBefore = clamp(toInt(body.rebookReminderDaysBefore, 2), 1, 30)
    const productReminderDaysAfter = clamp(toInt(body.productReminderDaysAfter, 7), 1, 180)

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: { client: true, service: true },
    })

    if (!booking) {
      return NextResponse.json({ error: 'Booking not found.' }, { status: 404 })
    }

    if (booking.professionalId !== user.professionalProfile.id) {
      return NextResponse.json(
        { error: 'You can only edit aftercare for your own bookings.' },
        { status: 403 },
      )
    }

    if (booking.status !== 'COMPLETED') {
      return NextResponse.json(
        { error: 'Booking must be COMPLETED before adding aftercare.' },
        { status: 400 },
      )
    }

    const rebookedFor = rebookedForParsed // Date | null

    const result = await prisma.$transaction(async (tx) => {
      // 1) Upsert aftercare
      const aftercare = await tx.aftercareSummary.upsert({
        where: { bookingId: booking.id },
        create: { bookingId: booking.id, notes: notes || null, rebookedFor },
        update: { notes: notes || null, rebookedFor },
      })

      let remindersTouched = 0

      // 2) REBOOK reminder: upsert if enabled, otherwise delete open one
      const rebookKey = makeDedupeKey(booking.id, 'REBOOK')

      if (rebookedFor && createRebookReminder) {
        const due = new Date(rebookedFor)
        due.setDate(due.getDate() - rebookReminderDaysBefore)
        const safeDueAt = Number.isNaN(due.getTime()) ? rebookedFor : due

        const up = await tx.reminder.upsert({
          where: { dedupeKey: rebookKey },
          create: {
            dedupeKey: rebookKey,
            professionalId: booking.professionalId,
            clientId: booking.clientId,
            bookingId: booking.id,
            type: 'REBOOK',
            title: `Rebook: ${booking.client.firstName} ${booking.client.lastName}`.trim(),
            body: `Target date: ${rebookedFor.toISOString()}`,
            dueAt: safeDueAt,
          },
          update: {
            professionalId: booking.professionalId,
            clientId: booking.clientId,
            bookingId: booking.id,
            type: 'REBOOK',
            title: `Rebook: ${booking.client.firstName} ${booking.client.lastName}`.trim(),
            body: `Target date: ${rebookedFor.toISOString()}`,
            dueAt: safeDueAt,
            // intentionally do NOT touch completedAt
          },
        })

        if (up) remindersTouched++
      } else {
        const del = await tx.reminder.deleteMany({
          where: { dedupeKey: rebookKey, completedAt: null },
        })
        if (del.count) remindersTouched += del.count
      }

      // 3) PRODUCT_FOLLOWUP reminder: same pattern
      const productKey = makeDedupeKey(booking.id, 'PRODUCT_FOLLOWUP')

      if (createProductReminder) {
        const due = new Date(booking.scheduledFor)
        due.setDate(due.getDate() + productReminderDaysAfter)

        if (!Number.isNaN(due.getTime())) {
          const up = await tx.reminder.upsert({
            where: { dedupeKey: productKey },
            create: {
              dedupeKey: productKey,
              professionalId: booking.professionalId,
              clientId: booking.clientId,
              bookingId: booking.id,
              type: 'PRODUCT_FOLLOWUP',
              title: `Product follow-up: ${booking.client.firstName} ${booking.client.lastName}`.trim(),
              body: `Check in after ${booking.service.name}.`,
              dueAt: due,
            },
            update: {
              professionalId: booking.professionalId,
              clientId: booking.clientId,
              bookingId: booking.id,
              type: 'PRODUCT_FOLLOWUP',
              title: `Product follow-up: ${booking.client.firstName} ${booking.client.lastName}`.trim(),
              body: `Check in after ${booking.service.name}.`,
              dueAt: due,
              // intentionally do NOT touch completedAt
            },
          })

          if (up) remindersTouched++
        }
      } else {
        const del = await tx.reminder.deleteMany({
          where: { dedupeKey: productKey, completedAt: null },
        })
        if (del.count) remindersTouched += del.count
      }

      return { aftercareId: aftercare.id, remindersTouched }
    })

    return NextResponse.json(
      { ok: true, aftercareId: result.aftercareId, remindersTouched: result.remindersTouched },
      { status: 200 },
    )
  } catch (error) {
    console.error('Aftercare save error', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
