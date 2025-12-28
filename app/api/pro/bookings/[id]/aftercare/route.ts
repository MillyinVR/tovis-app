// app/api/pro/bookings/[id]/aftercare/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'

type RebookMode = 'NONE' | 'BOOKED_NEXT_APPOINTMENT' | 'RECOMMENDED_WINDOW'

type Body = {
  notes?: unknown

  rebookMode?: unknown

  // BOOKED_NEXT_APPOINTMENT
  nextBookingId?: unknown
  rebookedFor?: unknown

  // RECOMMENDED_WINDOW
  rebookWindowStart?: unknown
  rebookWindowEnd?: unknown

  // Smart reminders (pro reminders)
  createRebookReminder?: unknown
  rebookReminderDaysBefore?: unknown
  createProductReminder?: unknown
  productReminderDaysAfter?: unknown

  // Option B: default false (aftercare does NOT auto-complete booking)
  completeBooking?: unknown
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

function pickString(x: unknown) {
  return typeof x === 'string' && x.trim() ? x.trim() : null
}

function parseOptionalISODate(x: unknown): Date | null | 'invalid' {
  if (x === null || x === undefined || x === '') return null
  if (typeof x !== 'string') return 'invalid'
  const d = new Date(x)
  if (Number.isNaN(d.getTime())) return 'invalid'
  return d
}

function isRebookMode(x: unknown): x is RebookMode {
  return x === 'NONE' || x === 'BOOKED_NEXT_APPOINTMENT' || x === 'RECOMMENDED_WINDOW'
}

function makeDedupeKey(bookingId: string, type: 'REBOOK' | 'PRODUCT_FOLLOWUP') {
  return `aftercare:${bookingId}:${type}`
}

// Client notification dedupe: 1 notification per booking’s aftercare summary
function makeClientNotifDedupeKey(bookingId: string) {
  return `client_aftercare:${bookingId}`
}

export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  try {
    const { id: bookingId } = await props.params
    if (!bookingId?.trim()) {
      return NextResponse.json({ error: 'Missing booking id.' }, { status: 400 })
    }

    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'PRO' || !user.professionalProfile?.id) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 401 })
    }

    const body = (await request.json().catch(() => ({}))) as Body

    const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, NOTES_MAX) : ''

    const modeRaw = body.rebookMode
    const rebookMode: RebookMode = isRebookMode(modeRaw) ? modeRaw : 'NONE'

    const nextBookingId = pickString(body.nextBookingId)

    const rebookedForParsed = parseOptionalISODate(body.rebookedFor)
    if (rebookedForParsed === 'invalid') {
      return NextResponse.json({ error: 'Invalid rebookedFor date.' }, { status: 400 })
    }

    const windowStartParsed = parseOptionalISODate(body.rebookWindowStart)
    if (windowStartParsed === 'invalid') {
      return NextResponse.json({ error: 'Invalid rebookWindowStart date.' }, { status: 400 })
    }

    const windowEndParsed = parseOptionalISODate(body.rebookWindowEnd)
    if (windowEndParsed === 'invalid') {
      return NextResponse.json({ error: 'Invalid rebookWindowEnd date.' }, { status: 400 })
    }

    const createRebookReminder = toBool(body.createRebookReminder)
    const createProductReminder = toBool(body.createProductReminder)

    const rebookReminderDaysBefore = clamp(toInt(body.rebookReminderDaysBefore, 2), 1, 30)
    const productReminderDaysAfter = clamp(toInt(body.productReminderDaysAfter, 7), 1, 180)

    // ✅ Option B default: do NOT auto-complete unless explicitly requested
    const completeBooking = body.completeBooking == null ? false : toBool(body.completeBooking)

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: { client: true, service: true, aftercareSummary: true },
    })

    if (!booking) return NextResponse.json({ error: 'Booking not found.' }, { status: 404 })
    if (booking.professionalId !== user.professionalProfile.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (booking.status === 'CANCELLED') {
      return NextResponse.json({ error: 'This booking is cancelled.' }, { status: 409 })
    }

    // Resolve booked-next-appointment date if provided
    let verifiedNextBooking: { id: string; scheduledFor: Date } | null = null
    if (nextBookingId) {
      const nb = await prisma.booking.findUnique({
        where: { id: nextBookingId },
        select: { id: true, clientId: true, professionalId: true, scheduledFor: true, status: true },
      })

      if (!nb) return NextResponse.json({ error: 'nextBookingId not found.' }, { status: 404 })
      if (nb.clientId !== booking.clientId || nb.professionalId !== booking.professionalId) {
        return NextResponse.json({ error: 'nextBookingId does not match this client/pro.' }, { status: 409 })
      }
      if (nb.status === 'CANCELLED') {
        return NextResponse.json({ error: 'nextBookingId is cancelled.' }, { status: 409 })
      }
      verifiedNextBooking = { id: nb.id, scheduledFor: nb.scheduledFor }
    }

    // Normalize aftercare rebook fields
    let rebookedFor: Date | null = null
    let rebookWindowStart: Date | null = null
    let rebookWindowEnd: Date | null = null
    let normalizedMode: RebookMode = rebookMode

    if (rebookMode === 'BOOKED_NEXT_APPOINTMENT') {
      rebookedFor = verifiedNextBooking?.scheduledFor ?? (rebookedForParsed as Date | null)
      if (!rebookedFor) {
        return NextResponse.json(
          { error: 'BOOKED_NEXT_APPOINTMENT requires nextBookingId or rebookedFor.' },
          { status: 400 },
        )
      }
      rebookWindowStart = null
      rebookWindowEnd = null
    }

    if (rebookMode === 'RECOMMENDED_WINDOW') {
      if (!windowStartParsed || !windowEndParsed) {
        return NextResponse.json(
          { error: 'RECOMMENDED_WINDOW requires rebookWindowStart and rebookWindowEnd.' },
          { status: 400 },
        )
      }
      if (windowEndParsed <= windowStartParsed) {
        return NextResponse.json({ error: 'rebookWindowEnd must be after rebookWindowStart.' }, { status: 400 })
      }
      rebookWindowStart = windowStartParsed
      rebookWindowEnd = windowEndParsed
      rebookedFor = null
    }

    if (rebookMode === 'NONE') {
      rebookedFor = null
      rebookWindowStart = null
      rebookWindowEnd = null
      normalizedMode = 'NONE'
    }

    // Reminder policy: only when a single date exists
    const allowRebookReminder = Boolean(rebookedFor)

    // Keep/ensure public token
    const publicToken = booking.aftercareSummary?.publicToken || crypto.randomUUID()

    const result = await prisma.$transaction(async (tx) => {
      const aftercare = await tx.aftercareSummary.upsert({
        where: { bookingId: booking.id },
        create: {
          bookingId: booking.id,
          publicToken,
          notes: notes || null,
          rebookMode: normalizedMode as any,
          rebookedFor,
          rebookWindowStart,
          rebookWindowEnd,
        } as any,
        update: {
          publicToken,
          notes: notes || null,
          rebookMode: normalizedMode as any,
          rebookedFor,
          rebookWindowStart,
          rebookWindowEnd,
        } as any,
        select: { id: true, publicToken: true },
      })

      /**
       * ✅ Policy A (for now): ALWAYS create/update a client notification when aftercare is saved.
       * Deduped per booking so we don’t spam.
       */
      const notifKey = makeClientNotifDedupeKey(booking.id)
      const title = `Aftercare: ${booking.service?.name ?? 'Your appointment'}`
      const bodyPreview = notes.trim() ? notes.trim().slice(0, 240) : null

      await tx.clientNotification.upsert({
        where: { dedupeKey: notifKey } as any,
        create: {
          dedupeKey: notifKey,
          clientId: booking.clientId,
          type: 'AFTERCARE',
          title,
          body: bodyPreview,
          bookingId: booking.id,
          aftercareId: aftercare.id,
          readAt: null,
        } as any,
        update: {
          type: 'AFTERCARE',
          title,
          body: bodyPreview,
          bookingId: booking.id,
          aftercareId: aftercare.id,
          // NOTE: we do NOT force readAt back to null on edits.
          // If you WANT edits to show “NEW” again, set readAt: null here.
        } as any,
      })

      // Option B: only complete booking if explicitly requested
      if (completeBooking) {
        await tx.booking.update({
          where: { id: booking.id },
          data: {
            status: 'COMPLETED',
            finishedAt: booking.finishedAt ?? new Date(),
            sessionStep: 'DONE',
          } as any,
        })
      }

      let remindersTouched = 0

      // REBOOK reminder (PRO reminder)
      const rebookKey = makeDedupeKey(booking.id, 'REBOOK')

      if (allowRebookReminder && createRebookReminder && rebookedFor) {
        const due = new Date(rebookedFor)
        due.setDate(due.getDate() - rebookReminderDaysBefore)
        const safeDueAt = Number.isNaN(due.getTime()) ? rebookedFor : due

        await tx.reminder.upsert({
          where: { dedupeKey: rebookKey },
          create: {
            dedupeKey: rebookKey,
            professionalId: booking.professionalId,
            clientId: booking.clientId,
            bookingId: booking.id,
            type: 'REBOOK',
            title: `Rebook: ${booking.client?.firstName ?? ''} ${booking.client?.lastName ?? ''}`.trim(),
            body: `Target date: ${rebookedFor.toISOString()}`,
            dueAt: safeDueAt,
          } as any,
          update: {
            professionalId: booking.professionalId,
            clientId: booking.clientId,
            bookingId: booking.id,
            type: 'REBOOK',
            title: `Rebook: ${booking.client?.firstName ?? ''} ${booking.client?.lastName ?? ''}`.trim(),
            body: `Target date: ${rebookedFor.toISOString()}`,
            dueAt: safeDueAt,
          } as any,
        })
        remindersTouched++
      } else {
        const del = await tx.reminder.deleteMany({ where: { dedupeKey: rebookKey, completedAt: null } as any })
        remindersTouched += del.count
      }

      // PRODUCT_FOLLOWUP reminder (PRO reminder)
      const productKey = makeDedupeKey(booking.id, 'PRODUCT_FOLLOWUP')

      if (createProductReminder) {
        const base = booking.finishedAt ?? booking.scheduledFor
        const due = new Date(base)
        due.setDate(due.getDate() + productReminderDaysAfter)

        if (!Number.isNaN(due.getTime())) {
          await tx.reminder.upsert({
            where: { dedupeKey: productKey },
            create: {
              dedupeKey: productKey,
              professionalId: booking.professionalId,
              clientId: booking.clientId,
              bookingId: booking.id,
              type: 'PRODUCT_FOLLOWUP',
              title: `Product follow-up: ${booking.client?.firstName ?? ''} ${booking.client?.lastName ?? ''}`.trim(),
              body: `Check in after ${booking.service?.name ?? 'service'}.`,
              dueAt: due,
            } as any,
            update: {
              professionalId: booking.professionalId,
              clientId: booking.clientId,
              bookingId: booking.id,
              type: 'PRODUCT_FOLLOWUP',
              title: `Product follow-up: ${booking.client?.firstName ?? ''} ${booking.client?.lastName ?? ''}`.trim(),
              body: `Check in after ${booking.service?.name ?? 'service'}.`,
              dueAt: due,
            } as any,
          })
          remindersTouched++
        }
      } else {
        const del = await tx.reminder.deleteMany({ where: { dedupeKey: productKey, completedAt: null } as any })
        remindersTouched += del.count
      }

      return { aftercareId: aftercare.id, publicToken: aftercare.publicToken, remindersTouched }
    })

    return NextResponse.json(
      {
        ok: true,
        aftercareId: result.aftercareId,
        publicToken: result.publicToken,
        remindersTouched: result.remindersTouched,
        rebookMode: normalizedMode,
        rebookedFor: rebookedFor ? rebookedFor.toISOString() : null,
        rebookWindowStart: rebookWindowStart ? rebookWindowStart.toISOString() : null,
        rebookWindowEnd: rebookWindowEnd ? rebookWindowEnd.toISOString() : null,
        nextBookingId: verifiedNextBooking?.id ?? null,
        completed: completeBooking,
      },
      { status: 200 },
    )
  } catch (e) {
    console.error('POST /api/pro/bookings/[id]/aftercare error', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
