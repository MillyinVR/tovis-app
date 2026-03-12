// app/api/pro/bookings/[id]/aftercare/route.ts
import type { NextRequest } from 'next/server'
import crypto from 'node:crypto'
import {
  AftercareRebookMode,
  BookingStatus,
  ClientNotificationType,
  Prisma,
  ReminderType,
  SessionStep,
} from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { isValidIanaTimeZone } from '@/lib/timeZone'
import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'

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
  sendToClient?: unknown

  // optional debug only
  timeZone?: unknown
}

type NormalizedProduct = {
  name: string
  url: string
  note: string | null
}

type ProductsParse =
  | { ok: true; value: NormalizedProduct[] }
  | { ok: false; error: string }

const AFTERCARE_REBOOK_MODE = {
  NONE: 'NONE',
  BOOKED_NEXT_APPOINTMENT: 'BOOKED_NEXT_APPOINTMENT',
  RECOMMENDED_WINDOW: 'RECOMMENDED_WINDOW',
} as const satisfies Record<string, AftercareRebookMode>

type NormalizedRebook =
  | {
      mode: typeof AFTERCARE_REBOOK_MODE.NONE
      rebookedFor: null
      rebookWindowStart: null
      rebookWindowEnd: null
    }
  | {
      mode: typeof AFTERCARE_REBOOK_MODE.BOOKED_NEXT_APPOINTMENT
      rebookedFor: Date
      rebookWindowStart: null
      rebookWindowEnd: null
    }
  | {
      mode: typeof AFTERCARE_REBOOK_MODE.RECOMMENDED_WINDOW
      rebookedFor: null
      rebookWindowStart: Date
      rebookWindowEnd: Date
    }

const NOTES_MAX = 4000
const MAX_PRODUCTS = 10
const PRODUCT_NAME_MAX = 80
const PRODUCT_NOTE_MAX = 140
const PRODUCT_URL_MAX = 2048

function trimmedString(x: unknown): string | null {
  return typeof x === 'string' && x.trim() ? x.trim() : null
}

function toBool(x: unknown): boolean {
  return x === true || x === 'true' || x === 1 || x === '1'
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toInt(x: unknown, fallback: number): number {
  const n =
    typeof x === 'number'
      ? x
      : typeof x === 'string'
        ? Number.parseInt(x.trim(), 10)
        : Number.NaN

  return Number.isFinite(n) ? n : fallback
}

function clamp(n: number, min: number, max: number): number {
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
    x === AFTERCARE_REBOOK_MODE.NONE ||
    x === AFTERCARE_REBOOK_MODE.BOOKED_NEXT_APPOINTMENT ||
    x === AFTERCARE_REBOOK_MODE.RECOMMENDED_WINDOW
  )
}

function isValidHttpUrl(raw: string): boolean {
  const s = raw.trim()
  if (!s || s.length > PRODUCT_URL_MAX) return false

  try {
    const u = new URL(s)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

function newPublicToken(): string {
  return crypto.randomBytes(16).toString('hex')
}

function normalizeRecommendedProducts(input: unknown): ProductsParse {
  if (input == null) return { ok: true, value: [] }
  if (!Array.isArray(input)) {
    return { ok: false, error: 'recommendedProducts must be an array.' }
  }
  if (input.length > MAX_PRODUCTS) {
    return { ok: false, error: `recommendedProducts max is ${MAX_PRODUCTS}.` }
  }

  const out: NormalizedProduct[] = []

  for (const row of input) {
  if (!isObject(row)) {
    return { ok: false, error: 'Each recommended product must be an object.' }
  }

  const name =
    typeof row.name === 'string'
      ? row.name.trim().slice(0, PRODUCT_NAME_MAX)
      : ''

  const url =
    typeof row.url === 'string'
      ? row.url.trim().slice(0, PRODUCT_URL_MAX)
      : ''

  const noteRaw =
    typeof row.note === 'string' ? row.note.trim() : ''
    const note = noteRaw ? noteRaw.slice(0, PRODUCT_NOTE_MAX) : null

    if (!name && !url && !note) continue

    if (!name) {
      return { ok: false, error: 'Each recommended product needs a name.' }
    }
    if (!url) {
      return { ok: false, error: 'Each recommended product needs a link.' }
    }
    if (!isValidHttpUrl(url)) {
      return {
        ok: false,
        error: 'Product link must be a valid http/https URL.',
      }
    }

    out.push({ name, url, note })
  }

  return { ok: true, value: out }
}

function normalizeRebookFields(args: {
  requestedMode: AftercareRebookMode
  rebookedForParsed: Date | null | 'invalid'
  windowStartParsed: Date | null | 'invalid'
  windowEndParsed: Date | null | 'invalid'
}): { ok: true; value: NormalizedRebook } | { ok: false; error: string } {
  const {
    requestedMode,
    rebookedForParsed,
    windowStartParsed,
    windowEndParsed,
  } = args

  if (rebookedForParsed === 'invalid') {
    return { ok: false, error: 'Invalid rebookedFor date.' }
  }
  if (windowStartParsed === 'invalid') {
    return { ok: false, error: 'Invalid rebookWindowStart date.' }
  }
  if (windowEndParsed === 'invalid') {
    return { ok: false, error: 'Invalid rebookWindowEnd date.' }
  }

  if (requestedMode === AFTERCARE_REBOOK_MODE.BOOKED_NEXT_APPOINTMENT) {
    if (!rebookedForParsed) {
      return {
        ok: false,
        error: 'BOOKED_NEXT_APPOINTMENT requires rebookedFor.',
      }
    }

    return {
      ok: true,
      value: {
        mode: AFTERCARE_REBOOK_MODE.BOOKED_NEXT_APPOINTMENT,
        rebookedFor: rebookedForParsed,
        rebookWindowStart: null,
        rebookWindowEnd: null,
      },
    }
  }

  if (requestedMode === AFTERCARE_REBOOK_MODE.RECOMMENDED_WINDOW) {
    if (!windowStartParsed || !windowEndParsed) {
      return {
        ok: false,
        error:
          'RECOMMENDED_WINDOW requires rebookWindowStart and rebookWindowEnd.',
      }
    }

    if (windowEndParsed <= windowStartParsed) {
      return {
        ok: false,
        error: 'rebookWindowEnd must be after rebookWindowStart.',
      }
    }

    return {
      ok: true,
      value: {
        mode: AFTERCARE_REBOOK_MODE.RECOMMENDED_WINDOW,
        rebookedFor: null,
        rebookWindowStart: windowStartParsed,
        rebookWindowEnd: windowEndParsed,
      },
    }
  }

  return {
    ok: true,
    value: {
      mode: AFTERCARE_REBOOK_MODE.NONE,
      rebookedFor: null,
      rebookWindowStart: null,
      rebookWindowEnd: null,
    },
  }
}

/** Avoid DST weirdness by shifting in milliseconds. */
function addDaysByMs(base: Date, days: number): Date | null {
  const ms = base.getTime() + days * 24 * 60 * 60 * 1000
  const d = new Date(ms)
  return Number.isNaN(d.getTime()) ? null : d
}

function makeReminderDedupeKey(
  bookingId: string,
  type: 'REBOOK' | 'PRODUCT_FOLLOWUP',
): string {
  return `aftercare:${bookingId}:${type}`
}

function makeClientNotifDedupeKey(bookingId: string): string {
  return `client_aftercare:${bookingId}`
}

function resolveAftercareTimeZone(args: {
  bookingLocationTimeZone?: unknown
  professionalTimeZone?: unknown
}): string {
  const bookingTz =
    typeof args.bookingLocationTimeZone === 'string'
      ? args.bookingLocationTimeZone.trim()
      : ''
  if (bookingTz && isValidIanaTimeZone(bookingTz)) return bookingTz

  const proTz =
    typeof args.professionalTimeZone === 'string'
      ? args.professionalTimeZone.trim()
      : ''
  if (proTz && isValidIanaTimeZone(proTz)) return proTz

  return 'UTC'
}

function formatDateTimeInTimeZone(date: Date, timeZone: string): string {
  const tz = timeZone && isValidIanaTimeZone(timeZone) ? timeZone : 'UTC'

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
}): Date | null {
  const base =
    args.mode === AFTERCARE_REBOOK_MODE.RECOMMENDED_WINDOW
      ? args.windowStart
      : args.rebookedFor

  if (!base) return null
  return addDaysByMs(base, -Math.abs(args.daysBefore))
}

/**
 * Wrap-up eligibility:
 * allow aftercare while in FINISH_REVIEW (wrap-up start), AFTER_PHOTOS (wrap-up), or DONE.
 */
function sessionStepEligible(step: SessionStep | null | undefined): boolean {
  return (
    step === SessionStep.FINISH_REVIEW ||
    step === SessionStep.AFTER_PHOTOS ||
    step === SessionStep.DONE
  )
}

export async function GET(
  _req: NextRequest,
  props: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const proId = auth.professionalId
    const { id } = await props.params
    const bookingId = trimmedString(id)

    if (!bookingId) return jsonFail(400, 'Missing booking id.')

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
                product: {
                  select: {
                    id: true,
                    name: true,
                    brand: true,
                  },
                },
              },
              orderBy: { id: 'asc' },
            },
          },
        },
      },
    })

    if (!booking) return jsonFail(404, 'Booking not found.')
    if (booking.professionalId !== proId) return jsonFail(403, 'Forbidden.')

    return jsonOk({ booking }, 200)
  } catch (e) {
    console.error('GET /api/pro/bookings/[id]/aftercare error', e)
    return jsonFail(500, 'Internal server error.')
  }
}

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const proId = auth.professionalId
    const { id } = await props.params
    const bookingId = trimmedString(id)

    if (!bookingId) return jsonFail(400, 'Missing booking id.')

    const body = (await req.json().catch(() => ({}))) as Body

    const notes =
      typeof body.notes === 'string'
        ? body.notes.trim().slice(0, NOTES_MAX)
        : ''

    const sendToClient = toBool(body.sendToClient)

    const productsParsed = normalizeRecommendedProducts(body.recommendedProducts)
    if (!productsParsed.ok) return jsonFail(400, productsParsed.error)
    const products = productsParsed.value

    const requestedMode = isAftercareRebookMode(body.rebookMode)
      ? body.rebookMode
      : AFTERCARE_REBOOK_MODE.NONE

    const normalizedRebook = normalizeRebookFields({
      requestedMode,
      rebookedForParsed: parseOptionalISODate(body.rebookedFor),
      windowStartParsed: parseOptionalISODate(body.rebookWindowStart),
      windowEndParsed: parseOptionalISODate(body.rebookWindowEnd),
    })

    if (!normalizedRebook.ok) {
      return jsonFail(400, normalizedRebook.error)
    }

    const {
      mode: normalizedMode,
      rebookedFor,
      rebookWindowStart,
      rebookWindowEnd,
    } = normalizedRebook.value

    const createRebookReminder = toBool(body.createRebookReminder)
    const createProductReminder = toBool(body.createProductReminder)

    const rebookReminderDaysBefore = clamp(
      toInt(body.rebookReminderDaysBefore, 2),
      1,
      30,
    )
    const productReminderDaysAfter = clamp(
      toInt(body.productReminderDaysAfter, 7),
      1,
      180,
    )

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

    if (!booking) return jsonFail(404, 'Booking not found.')
    if (booking.professionalId !== proId) return jsonFail(403, 'Forbidden.')

    if (booking.status === BookingStatus.CANCELLED) {
      return jsonFail(409, 'This booking is cancelled.')
    }

    if (booking.status === BookingStatus.PENDING) {
      return jsonFail(
        409,
        'Aftercare can’t be posted until the booking is confirmed.',
      )
    }

    if (!sessionStepEligible(booking.sessionStep)) {
      return jsonFail(
        409,
        `Aftercare isn’t available yet. Current step: ${booking.sessionStep ?? 'NONE'}.`,
      )
    }

    const aftercareTimeZone = resolveAftercareTimeZone({
      bookingLocationTimeZone: booking.locationTimeZone,
      professionalTimeZone: booking.professional?.timeZone,
    })

    const clientTz =
      typeof body.timeZone === 'string' ? body.timeZone.trim() : ''
    const clientTimeZoneReceived =
      clientTz && isValidIanaTimeZone(clientTz) ? clientTz : null

    const result = await prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        const tokenToUse =
          booking.aftercareSummary?.publicToken ?? newPublicToken()

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

        await tx.productRecommendation.deleteMany({
          where: { aftercareSummaryId: aftercare.id },
        })

        if (products.length > 0) {
          await tx.productRecommendation.createMany({
            data: products.map((product) => ({
              aftercareSummaryId: aftercare.id,
              productId: null,
              externalName: product.name,
              externalUrl: product.url,
              note: product.note,
            })),
          })
        }

        let clientNotified = false

        if (sendToClient) {
          const notifKey = makeClientNotifDedupeKey(booking.id)
          const notifTitle = `Aftercare: ${booking.service?.name ?? 'Your appointment'}`
          const bodyPreview = notes.trim() ? notes.trim().slice(0, 240) : null

          await tx.clientNotification.upsert({
            where: { dedupeKey: notifKey },
            create: {
              dedupeKey: notifKey,
              clientId: booking.clientId,
              type: ClientNotificationType.AFTERCARE,
              title: notifTitle,
              body: bodyPreview,
              bookingId: booking.id,
              aftercareId: aftercare.id,
              readAt: null,
            },
            update: {
              type: ClientNotificationType.AFTERCARE,
              title: notifTitle,
              body: bodyPreview,
              bookingId: booking.id,
              aftercareId: aftercare.id,
              readAt: null,
            },
          })

          clientNotified = true
        }

        let remindersTouched = 0

        const clientName =
          `${(booking.client?.firstName ?? '').trim()} ${(booking.client?.lastName ?? '').trim()}`.trim()
        const serviceName = (booking.service?.name ?? 'service').trim()

        const rebookKey = makeReminderDedupeKey(booking.id, 'REBOOK')
        const rebookDue = computeRebookReminderDueAt({
          mode: normalizedMode,
          rebookedFor,
          windowStart: rebookWindowStart,
          daysBefore: rebookReminderDaysBefore,
        })

        if (
          createRebookReminder &&
          rebookDue &&
          normalizedMode !== AFTERCARE_REBOOK_MODE.NONE
        ) {
          const title = clientName
            ? `Rebook: ${clientName}`
            : 'Rebook reminder'

          const bodyText =
            normalizedMode === AFTERCARE_REBOOK_MODE.RECOMMENDED_WINDOW &&
            rebookWindowStart &&
            rebookWindowEnd
              ? `Recommended booking window for ${serviceName}: ${formatDateTimeInTimeZone(
                  rebookWindowStart,
                  aftercareTimeZone,
                )} → ${formatDateTimeInTimeZone(rebookWindowEnd, aftercareTimeZone)} (${aftercareTimeZone})`
              : rebookedFor
                ? `Recommended next visit for ${serviceName}: ${formatDateTimeInTimeZone(
                    rebookedFor,
                    aftercareTimeZone,
                  )} (${aftercareTimeZone})`
                : `Follow up for ${serviceName}.`

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

          remindersTouched += 1
        } else {
          const del = await tx.reminder.deleteMany({
            where: { dedupeKey: rebookKey, completedAt: null },
          })
          remindersTouched += del.count
        }

        const productKey = makeReminderDedupeKey(
          booking.id,
          'PRODUCT_FOLLOWUP',
        )

        if (createProductReminder) {
          const base = booking.finishedAt ?? booking.scheduledFor ?? new Date()
          const due = addDaysByMs(base, productReminderDaysAfter)

          if (due) {
            const title = clientName
              ? `Product follow-up: ${clientName}`
              : 'Product follow-up'

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

            remindersTouched += 1
          }
        } else {
          const del = await tx.reminder.deleteMany({
            where: { dedupeKey: productKey, completedAt: null },
          })
          remindersTouched += del.count
        }

        let bookingFinished = false
        let bookingNow: {
          status: BookingStatus
          sessionStep: SessionStep | null
          finishedAt: Date | null
        } | null = null

        if (sendToClient) {
          const now = new Date()

          bookingNow = await tx.booking.update({
            where: { id: booking.id },
            data: {
              status: BookingStatus.COMPLETED,
              sessionStep: SessionStep.DONE,
              finishedAt: booking.finishedAt ?? now,
            },
            select: {
              status: true,
              sessionStep: true,
              finishedAt: true,
            },
          })

          bookingFinished = true
        }

        return {
          aftercare,
          remindersTouched,
          clientNotified,
          bookingFinished,
          bookingNow,
        }
      },
    )

    return jsonOk(
      {
        aftercareId: result.aftercare.id,
        publicToken: result.aftercare.publicToken,
        remindersTouched: result.remindersTouched,
        clientNotified: result.clientNotified,

        rebookMode: result.aftercare.rebookMode,
        rebookedFor: result.aftercare.rebookedFor
          ? result.aftercare.rebookedFor.toISOString()
          : null,
        rebookWindowStart: result.aftercare.rebookWindowStart
          ? result.aftercare.rebookWindowStart.toISOString()
          : null,
        rebookWindowEnd: result.aftercare.rebookWindowEnd
          ? result.aftercare.rebookWindowEnd.toISOString()
          : null,

        timeZoneUsed: aftercareTimeZone,
        clientTimeZoneReceived,

        bookingFinished: result.bookingFinished,
        booking: result.bookingNow
          ? {
              ...result.bookingNow,
              finishedAt: result.bookingNow.finishedAt?.toISOString() ?? null,
            }
          : null,
        redirectTo: result.bookingFinished ? '/pro/calendar' : null,
      },
      200,
    )
  } catch (e) {
    console.error('POST /api/pro/bookings/[id]/aftercare error', e)
    return jsonFail(500, 'Internal server error.')
  }
}