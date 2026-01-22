// app/api/pro/bookings/[id]/aftercare/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import crypto from 'node:crypto'
import { BookingStatus } from '@prisma/client'
import { sanitizeTimeZone } from '@/lib/timeZone'

export const dynamic = 'force-dynamic'

type RebookMode = 'NONE' | 'BOOKED_NEXT_APPOINTMENT' | 'RECOMMENDED_WINDOW'

type RecommendedProductIn = {
  name?: unknown
  url?: unknown
  note?: unknown
}

type Body = {
  notes?: unknown
  rebookMode?: unknown
  rebookedFor?: unknown
  rebookWindowStart?: unknown
  rebookWindowEnd?: unknown

  createRebookReminder?: unknown
  rebookReminderDaysBefore?: unknown

  createProductReminder?: unknown
  productReminderDaysAfter?: unknown

  recommendedProducts?: unknown
}

const NOTES_MAX = 4000

const MAX_PRODUCTS = 10
const PRODUCT_NAME_MAX = 80
const PRODUCT_NOTE_MAX = 140
const PRODUCT_URL_MAX = 2048

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status })
}

function trimmedString(x: unknown): string | null {
  return typeof x === 'string' && x.trim() ? x.trim() : null
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

function newPublicToken() {
  return crypto.randomBytes(16).toString('hex')
}

function normalizeRecommendedProducts(input: unknown) {
  if (input == null) return [] as Array<{ name: string; url: string; note: string | null }>

  if (!Array.isArray(input)) return { error: 'recommendedProducts must be an array.' as const }
  if (input.length > MAX_PRODUCTS) return { error: `recommendedProducts max is ${MAX_PRODUCTS}.` as const }

  const out: Array<{ name: string; url: string; note: string | null }> = []

  for (const row of input as RecommendedProductIn[]) {
    const name = typeof row?.name === 'string' ? row.name.trim().slice(0, PRODUCT_NAME_MAX) : ''
    const url = typeof row?.url === 'string' ? row.url.trim().slice(0, PRODUCT_URL_MAX) : ''
    const noteRaw = typeof row?.note === 'string' ? row.note.trim() : ''
    const note = noteRaw ? noteRaw.slice(0, PRODUCT_NOTE_MAX) : null

    // ignore blank rows
    if (!name && !url && !note) continue

    if (!name) return { error: 'Each recommended product needs a name.' as const }
    if (!url) return { error: 'Each recommended product needs a link.' as const }
    if (!isValidHttpUrl(url)) return { error: 'Product link must be a valid http/https URL.' as const }

    out.push({ name, url, note })
  }

  return out
}

/**
 * Avoid setDate DST weirdness by shifting in milliseconds.
 */
function addDaysByMs(base: Date, days: number) {
  const ms = base.getTime() + days * 24 * 60 * 60 * 1000
  const d = new Date(ms)
  return Number.isNaN(d.getTime()) ? null : d
}

function makeReminderDedupeKey(bookingId: string, type: 'REBOOK' | 'PRODUCT_FOLLOWUP') {
  return `aftercare:${bookingId}:${type}`
}

function makeClientNotifDedupeKey(bookingId: string) {
  return `client_aftercare:${bookingId}`
}

/**
 * Human-friendly formatting in a specific IANA time zone.
 */
function formatDateTimeInTimeZone(date: Date, timeZone: string) {
  const tz = sanitizeTimeZone(timeZone, 'UTC')
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

function formatShortTzLabel(timeZone: string) {
  const tz = sanitizeTimeZone(timeZone, 'UTC')
  // keep it simple and predictable: show the IANA id
  // (abbreviations like PST/PDT are unreliable with Intl across environments)
  return tz
}

/**
 * For rebook reminders:
 * - BOOKED_NEXT_APPOINTMENT: dueAt = rebookedFor - daysBefore
 * - RECOMMENDED_WINDOW: dueAt = windowStart - daysBefore (nudge at beginning)
 */
function computeRebookReminderDueAt(args: {
  mode: RebookMode
  rebookedFor: Date | null
  windowStart: Date | null
  daysBefore: number
}) {
  const base = args.mode === 'RECOMMENDED_WINDOW' ? args.windowStart : args.rebookedFor
  if (!base) return null
  return addDaysByMs(base, -Math.abs(args.daysBefore))
}

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await props.params
    const bookingId = trimmedString(id)
    if (!bookingId) return jsonError('Missing booking id.', 400)

    const user = await getCurrentUser().catch(() => null)
    const proId = user?.role === 'PRO' ? user.professionalProfile?.id : null
    if (!proId) return jsonError('Not authorized.', 401)

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
          },
        },
      },
    })

    if (!booking) return jsonError('Booking not found.', 404)
    if (booking.professionalId !== proId) return jsonError('Forbidden.', 403)

    return NextResponse.json({ ok: true, booking }, { status: 200 })
  } catch (e) {
    console.error('GET /api/pro/bookings/[id]/aftercare error', e)
    return jsonError('Internal server error.', 500)
  }
}

export async function POST(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await props.params
    const bookingId = trimmedString(id)
    if (!bookingId) return jsonError('Missing booking id.', 400)

    const user = await getCurrentUser().catch(() => null)
    const proId = user?.role === 'PRO' ? user.professionalProfile?.id : null
    if (!proId) return jsonError('Not authorized.', 401)

    // Display timezone for reminder copy
    const proTimeZone = sanitizeTimeZone((user as any)?.professionalProfile?.timeZone, 'UTC')
    const tzLabel = formatShortTzLabel(proTimeZone)

    const body = (await request.json().catch(() => ({}))) as Body

    const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, NOTES_MAX) : ''

    const normalizedProducts = normalizeRecommendedProducts(body.recommendedProducts)
    if ((normalizedProducts as any)?.error) {
      return jsonError((normalizedProducts as any).error, 400)
    }

    const rawMode: RebookMode = isRebookMode(body.rebookMode) ? (body.rebookMode as RebookMode) : 'NONE'

    const rebookedForParsed = parseOptionalISODate(body.rebookedFor)
    if (rebookedForParsed === 'invalid') return jsonError('Invalid rebookedFor date.', 400)

    const windowStartParsed = parseOptionalISODate(body.rebookWindowStart)
    if (windowStartParsed === 'invalid') return jsonError('Invalid rebookWindowStart date.', 400)

    const windowEndParsed = parseOptionalISODate(body.rebookWindowEnd)
    if (windowEndParsed === 'invalid') return jsonError('Invalid rebookWindowEnd date.', 400)

    const createRebookReminder = toBool(body.createRebookReminder)
    const createProductReminder = toBool(body.createProductReminder)

    const rebookReminderDaysBefore = clamp(toInt(body.rebookReminderDaysBefore, 2), 1, 30)
    const productReminderDaysAfter = clamp(toInt(body.productReminderDaysAfter, 7), 1, 180)

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: { client: true, service: true, aftercareSummary: true },
    })

    if (!booking) return jsonError('Booking not found.', 404)
    if (booking.professionalId !== proId) return jsonError('Forbidden.', 403)

    if (booking.status === BookingStatus.CANCELLED) return jsonError('This booking is cancelled.', 409)
    if (booking.status === BookingStatus.PENDING) {
      return jsonError('Aftercare can’t be posted until the booking is confirmed.', 409)
    }

    const step = String((booking as any).sessionStep || '').toUpperCase()
    const eligibleStep = step === 'DONE' || step === 'AFTER_PHOTOS'
    if (!eligibleStep) {
      return jsonError(`Aftercare is locked until after-photos is complete. Current step: ${step || 'NONE'}.`, 409)
    }

    // Contract: only complete when step says DONE
    const shouldCompleteBooking = step === 'DONE'

    // Normalize rebook fields (clear unrelated)
    let normalizedMode: RebookMode = rawMode
    let rebookedFor: Date | null = null
    let rebookWindowStart: Date | null = null
    let rebookWindowEnd: Date | null = null

    if (rawMode === 'BOOKED_NEXT_APPOINTMENT') {
      rebookedFor = rebookedForParsed as Date | null
      if (!rebookedFor) return jsonError('BOOKED_NEXT_APPOINTMENT requires rebookedFor.', 400)
    } else if (rawMode === 'RECOMMENDED_WINDOW') {
      if (!windowStartParsed || !windowEndParsed) {
        return jsonError('RECOMMENDED_WINDOW requires rebookWindowStart and rebookWindowEnd.', 400)
      }
      if (windowEndParsed <= windowStartParsed) {
        return jsonError('rebookWindowEnd must be after rebookWindowStart.', 400)
      }
      rebookWindowStart = windowStartParsed
      rebookWindowEnd = windowEndParsed
    } else {
      normalizedMode = 'NONE'
    }

    const result = await prisma.$transaction(async (tx) => {
      const existingToken = booking.aftercareSummary?.publicToken ?? null
      const tokenToUse = existingToken || newPublicToken()

      const aftercare = await tx.aftercareSummary.upsert({
        where: { bookingId: booking.id },
        create: {
          bookingId: booking.id,
          publicToken: tokenToUse,
          notes: notes || null,
          rebookMode: normalizedMode as any,
          rebookedFor,
          rebookWindowStart,
          rebookWindowEnd,
        } as any,
        update: {
          publicToken: tokenToUse,
          notes: notes || null,
          rebookMode: normalizedMode as any,
          rebookedFor,
          rebookWindowStart,
          rebookWindowEnd,
        } as any,
        select: {
          id: true,
          publicToken: true,
          rebookMode: true,
          rebookedFor: true,
          rebookWindowStart: true,
          rebookWindowEnd: true,
        },
      })

      // Replace recommendations
      await tx.productRecommendation.deleteMany({
        where: { aftercareSummaryId: aftercare.id },
      })

      const products = normalizedProducts as Array<{ name: string; url: string; note: string | null }>
      if (products.length) {
        await tx.productRecommendation.createMany({
          data: products.map((p) => ({
            aftercareSummaryId: aftercare.id,
            productId: null,
            externalName: p.name,
            externalUrl: p.url,
            note: p.note,
          })),
        })
      }

      // Client notification (deduped) and always marked unread on updates
      const notifKey = makeClientNotifDedupeKey(booking.id)
      const notifTitle = `Aftercare: ${booking.service?.name ?? 'Your appointment'}`
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
            title: notifTitle,
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
            title: notifTitle,
            body: bodyPreview,
            bookingId: booking.id,
            aftercareId: aftercare.id,
            readAt: null,
          } as any,
        })
      }

      if (shouldCompleteBooking) {
        await tx.booking.update({
          where: { id: booking.id },
          data: {
            status: BookingStatus.COMPLETED,
            finishedAt: booking.finishedAt ?? new Date(),
            sessionStep: 'DONE' as any,
          } as any,
        })
      }

      let remindersTouched = 0

      // Rebook reminder
      const rebookKey = makeReminderDedupeKey(booking.id, 'REBOOK')
      const rebookDue = computeRebookReminderDueAt({
        mode: normalizedMode,
        rebookedFor,
        windowStart: rebookWindowStart,
        daysBefore: rebookReminderDaysBefore,
      })

      const clientName = `${(booking.client?.firstName ?? '').trim()} ${(booking.client?.lastName ?? '').trim()}`.trim()
      const serviceName = (booking.service?.name ?? 'service').trim()

      if (createRebookReminder && rebookDue) {
        const title = clientName ? `Rebook: ${clientName}` : 'Rebook reminder'

        const bodyText =
          normalizedMode === 'RECOMMENDED_WINDOW'
            ? `Recommended booking window for ${serviceName}: ${formatDateTimeInTimeZone(
                rebookWindowStart as Date,
                proTimeZone,
              )} → ${formatDateTimeInTimeZone(rebookWindowEnd as Date, proTimeZone)} (${tzLabel})`
            : `Recommended next visit for ${serviceName}: ${formatDateTimeInTimeZone(
                rebookedFor as Date,
                proTimeZone,
              )} (${tzLabel})`

        await tx.reminder.upsert({
          where: { dedupeKey: rebookKey } as any,
          create: {
            dedupeKey: rebookKey,
            professionalId: booking.professionalId,
            clientId: booking.clientId,
            bookingId: booking.id,
            type: 'REBOOK',
            title,
            body: bodyText,
            dueAt: rebookDue,
          } as any,
          update: {
            title,
            body: bodyText,
            dueAt: rebookDue,
            completedAt: null,
          } as any,
        })
        remindersTouched++
      } else {
        const del = await tx.reminder.deleteMany({ where: { dedupeKey: rebookKey, completedAt: null } as any })
        remindersTouched += del.count
      }

      // Product follow-up reminder
      const productKey = makeReminderDedupeKey(booking.id, 'PRODUCT_FOLLOWUP')
      if (createProductReminder) {
        const base = booking.finishedAt ?? booking.scheduledFor ?? new Date()
        const due = addDaysByMs(base, productReminderDaysAfter)

        if (due) {
          const title = clientName ? `Product follow-up: ${clientName}` : 'Product follow-up'
          const bodyText = `Follow up on products after ${serviceName}. Due: ${formatDateTimeInTimeZone(
            due,
            proTimeZone,
          )} (${tzLabel})`

          await tx.reminder.upsert({
            where: { dedupeKey: productKey } as any,
            create: {
              dedupeKey: productKey,
              professionalId: booking.professionalId,
              clientId: booking.clientId,
              bookingId: booking.id,
              type: 'PRODUCT_FOLLOWUP',
              title,
              body: bodyText,
              dueAt: due,
            } as any,
            update: {
              title,
              body: bodyText,
              dueAt: due,
              completedAt: null,
            } as any,
          })
          remindersTouched++
        }
      } else {
        const del = await tx.reminder.deleteMany({ where: { dedupeKey: productKey, completedAt: null } as any })
        remindersTouched += del.count
      }

      return {
        aftercare,
        remindersTouched,
        completed: shouldCompleteBooking,
      }
    })

    const nextHref = result.completed ? '/pro/calendar' : `/pro/bookings/${encodeURIComponent(bookingId)}/aftercare`

    return NextResponse.json(
      {
        ok: true,
        aftercareId: result.aftercare.id,
        publicToken: result.aftercare.publicToken,
        remindersTouched: result.remindersTouched,
        completed: result.completed,
        rebookMode: result.aftercare.rebookMode,
        rebookedFor: result.aftercare.rebookedFor ? result.aftercare.rebookedFor.toISOString() : null,
        rebookWindowStart: result.aftercare.rebookWindowStart ? result.aftercare.rebookWindowStart.toISOString() : null,
        rebookWindowEnd: result.aftercare.rebookWindowEnd ? result.aftercare.rebookWindowEnd.toISOString() : null,
        nextHref,
      },
      { status: 200 },
    )
  } catch (e) {
    console.error('POST /api/pro/bookings/[id]/aftercare error', e)
    return jsonError('Internal server error.', 500)
  }
}
