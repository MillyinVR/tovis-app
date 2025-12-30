// app/api/client/bookings/create/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'

type Body = {
  offeringId?: unknown

  /**
   * Accepts:
   *  - ISO with timezone: "2026-01-05T22:00:00.000Z" or "2026-01-05T14:00:00-08:00"
   *  - naive local: "2026-01-05T14:00" (then MUST have proTimeZone)
   */
  scheduledFor?: unknown

  /**
   * If provided, used when scheduledFor is naive.
   * If omitted, we’ll use the professional’s saved timeZone.
   */
  proTimeZone?: unknown

  /**
   * Booking.locationType determines price/duration snapshot:
   * SALON | MOBILE
   */
  locationType?: unknown

  source?: unknown

  // optional attribution
  rebookOfBookingId?: unknown
  openingId?: unknown
  aftercareToken?: unknown
}

const MAX_LOOKAHEAD_DAYS = 365 // sanity guard
const MIN_LEAD_MINUTES = 5     // prevent “book in the past” edge cases
const DEFAULT_TZ = 'America/Los_Angeles'

function pickString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function upper(v: unknown) {
  return typeof v === 'string' ? v.trim().toUpperCase() : ''
}

function toBool(v: unknown) {
  return v === true || v === 'true' || v === 1 || v === '1'
}

function isValidDate(d: Date) {
  return d instanceof Date && !Number.isNaN(d.getTime())
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000)
}

/** existingStart < requestedEnd AND existingEnd > requestedStart */
function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && aEnd > bStart
}

/**
 * Validate/normalize IANA tz.
 */
function sanitizeTimeZone(tz: string | null | undefined) {
  if (!tz) return null
  if (!/^[A-Za-z_]+\/[A-Za-z0-9_\-+]+$/.test(tz)) return null
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date())
    return tz
  } catch {
    return null
  }
}

/**
 * Detect if string looks like ISO with explicit zone info.
 */
function hasExplicitOffsetOrZ(s: string) {
  return /([zZ]|[+\-]\d{2}:\d{2})$/.test(s)
}

/**
 * Convert a "local time in a given time zone" into a UTC Date.
 * Input must be "YYYY-MM-DDTHH:mm" or "YYYY-MM-DDTHH:mm:ss" (no Z/offset).
 *
 * This uses an offset-solving approach with Intl.
 * It’s not pretty, but it’s dependency-free and correct for DST.
 */
function zonedLocalToUtc(localIsoNoZone: string, timeZone: string): Date | null {
  const m = localIsoNoZone.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/
  )
  if (!m) return null

  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  const hour = Number(m[4])
  const minute = Number(m[5])
  const second = Number(m[6] || '0')

  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    !Number.isFinite(hour) ||
    !Number.isFinite(minute) ||
    !Number.isFinite(second)
  ) return null

  // Start with a UTC guess using the same wall-clock components.
  // Then compute what wall-clock time that guess corresponds to in the target TZ,
  // and correct by the difference. Iterate once more to stabilize DST boundaries.
  const guessUtc = new Date(Date.UTC(year, month - 1, day, hour, minute, second))

  const toParts = (d: Date) => {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
    const parts = fmt.formatToParts(d)
    const get = (t: string) => parts.find(p => p.type === t)?.value
    return {
      y: Number(get('year')),
      mo: Number(get('month')),
      da: Number(get('day')),
      h: Number(get('hour')),
      mi: Number(get('minute')),
      s: Number(get('second')),
    }
  }

  const desired = { y: year, mo: month, da: day, h: hour, mi: minute, s: second }

  const diffMinutes = (a: any, b: any) => {
    // difference between a and b as minutes, using Date.UTC for consistent math
    const aMs = Date.UTC(a.y, a.mo - 1, a.da, a.h, a.mi, a.s)
    const bMs = Date.UTC(b.y, b.mo - 1, b.da, b.h, b.mi, b.s)
    return Math.round((aMs - bMs) / 60000)
  }

  const p1 = toParts(guessUtc)
  const delta1 = diffMinutes(desired, p1)
  const corrected1 = addMinutes(guessUtc, delta1)

  const p2 = toParts(corrected1)
  const delta2 = diffMinutes(desired, p2)
  const corrected2 = addMinutes(corrected1, delta2)

  return corrected2
}

/**
 * PriceSnapshot on Booking is Decimal required in your schema.
 * We accept numbers/strings and pass through. Prisma will coerce string -> Decimal.
 */
function normalizeDecimalInput(v: unknown): string | null {
  if (v == null) return null
  if (typeof v === 'string' && v.trim()) return v.trim()
  if (typeof v === 'number' && Number.isFinite(v)) return v.toFixed(2)
  const s = String(v)
  return s.trim() ? s.trim() : null
}

function isLocationType(x: unknown): x is 'SALON' | 'MOBILE' {
  const u = upper(x)
  return u === 'SALON' || u === 'MOBILE'
}

function isSource(x: unknown) {
  // Keep permissive. Your schema has BookingSource enum.
  // We normalize uppercase and let Prisma validate.
  const s = upper(x)
  return s || 'REQUESTED'
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'CLIENT' || !user.clientProfile?.id) {
      return NextResponse.json({ error: 'Only clients can create bookings.' }, { status: 401 })
    }

    const body = (await req.json().catch(() => ({}))) as Body

    const offeringId = pickString(body.offeringId)
    const scheduledForRaw = pickString(body.scheduledFor)
    const locationType = isLocationType(body.locationType) ? upper(body.locationType) as 'SALON' | 'MOBILE' : 'SALON'
    const source = isSource(body.source)

    if (!offeringId) return NextResponse.json({ error: 'Missing offeringId.' }, { status: 400 })
    if (!scheduledForRaw) return NextResponse.json({ error: 'Missing scheduledFor.' }, { status: 400 })

    // Load offering + pro tz + correct price/duration fields (matches your schema)
    const offering = await prisma.professionalServiceOffering.findUnique({
      where: { id: offeringId },
      select: {
        id: true,
        isActive: true,
        professionalId: true,
        serviceId: true,
        offersInSalon: true,
        offersMobile: true,
        salonPriceStartingAt: true,
        salonDurationMinutes: true,
        mobilePriceStartingAt: true,
        mobileDurationMinutes: true,
        professional: { select: { timeZone: true } },
      },
    })

    if (!offering || !offering.isActive) {
      return NextResponse.json({ error: 'Offering not found or inactive.' }, { status: 404 })
    }

    // Validate locationType availability for this offering
    if (locationType === 'SALON' && !offering.offersInSalon) {
      return NextResponse.json({ error: 'This service is not offered in-salon.' }, { status: 409 })
    }
    if (locationType === 'MOBILE' && !offering.offersMobile) {
      return NextResponse.json({ error: 'This service is not offered as mobile.' }, { status: 409 })
    }

    const proTz =
      sanitizeTimeZone(pickString(body.proTimeZone) || offering.professional?.timeZone) ??
      DEFAULT_TZ

    // Convert scheduledFor to UTC Date
    let scheduledFor: Date | null = null

    if (hasExplicitOffsetOrZ(scheduledForRaw)) {
      const d = new Date(scheduledForRaw)
      scheduledFor = isValidDate(d) ? d : null
    } else {
      const d = zonedLocalToUtc(scheduledForRaw, proTz)
      scheduledFor = d && isValidDate(d) ? d : null
    }

    if (!scheduledFor) {
      return NextResponse.json(
        { error: 'Invalid scheduledFor. Use ISO with timezone (Z/offset) or local "YYYY-MM-DDTHH:mm" + proTimeZone.' },
        { status: 400 },
      )
    }

    const now = new Date()
    if (scheduledFor.getTime() < now.getTime() + MIN_LEAD_MINUTES * 60_000) {
      return NextResponse.json({ error: 'Pick a future time.' }, { status: 400 })
    }

    const maxLookahead = addMinutes(now, MAX_LOOKAHEAD_DAYS * 24 * 60)
    if (scheduledFor.getTime() > maxLookahead.getTime()) {
      return NextResponse.json({ error: `Pick a time within ${MAX_LOOKAHEAD_DAYS} days.` }, { status: 400 })
    }

    // Snapshot duration/price based on locationType
    const duration =
      locationType === 'SALON'
        ? Number(offering.salonDurationMinutes ?? 0)
        : Number(offering.mobileDurationMinutes ?? 0)

    if (!Number.isFinite(duration) || duration <= 0) {
      return NextResponse.json({ error: 'Offering duration is missing. Set a duration before booking.' }, { status: 409 })
    }

    const priceRaw =
      locationType === 'SALON' ? offering.salonPriceStartingAt : offering.mobilePriceStartingAt

    const priceSnapshot = normalizeDecimalInput(priceRaw)
    if (!priceSnapshot) {
      return NextResponse.json({ error: 'Offering price is missing. Set a price before booking.' }, { status: 409 })
    }

    const scheduledEnd = addMinutes(scheduledFor, duration)

    // Optional attribution inputs
    const rebookOfBookingId = pickString(body.rebookOfBookingId)
    const openingId = pickString(body.openingId)
    const aftercareToken = pickString(body.aftercareToken)

    // Everything that can race should happen in ONE transaction under an advisory lock.
    const created = await prisma.$transaction(async (tx) => {
      // 🔒 Serialize booking creation per professional to prevent double-booking under concurrency.
      const lockKey = `booking:${offering.professionalId}`
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`
      )

      // Validate aftercare token (prevents token abuse)
      if (aftercareToken) {
        const aftercare = await tx.aftercareSummary.findUnique({
          where: { publicToken: aftercareToken },
          select: { booking: { select: { clientId: true } } },
        })
        if (!aftercare?.booking || aftercare.booking.clientId !== user.clientProfile.id) {
          throw Object.assign(new Error('Invalid aftercare token.'), { statusCode: 403 })
        }
      }

      // If rebookOfBookingId is supplied, enforce it belongs to this client (and same pro is reasonable).
      if (rebookOfBookingId) {
        const original = await tx.booking.findUnique({
          where: { id: rebookOfBookingId },
          select: { id: true, clientId: true, professionalId: true, status: true },
        })
        if (!original || original.clientId !== user.clientProfile.id) {
          throw Object.assign(new Error('Invalid rebookOfBookingId.'), { statusCode: 403 })
        }
        // Optional: enforce same professional for aftercare-driven rebooks
        // If you want cross-pro rebooks, delete this.
        if (original.professionalId !== offering.professionalId) {
          throw Object.assign(new Error('Rebook must be with the same professional.'), { statusCode: 409 })
        }
      }

      // Optional: validate openingId if you have LastMinuteOpening model.
      // If you don’t have it yet, we ignore it safely.
      if (openingId) {
        try {
          const opening = await (tx as any).lastMinuteOpening?.findUnique?.({
            where: { id: openingId },
            select: { id: true, offeringId: true, professionalId: true, startAt: true, status: true },
          })
          if (opening) {
            if (opening.professionalId !== offering.professionalId || opening.offeringId !== offering.id) {
              throw Object.assign(new Error('openingId does not match this offering.'), { statusCode: 409 })
            }
            const oStart = new Date(opening.startAt)
            if (isValidDate(oStart) && Math.abs(oStart.getTime() - scheduledFor.getTime()) > 60_000) {
              throw Object.assign(new Error('Opening time does not match selected time.'), { statusCode: 409 })
            }
          }
        } catch {
          // If the model doesn’t exist or query fails, do not block booking.
          // You can tighten this later once your openings system is final.
        }
      }

      // Conflict check: pull bookings near the requested time and validate overlap in JS
      // Wide enough window to catch overlaps without scanning the whole calendar.
      const windowStart = addMinutes(scheduledFor, -24 * 60)
      const windowEnd = addMinutes(scheduledFor, 24 * 60)

      const existing = await tx.booking.findMany({
        where: {
          professionalId: offering.professionalId,
          scheduledFor: { gte: windowStart, lte: windowEnd },
          NOT: { status: 'CANCELLED' as any },
        },
        select: {
          id: true,
          scheduledFor: true,
          durationMinutesSnapshot: true,
          status: true,
        },
        orderBy: { scheduledFor: 'asc' },
        take: 500,
      })

      const hasConflict = existing.some((b) => {
        const bStart = new Date(b.scheduledFor)
        const bDur = Number(b.durationMinutesSnapshot || 0)
        if (!Number.isFinite(bDur) || bDur <= 0) return false
        const bEnd = addMinutes(bStart, bDur)
        return overlaps(bStart, bEnd, scheduledFor!, scheduledEnd)
      })

      if (hasConflict) {
        throw Object.assign(new Error('That time is no longer available.'), { statusCode: 409 })
      }

      // Create booking
      const booking = await tx.booking.create({
        data: {
          clientId: user.clientProfile.id,
          professionalId: offering.professionalId,
          serviceId: offering.serviceId,
          offeringId: offering.id,

          scheduledFor,
          durationMinutesSnapshot: duration,
          priceSnapshot, // Decimal required: string is fine

          status: 'PENDING' as any,
          source: source as any,
          locationType: locationType as any,

          ...(rebookOfBookingId ? { rebookOfBookingId } : {}),

          // Optional future-proof fields (only if you add them later)
          // scheduledEnd,
          // timeZoneSnapshot: proTz,
        } as any,
        select: { id: true, status: true, scheduledFor: true },
      })

      return booking
    })

    return NextResponse.json({ ok: true, booking: created }, { status: 200 })
  } catch (e: any) {
    const status = Number(e?.statusCode || 0)
    if (status) {
      return NextResponse.json({ error: e.message || 'Request failed.' }, { status })
    }

    console.error('POST /api/client/bookings/create error:', e)
    return NextResponse.json({ error: 'Failed to create booking.' }, { status: 500 })
  }
}
