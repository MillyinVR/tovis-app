// app/api/availability/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/** ===== Types (minimal, just enough to stop TS whining) ===== */

type BookingForBusy = {
  scheduledFor: Date
  durationMinutesSnapshot: number | null
}

type BusyInterval = { start: Date; end: Date }

type ProfessionalForAvailability = {
  id: string
  businessName: string | null
  avatarUrl: string | null
  location: string | null
  city: string | null
  timeZone: string | null
  workingHours: any | null
}

type OfferingForOtherPros = {
  id: string
  price: any
  durationMinutes: number | null
  professional: ProfessionalForAvailability | null
}

/** ===== Helpers ===== */

function pickString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function toInt(value: string | null, fallback: number) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function addMinutes(d: Date, minutes: number) {
  return new Date(d.getTime() + minutes * 60_000)
}

/** existingStart < requestedEnd AND requestedStart < existingEnd */
function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && bStart < aEnd
}

/**
 * Get "wall clock" parts for a UTC Date rendered in a given IANA timezone.
 */
function getZonedParts(dateUtc: Date, timeZone: string) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })

  const parts = dtf.formatToParts(dateUtc)
  const map: Record<string, string> = {}
  for (const p of parts) map[p.type] = p.value

  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  }
}

/**
 * Offset minutes between UTC and tz at a given UTC instant.
 * Positive means tz is ahead of UTC.
 */
function getTimeZoneOffsetMinutes(dateUtc: Date, timeZone: string) {
  const z = getZonedParts(dateUtc, timeZone)
  const asIfUtc = Date.UTC(z.year, z.month - 1, z.day, z.hour, z.minute, z.second)
  return Math.round((asIfUtc - dateUtc.getTime()) / 60_000)
}

/**
 * Convert a wall-clock time in timeZone into UTC Date (two-pass for DST).
 */
function zonedTimeToUtc(args: {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  timeZone: string
}) {
  const { year, month, day, hour, minute, timeZone } = args

  let guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0))
  const offset1 = getTimeZoneOffsetMinutes(guess, timeZone)
  guess = new Date(guess.getTime() - offset1 * 60_000)

  const offset2 = getTimeZoneOffsetMinutes(guess, timeZone)
  if (offset2 !== offset1) {
    guess = new Date(guess.getTime() - (offset2 - offset1) * 60_000)
  }

  return guess
}

/**
 * Calendar date math (treat as date, not instant).
 */
function addDaysToYMD(year: number, month: number, day: number, daysToAdd: number) {
  const d = new Date(Date.UTC(year, month - 1, day + daysToAdd, 12, 0, 0, 0))
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }
}

function parseHHMM(s: string) {
  const m = /^(\d{2}):(\d{2})$/.exec(s)
  if (!m) return null
  const hh = Number(m[1])
  const mm = Number(m[2])
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null
  return { hh, mm }
}

function getDayKeyFromUtc(dateUtc: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' })
  const w = fmt.format(dateUtc).toLowerCase()
  if (w.startsWith('sun')) return 'sun'
  if (w.startsWith('mon')) return 'mon'
  if (w.startsWith('tue')) return 'tue'
  if (w.startsWith('wed')) return 'wed'
  if (w.startsWith('thu')) return 'thu'
  if (w.startsWith('fri')) return 'fri'
  return 'sat'
}

/**
 * Compute upcoming slots in professional timezone working hours,
 * but return them as UTC ISO strings (what you store).
 */
async function computeNextSlots(args: {
  professionalId: string
  durationMinutes: number
  limit: number
  timeZone: string
  workingHours?: any | null
}) {
  const { professionalId, durationMinutes, limit, timeZone, workingHours } = args

  const nowUtc = new Date()
  const horizonUtc = addMinutes(nowUtc, 10 * 24 * 60) // 10 days
  const bufferMinutes = 10
  const stepMinutes = 30

  const bookings = (await prisma.booking.findMany({
    where: {
      professionalId,
      scheduledFor: { gte: nowUtc, lte: horizonUtc },
      NOT: { status: 'CANCELLED' as any },
    },
    select: { scheduledFor: true, durationMinutesSnapshot: true },
    take: 2000,
  })) as BookingForBusy[]

  const busy: BusyInterval[] = bookings.map((b: BookingForBusy) => {
    const start = new Date(b.scheduledFor)
    const dur = Number(b.durationMinutesSnapshot) || durationMinutes
    const end = addMinutes(start, dur)
    return { start, end }
  })

  const fallback = { enabled: true, start: '09:00', end: '18:00' }
  const wh = workingHours && typeof workingHours === 'object' ? workingHours : null

  const proNowParts = getZonedParts(nowUtc, timeZone)

  const out: string[] = []

  for (let dayOffset = 0; dayOffset <= 10 && out.length < limit; dayOffset++) {
    const ymd = addDaysToYMD(proNowParts.year, proNowParts.month, proNowParts.day, dayOffset)

    // pick weekday rule using noon in pro tz
    const noonUtc = zonedTimeToUtc({
      year: ymd.year,
      month: ymd.month,
      day: ymd.day,
      hour: 12,
      minute: 0,
      timeZone,
    })
    const dayKey = getDayKeyFromUtc(noonUtc, timeZone)
    const rule = wh && wh[dayKey] ? wh[dayKey] : fallback

    if (rule?.enabled === false) continue

    const startParsed = parseHHMM(String(rule?.start ?? fallback.start)) ?? parseHHMM(fallback.start)!
    const endParsed = parseHHMM(String(rule?.end ?? fallback.end)) ?? parseHHMM(fallback.end)!

    const startMinute = startParsed.hh * 60 + startParsed.mm
    const endMinute = endParsed.hh * 60 + endParsed.mm
    if (endMinute <= startMinute) continue

    for (let minute = startMinute; minute + durationMinutes <= endMinute; minute += stepMinutes) {
      if (out.length >= limit) break

      const hh = Math.floor(minute / 60)
      const mm = minute % 60

      const slotStartUtc = zonedTimeToUtc({
        year: ymd.year,
        month: ymd.month,
        day: ymd.day,
        hour: hh,
        minute: mm,
        timeZone,
      })

      if (slotStartUtc.getTime() < addMinutes(nowUtc, bufferMinutes).getTime()) continue
      if (slotStartUtc.getTime() > horizonUtc.getTime()) continue

      const slotEndUtc = addMinutes(slotStartUtc, durationMinutes)

      const conflict = busy.some((bi: BusyInterval) => overlaps(slotStartUtc, slotEndUtc, bi.start, bi.end))
      if (conflict) continue

      out.push(slotStartUtc.toISOString())
    }
  }

  return out
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)

    const professionalId = pickString(searchParams.get('professionalId'))
    const serviceId = pickString(searchParams.get('serviceId'))
    const mediaId = pickString(searchParams.get('mediaId'))

    const limit = Math.min(toInt(searchParams.get('limit'), 6) || 6, 12)
    const otherProsLimit = Math.min(toInt(searchParams.get('otherProsLimit'), 6) || 6, 12)

    if (!professionalId) {
      return NextResponse.json({ error: 'Missing professionalId' }, { status: 400 })
    }

    const creator = (await prisma.professionalProfile.findUnique({
      where: { id: professionalId },
      select: {
        id: true,
        businessName: true,
        avatarUrl: true,
        location: true,
        city: true,
        timeZone: true,
        workingHours: true,
      } as any,
    })) as ProfessionalForAvailability | null

    if (!creator) {
      return NextResponse.json({ error: 'Professional not found' }, { status: 404 })
    }

    const creatorTimeZone = creator.timeZone || 'America/Los_Angeles'

    const creatorOffering = serviceId
      ? await prisma.professionalServiceOffering.findFirst({
          where: { professionalId, serviceId, isActive: true },
          select: { id: true, price: true, durationMinutes: true },
        })
      : null

    const creatorDuration = creatorOffering?.durationMinutes ?? 60

    const creatorSlots = await computeNextSlots({
      professionalId,
      durationMinutes: creatorDuration,
      limit,
      timeZone: creatorTimeZone,
      workingHours: creator.workingHours ?? null,
    })

    let otherPros: Array<any> = []
    if (serviceId) {
      const offerings = (await prisma.professionalServiceOffering.findMany({
        where: {
          serviceId,
          isActive: true,
          professionalId: { not: professionalId },
        },
        take: otherProsLimit,
        select: {
          id: true,
          price: true,
          durationMinutes: true,
          professional: {
            select: {
              id: true,
              businessName: true,
              avatarUrl: true,
              location: true,
              city: true,
              timeZone: true,
              workingHours: true,
            },
          },
        },
      })) as OfferingForOtherPros[]

      otherPros = (
        await Promise.all(
          offerings.map(async (o: OfferingForOtherPros) => {
            const p = o.professional
            if (!p?.id) return null

            const pTz = p.timeZone || 'America/Los_Angeles'
            const slots = await computeNextSlots({
              professionalId: String(p.id),
              durationMinutes: o.durationMinutes ?? 60,
              limit: Math.min(4, limit),
              timeZone: pTz,
              workingHours: p.workingHours ?? null,
            })

            return {
              id: String(p.id),
              businessName: p.businessName ?? null,
              avatarUrl: p.avatarUrl ?? null,
              location: p.location ?? p.city ?? null,
              offeringId: o.id,
              price: o.price,
              durationMinutes: o.durationMinutes,
              slots,
              timeZone: pTz,
            }
          }),
        )
      ).filter(Boolean)
    }

    return NextResponse.json({
      mediaId: mediaId ?? null,
      serviceId: serviceId ?? null,

      // timezone for the primary pro (creator)
      timeZone: creatorTimeZone,

      primaryPro: {
        id: creator.id,
        businessName: creator.businessName ?? null,
        avatarUrl: creator.avatarUrl ?? null,
        location: creator.location ?? creator.city ?? null,
        offeringId: creatorOffering?.id ?? null,
        price: creatorOffering?.price ?? null,
        durationMinutes: creatorOffering?.durationMinutes ?? null,
        slots: creatorSlots,
        isCreator: true,
        timeZone: creatorTimeZone,
      },
      otherPros,
      waitlistSupported: true,
    })
  } catch (e) {
    console.error('GET /api/availability error', e)
    return NextResponse.json({ error: 'Failed to load availability' }, { status: 500 })
  }
}
