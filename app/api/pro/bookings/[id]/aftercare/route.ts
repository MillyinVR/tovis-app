import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

export const dynamic = 'force-dynamic'

type RebookMode = 'NONE' | 'BOOKED_NEXT_APPOINTMENT' | 'RECOMMENDED_WINDOW'

type RecommendedProductIn = {
  id?: unknown
  name?: unknown
  url?: unknown
  note?: unknown
}

type Body = {
  notes?: unknown
  rebookMode?: unknown

  nextBookingId?: unknown
  rebookedFor?: unknown

  rebookWindowStart?: unknown
  rebookWindowEnd?: unknown

  createRebookReminder?: unknown
  rebookReminderDaysBefore?: unknown
  createProductReminder?: unknown
  productReminderDaysAfter?: unknown

  completeBooking?: unknown
  allowDraft?: unknown
  markClientNotifUnreadOnEdit?: unknown

  recommendedProducts?: unknown
}

const NOTES_MAX = 4000
const MAX_PRODUCTS = 10
const PRODUCT_NAME_MAX = 80
const PRODUCT_NOTE_MAX = 140
const PRODUCT_URL_MAX = 2048

function upper(v: unknown) {
  return typeof v === 'string' ? v.trim().toUpperCase() : ''
}
function toBool(x: unknown): boolean {
  return x === true || x === 'true' || x === 1 || x === '1'
}
function toInt(x: unknown, fallback: number): number {
  const n = typeof x === 'number' ? x : typeof x === 'string' ? parseInt(x.trim(), 10) : NaN
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
function isValidHttpUrl(raw: string) {
  const s = raw.trim()
  if (!s || s.length > PRODUCT_URL_MAX) return false
  try {
    const u = new URL(s)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

function normalizeRecommendedProducts(input: unknown) {
  if (input == null) return []

  if (!Array.isArray(input)) return { error: 'recommendedProducts must be an array.' as const }
  if (input.length > MAX_PRODUCTS) return { error: `recommendedProducts max is ${MAX_PRODUCTS}.` as const }

  const out: Array<{ id: string; name: string; url: string; note: string | null }> = []

  for (const row of input as RecommendedProductIn[]) {
    const id = typeof row?.id === 'string' && row.id.trim() ? row.id.trim() : crypto.randomUUID()
    const name = typeof row?.name === 'string' ? row.name.trim().slice(0, PRODUCT_NAME_MAX) : ''
    const url = typeof row?.url === 'string' ? row.url.trim().slice(0, PRODUCT_URL_MAX) : ''
    const noteRaw = typeof row?.note === 'string' ? row.note.trim() : ''
    const note = noteRaw ? noteRaw.slice(0, PRODUCT_NOTE_MAX) : null

    // ignore blank rows
    if (!name && !url && !note) continue

    if (!name) return { error: 'Each recommended product needs a name.' as const }
    if (!url) return { error: 'Each recommended product needs a link.' as const }
    if (!isValidHttpUrl(url)) return { error: 'Product link must be a valid http/https URL.' as const }

    out.push({ id, name, url, note })
  }

  return out
}

function makeReminderDedupeKey(bookingId: string, type: 'REBOOK' | 'PRODUCT_FOLLOWUP') {
  return `aftercare:${bookingId}:${type}`
}
function makeClientNotifDedupeKey(bookingId: string) {
  return `client_aftercare:${bookingId}`
}

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    const { id: bookingId } = await props.params
    if (!bookingId?.trim()) return NextResponse.json({ error: 'Missing booking id.' }, { status: 400 })

    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'PRO' || !user.professionalProfile?.id) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 401 })
    }

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        professionalId: true,
        status: true,
        sessionStep: true,
        scheduledFor: true,
        finishedAt: true,
        aftercareSummary: {
          select: {
            id: true,
            notes: true,
            rebookMode: true,
            rebookedFor: true,
            rebookWindowStart: true,
            rebookWindowEnd: true,
            publicToken: true,
            recommendations: {
              select: {
                id: true,
                note: true,
                productId: true,
                externalName: true,
                externalUrl: true,
                product: { select: { id: true, name: true, brand: true } },
              },
              orderBy: { id: 'asc' },
            },
          } as any,
        },
      },
    })

    if (!booking) return NextResponse.json({ error: 'Booking not found.' }, { status: 404 })
    if (booking.professionalId !== user.professionalProfile.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    return NextResponse.json({ ok: true, booking }, { status: 200 })
  } catch (e) {
    console.error('GET /api/pro/bookings/[id]/aftercare error', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    const { id: bookingId } = await props.params
    if (!bookingId?.trim()) return NextResponse.json({ error: 'Missing booking id.' }, { status: 400 })

    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'PRO' || !user.professionalProfile?.id) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 401 })
    }

    const body = (await request.json().catch(() => ({}))) as Body
    const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, NOTES_MAX) : ''

    const normalizedProducts = normalizeRecommendedProducts(body.recommendedProducts)
    if ((normalizedProducts as any)?.error) {
      return NextResponse.json({ error: (normalizedProducts as any).error }, { status: 400 })
    }

    const rebookMode: RebookMode = isRebookMode(body.rebookMode) ? (body.rebookMode as any) : 'NONE'
    const nextBookingId = pickString(body.nextBookingId)

    const rebookedForParsed = parseOptionalISODate(body.rebookedFor)
    if (rebookedForParsed === 'invalid') return NextResponse.json({ error: 'Invalid rebookedFor date.' }, { status: 400 })

    const windowStartParsed = parseOptionalISODate(body.rebookWindowStart)
    if (windowStartParsed === 'invalid') return NextResponse.json({ error: 'Invalid rebookWindowStart date.' }, { status: 400 })

    const windowEndParsed = parseOptionalISODate(body.rebookWindowEnd)
    if (windowEndParsed === 'invalid') return NextResponse.json({ error: 'Invalid rebookWindowEnd date.' }, { status: 400 })

    const createRebookReminder = toBool(body.createRebookReminder)
    const createProductReminder = toBool(body.createProductReminder)

    const rebookReminderDaysBefore = clamp(toInt(body.rebookReminderDaysBefore, 2), 1, 30)
    const productReminderDaysAfter = clamp(toInt(body.productReminderDaysAfter, 7), 1, 180)

    const allowDraft = toBool(body.allowDraft)
    const markClientNotifUnreadOnEdit = toBool(body.markClientNotifUnreadOnEdit)

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: { client: true, service: true, aftercareSummary: true },
    })

    if (!booking) return NextResponse.json({ error: 'Booking not found.' }, { status: 404 })
    if (booking.professionalId !== user.professionalProfile.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const bookingStatus = upper(booking.status)
    const step = upper((booking as any).sessionStep || 'NONE')

    if (bookingStatus === 'CANCELLED') return NextResponse.json({ error: 'This booking is cancelled.' }, { status: 409 })
    if (bookingStatus === 'PENDING') {
      return NextResponse.json({ error: 'Aftercare can’t be posted until the booking is confirmed.' }, { status: 409 })
    }

    const eligibleStep = step === 'DONE' || step === 'AFTER_PHOTOS'
    if (!eligibleStep && !allowDraft) {
      return NextResponse.json(
        { error: `Aftercare is locked until after-photos is complete. Current step: ${step || 'NONE'}.` },
        { status: 409 },
      )
    }

    const completeBooking = body.completeBooking == null ? step === 'DONE' : toBool(body.completeBooking)

    // Validate next booking if provided
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
      if (upper(nb.status) === 'CANCELLED') return NextResponse.json({ error: 'nextBookingId is cancelled.' }, { status: 409 })
      verifiedNextBooking = { id: nb.id, scheduledFor: nb.scheduledFor }
    }

    // Normalize rebook fields
    let rebookedFor: Date | null = null
    let rebookWindowStart: Date | null = null
    let rebookWindowEnd: Date | null = null
    let normalizedMode: RebookMode = rebookMode

    if (rebookMode === 'BOOKED_NEXT_APPOINTMENT') {
      rebookedFor = verifiedNextBooking?.scheduledFor ?? (rebookedForParsed as Date | null)
      if (!rebookedFor) {
        return NextResponse.json({ error: 'BOOKED_NEXT_APPOINTMENT requires nextBookingId or rebookedFor.' }, { status: 400 })
      }
    } else if (rebookMode === 'RECOMMENDED_WINDOW') {
      if (!windowStartParsed || !windowEndParsed) {
        return NextResponse.json({ error: 'RECOMMENDED_WINDOW requires rebookWindowStart and rebookWindowEnd.' }, { status: 400 })
      }
      if (windowEndParsed <= windowStartParsed) {
        return NextResponse.json({ error: 'rebookWindowEnd must be after rebookWindowStart.' }, { status: 400 })
      }
      rebookWindowStart = windowStartParsed
      rebookWindowEnd = windowEndParsed
      rebookedFor = null
    } else {
      normalizedMode = 'NONE'
    }

    const allowRebookReminder = Boolean(rebookedFor)

    const result = await prisma.$transaction(async (tx) => {
      const existingToken = booking.aftercareSummary?.publicToken ?? null

      const aftercare = await tx.aftercareSummary.upsert({
        where: { bookingId: booking.id },
        create: {
          bookingId: booking.id,
          ...(existingToken ? { publicToken: existingToken } : {}),
          notes: notes || null,
          rebookMode: normalizedMode as any,
          rebookedFor,
          rebookWindowStart,
          rebookWindowEnd,
        } as any,
        update: {
          notes: notes || null,
          rebookMode: normalizedMode as any,
          rebookedFor,
          rebookWindowStart,
          rebookWindowEnd,
        } as any,
        select: { id: true, publicToken: true, rebookMode: true, rebookedFor: true, rebookWindowStart: true, rebookWindowEnd: true },
      })

      // ✅ Replace recommendations with the submitted external list (simple + deterministic)
      // Long-term we can diff, but for now: deleteMany + createMany is clean and correct.
      await tx.productRecommendation.deleteMany({
        where: { aftercareSummaryId: aftercare.id },
      })

      if ((normalizedProducts as any[]).length) {
        await tx.productRecommendation.createMany({
          data: (normalizedProducts as any[]).map((p) => ({
            aftercareSummaryId: aftercare.id,
            productId: null,
            externalName: p.name,
            externalUrl: p.url,
            note: p.note,
          })),
        })
      }

      // Client notification (deduped per booking)
      const notifKey = makeClientNotifDedupeKey(booking.id)
      const title = `Aftercare: ${booking.service?.name ?? 'Your appointment'}`
      const bodyPreview = notes.trim() ? notes.trim().slice(0, 240) : null

      const existingNotif = await tx.clientNotification.findFirst({
        where: { dedupeKey: notifKey },
        select: { id: true },
      })

      if (!existingNotif) {
        await tx.clientNotification.create({
          data: {
            dedupeKey: notifKey,
            clientId: booking.clientId,
            type: 'AFTERCARE' as any,
            title,
            body: bodyPreview,
            bookingId: booking.id,
            aftercareId: aftercare.id,
            readAt: null,
          } as any,
        })
      } else {
        await tx.clientNotification.update({
          where: { id: existingNotif.id },
          data: {
            title,
            body: bodyPreview,
            bookingId: booking.id,
            aftercareId: aftercare.id,
            ...(markClientNotifUnreadOnEdit ? { readAt: null } : {}),
          } as any,
        })
      }

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

      const rebookKey = makeReminderDedupeKey(booking.id, 'REBOOK')
      if (allowRebookReminder && createRebookReminder && rebookedFor) {
        const due = new Date(rebookedFor)
        due.setDate(due.getDate() - rebookReminderDaysBefore)
        const safeDueAt = Number.isNaN(due.getTime()) ? rebookedFor : due

        await tx.reminder.upsert({
          where: { dedupeKey: rebookKey } as any,
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

      const productKey = makeReminderDedupeKey(booking.id, 'PRODUCT_FOLLOWUP')
      if (createProductReminder) {
        const base = booking.finishedAt ?? booking.scheduledFor
        const due = new Date(base)
        due.setDate(due.getDate() + productReminderDaysAfter)

        if (!Number.isNaN(due.getTime())) {
          await tx.reminder.upsert({
            where: { dedupeKey: productKey } as any,
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

      return { aftercare, remindersTouched, completed: completeBooking, nextBookingId: verifiedNextBooking?.id ?? null }
    })

    const nextHref = result.completed ? '/pro/calendar' : `/pro/bookings/${encodeURIComponent(bookingId)}/aftercare`

    return NextResponse.json(
      {
        ok: true,
        aftercareId: result.aftercare.id,
        publicToken: result.aftercare.publicToken,
        remindersTouched: result.remindersTouched,
        rebookMode: result.aftercare.rebookMode,
        rebookedFor: result.aftercare.rebookedFor ? result.aftercare.rebookedFor.toISOString() : null,
        rebookWindowStart: result.aftercare.rebookWindowStart ? result.aftercare.rebookWindowStart.toISOString() : null,
        rebookWindowEnd: result.aftercare.rebookWindowEnd ? result.aftercare.rebookWindowEnd.toISOString() : null,
        nextBookingId: result.nextBookingId,
        completed: result.completed,
        nextHref,
      },
      { status: 200 },
    )
  } catch (e) {
    console.error('POST /api/pro/bookings/[id]/aftercare error', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
