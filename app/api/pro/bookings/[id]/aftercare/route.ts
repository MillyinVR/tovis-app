// app/api/pro/bookings/[id]/aftercare/route.ts
import { NextRequest, NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { BookingStatus, AftercareRebookMode, ReminderType, ClientNotificationType, SessionStep } from '@prisma/client'
import { isValidIanaTimeZone } from '@/lib/timeZone'

export const dynamic = 'force-dynamic'

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

  // ✅ only notify client when true
  sendToClient?: unknown

  // optional debug only
  timeZone?: unknown
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

function isAftercareRebookMode(x: unknown): x is AftercareRebookMode {
  return (
    x === AftercareRebookMode.NONE ||
    x === AftercareRebookMode.BOOKED_NEXT_APPOINTMENT ||
    x === AftercareRebookMode.RECOMMENDED_WINDOW
  )
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

    if (!name && !url && !note) continue

    if (!name) return { error: 'Each recommended product needs a name.' as const }
    if (!url) return { error: 'Each recommended product needs a link.' as const }
    if (!isValidHttpUrl(url)) return { error: 'Product link must be a valid http/https URL.' as const }

    out.push({ name, url, note })
  }

  return out
}

/**
 * Avoid DST weirdness by shifting in milliseconds.
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
 * Appointment/aftercare timezone for DISPLAY ONLY:
 * booking.locationTimeZone > pro.timeZone > UTC
 */
function resolveAftercareTimeZone(args: { bookingLocationTimeZone?: unknown; professionalTimeZone?: unknown }) {
  const bookingTz = typeof args.bookingLocationTimeZone === 'string' ? args.bookingLocationTimeZone.trim() : ''
  if (bookingTz && isValidIanaTimeZone(bookingTz)) return bookingTz

  const proTz = typeof args.professionalTimeZone === 'string' ? args.professionalTimeZone.trim() : ''
  if (proTz && isValidIanaTimeZone(proTz)) return proTz

  return 'UTC'
}

function formatDateTimeInTimeZone(date: Date, timeZone: string) {
  const tz = resolveAftercareTimeZone({ bookingLocationTimeZone: timeZone })
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

function computeRebookReminderDueAt(args: {
  mode: AftercareRebookMode
  rebookedFor: Date | null
  windowStart: Date | null
  daysBefore: number
}) {
  const base = args.mode === AftercareRebookMode.RECOMMENDED_WINDOW ? args.windowStart : args.rebookedFor
  if (!base) return null
  return addDaysByMs(base, -Math.abs(args.daysBefore))
}

/**
 * ✅ Wrap-up eligibility:
 * allow aftercare while in FINISH_REVIEW (wrap-up start), AFTER_PHOTOS (wrap-up), or DONE.
 */
function sessionStepEligible(step: SessionStep | null | undefined) {
  return step === SessionStep.FINISH_REVIEW || step === SessionStep.AFTER_PHOTOS || step === SessionStep.DONE
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
        locationTimeZone: true,
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

    const body = (await request.json().catch(() => ({}))) as Body

    const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, NOTES_MAX) : ''
    const sendToClient = toBool(body.sendToClient)

    const normalizedProducts = normalizeRecommendedProducts(body.recommendedProducts)
    if ((normalizedProducts as any)?.error) return jsonError((normalizedProducts as any).error, 400)

    const requestedMode: AftercareRebookMode = isAftercareRebookMode(body.rebookMode)
      ? body.rebookMode
      : AftercareRebookMode.NONE

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
      select: {
        id: true,
        clientId: true,
        professionalId: true,
        status: true,
        sessionStep: true,
        scheduledFor: true,
        finishedAt: true,
        locationTimeZone: true,
        service: { select: { name: true } },
        client: { select: { firstName: true, lastName: true } },
        aftercareSummary: { select: { publicToken: true } },
        professional: { select: { timeZone: true } },
      },
    })

    if (!booking) return jsonError('Booking not found.', 404)
    if (booking.professionalId !== proId) return jsonError('Forbidden.', 403)

    if (booking.status === BookingStatus.CANCELLED) return jsonError('This booking is cancelled.', 409)
    if (booking.status === BookingStatus.PENDING) return jsonError('Aftercare can’t be posted until the booking is confirmed.', 409)

    if (!sessionStepEligible(booking.sessionStep)) {
      return jsonError(
        `Aftercare isn’t available yet. Current step: ${booking.sessionStep ?? 'NONE'}.`,
        409,
      )
    }

    // timezone used for reminder copy (booking tz > pro tz > UTC)
    const aftercareTimeZone = resolveAftercareTimeZone({
      bookingLocationTimeZone: booking.locationTimeZone,
      professionalTimeZone: booking.professional?.timeZone,
    })

    // debug only: client tz doesn't override truth
    const clientTz = typeof body.timeZone === 'string' ? body.timeZone.trim() : ''
    const clientTzOk = clientTz ? isValidIanaTimeZone(clientTz) : false

    // Normalize rebook fields (clear unrelated)
    let normalizedMode: AftercareRebookMode = requestedMode
    let rebookedFor: Date | null = null
    let rebookWindowStart: Date | null = null
    let rebookWindowEnd: Date | null = null

    if (requestedMode === AftercareRebookMode.BOOKED_NEXT_APPOINTMENT) {
      rebookedFor = rebookedForParsed as Date | null
      if (!rebookedFor) return jsonError('BOOKED_NEXT_APPOINTMENT requires rebookedFor.', 400)
    } else if (requestedMode === AftercareRebookMode.RECOMMENDED_WINDOW) {
      if (!windowStartParsed || !windowEndParsed) {
        return jsonError('RECOMMENDED_WINDOW requires rebookWindowStart and rebookWindowEnd.', 400)
      }
      if (windowEndParsed <= windowStartParsed) {
        return jsonError('rebookWindowEnd must be after rebookWindowStart.', 400)
      }
      rebookWindowStart = windowStartParsed
      rebookWindowEnd = windowEndParsed
    } else {
      normalizedMode = AftercareRebookMode.NONE
    }

    const result = await prisma.$transaction(async (tx) => {
      const tokenToUse = booking.aftercareSummary?.publicToken ?? newPublicToken()

      const aftercare = await tx.aftercareSummary.upsert({
        where: { bookingId: booking.id },
        create: {
          bookingId: booking.id,
          publicToken: tokenToUse,
          notes: notes || null,
          rebookMode: normalizedMode,
          rebookedFor,
          rebookWindowStart,
          rebookWindowEnd,
        },
        update: {
          publicToken: tokenToUse,
          notes: notes || null,
          rebookMode: normalizedMode,
          rebookedFor,
          rebookWindowStart,
          rebookWindowEnd,
        },
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

      // ✅ Only notify client when pro explicitly sends
      let clientNotified = false
      if (sendToClient) {
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
              type: ClientNotificationType.AFTERCARE,
              title: notifTitle,
              body: bodyPreview,
              bookingId: booking.id,
              aftercareId: aftercare.id,
              readAt: null,
            },
          })
        } else {
          await tx.clientNotification.update({
            where: { id: existingNotif.id },
            data: {
              type: ClientNotificationType.AFTERCARE,
              title: notifTitle,
              body: bodyPreview,
              bookingId: booking.id,
              aftercareId: aftercare.id,
              readAt: null,
            },
          })
        }

        clientNotified = true
      }

      let remindersTouched = 0

      const clientName = `${(booking.client?.firstName ?? '').trim()} ${(booking.client?.lastName ?? '').trim()}`.trim()
      const serviceName = (booking.service?.name ?? 'service').trim()

      // Rebook reminder
      const rebookKey = makeReminderDedupeKey(booking.id, 'REBOOK')
      const rebookDue = computeRebookReminderDueAt({
        mode: normalizedMode,
        rebookedFor,
        windowStart: rebookWindowStart,
        daysBefore: rebookReminderDaysBefore,
      })

      if (createRebookReminder && rebookDue) {
        const title = clientName ? `Rebook: ${clientName}` : 'Rebook reminder'

        const bodyText =
          normalizedMode === AftercareRebookMode.RECOMMENDED_WINDOW
            ? `Recommended booking window for ${serviceName}: ${formatDateTimeInTimeZone(
                rebookWindowStart as Date,
                aftercareTimeZone,
              )} → ${formatDateTimeInTimeZone(rebookWindowEnd as Date, aftercareTimeZone)} (${aftercareTimeZone})`
            : `Recommended next visit for ${serviceName}: ${formatDateTimeInTimeZone(
                rebookedFor as Date,
                aftercareTimeZone,
              )} (${aftercareTimeZone})`

        await tx.reminder.upsert({
          where: { dedupeKey: rebookKey },
          create: {
            dedupeKey: rebookKey,
            professionalId: booking.professionalId,
            clientId: booking.clientId,
            bookingId: booking.id,
            type: ReminderType.REBOOK,
            title,
            body: bodyText,
            dueAt: rebookDue,
          },
          update: {
            title,
            body: bodyText,
            dueAt: rebookDue,
            completedAt: null,
          },
        })
        remindersTouched++
      } else {
        const del = await tx.reminder.deleteMany({ where: { dedupeKey: rebookKey, completedAt: null } })
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
            aftercareTimeZone,
          )} (${aftercareTimeZone})`

          await tx.reminder.upsert({
            where: { dedupeKey: productKey },
            create: {
              dedupeKey: productKey,
              professionalId: booking.professionalId,
              clientId: booking.clientId,
              bookingId: booking.id,
              type: ReminderType.PRODUCT_FOLLOWUP,
              title,
              body: bodyText,
              dueAt: due,
            },
            update: {
              title,
              body: bodyText,
              dueAt: due,
              completedAt: null,
            },
          })
          remindersTouched++
        }
      } else {
        const del = await tx.reminder.deleteMany({ where: { dedupeKey: productKey, completedAt: null } })
        remindersTouched += del.count
      }

      return { aftercare, remindersTouched, clientNotified }
    })

    return NextResponse.json(
      {
        ok: true,
        aftercareId: result.aftercare.id,
        publicToken: result.aftercare.publicToken,
        remindersTouched: result.remindersTouched,
        clientNotified: result.clientNotified,

        rebookMode: result.aftercare.rebookMode,
        rebookedFor: result.aftercare.rebookedFor ? result.aftercare.rebookedFor.toISOString() : null,
        rebookWindowStart: result.aftercare.rebookWindowStart ? result.aftercare.rebookWindowStart.toISOString() : null,
        rebookWindowEnd: result.aftercare.rebookWindowEnd ? result.aftercare.rebookWindowEnd.toISOString() : null,

        timeZoneUsed: aftercareTimeZone,
        clientTimeZoneReceived: clientTzOk ? clientTz : null,
      },
      { status: 200 },
    )
  } catch (e) {
    console.error('POST /api/pro/bookings/[id]/aftercare error', e)
    return jsonError('Internal server error.', 500)
  }
}
