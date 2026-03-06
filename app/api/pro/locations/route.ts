// app/api/pro/locations/route.ts
import { prisma } from '@/lib/prisma'
import { Prisma, ProfessionalLocationType } from '@prisma/client'
import { jsonFail, jsonOk } from '@/app/api/_utils/responses'
import { requirePro } from '@/app/api/_utils/auth/requirePro'
import { isValidIanaTimeZone } from '@/lib/timeZone'
import { isRecord, type UnknownRecord, hasOwn } from '@/lib/guards'
import { clampInt, pickEnum, pickInt, pickNumber, pickString } from '@/app/api/_utils/pick'
import { hhmmToMinutes, parseHHMM } from '@/lib/scheduling/workingHours'

export const dynamic = 'force-dynamic'

function normalizeProfessionalLocationType(v: unknown): ProfessionalLocationType | null {
  return pickEnum(v, Object.values(ProfessionalLocationType))
}

function requireAddressForType(t: ProfessionalLocationType) {
  return t === ProfessionalLocationType.SALON || t === ProfessionalLocationType.SUITE
}

/* ----------------------------
   Working hours validation
---------------------------- */

type WeekdayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'
type WorkingHoursDay = { enabled: boolean; start: string; end: string }
type WorkingHoursObj = Record<WeekdayKey, WorkingHoursDay>

const DAYS: WeekdayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

function defaultWorkingHours(): WorkingHoursObj {
  const make = (enabled: boolean): WorkingHoursDay => ({ enabled, start: '09:00', end: '17:00' })
  return {
    mon: make(true),
    tue: make(true),
    wed: make(true),
    thu: make(true),
    fri: make(true),
    sat: make(false),
    sun: make(false),
  }
}

function normalizeHHMM(v: unknown): string | null {
  const parsed = parseHHMM(v)
  if (!parsed) return null
  return `${String(parsed.hh).padStart(2, '0')}:${String(parsed.mm).padStart(2, '0')}`
}

function isValidWorkingHoursDay(v: unknown): v is WorkingHoursDay {
  if (!isRecord(v)) return false
  if (typeof v.enabled !== 'boolean') return false
  if (typeof v.start !== 'string' || typeof v.end !== 'string') return false

  const start = normalizeHHMM(v.start)
  const end = normalizeHHMM(v.end)
  if (!start || !end) return false

  const startMinutes = hhmmToMinutes(start)
  const endMinutes = hhmmToMinutes(end)
  if (startMinutes == null || endMinutes == null) return false

  return endMinutes > startMinutes
}

function looksLikeWorkingHours(v: unknown): v is WorkingHoursObj {
  if (!isRecord(v)) return false

  for (const d of DAYS) {
    if (!isValidWorkingHoursDay(v[d])) return false
  }

  return true
}

function normalizeWorkingHoursDay(day: WorkingHoursDay): WorkingHoursDay {
  const start = normalizeHHMM(day.start)
  const end = normalizeHHMM(day.end)

  if (!start || !end) {
    throw new Error('INVALID_WORKING_HOURS')
  }

  const startMinutes = hhmmToMinutes(start)
  const endMinutes = hhmmToMinutes(end)
  if (startMinutes == null || endMinutes == null || endMinutes <= startMinutes) {
    throw new Error('INVALID_WORKING_HOURS')
  }

  return {
    enabled: day.enabled,
    start,
    end,
  }
}

function normalizeWorkingHours(raw: WorkingHoursObj): WorkingHoursObj {
  return {
    mon: normalizeWorkingHoursDay(raw.mon),
    tue: normalizeWorkingHoursDay(raw.tue),
    wed: normalizeWorkingHoursDay(raw.wed),
    thu: normalizeWorkingHoursDay(raw.thu),
    fri: normalizeWorkingHoursDay(raw.fri),
    sat: normalizeWorkingHoursDay(raw.sat),
    sun: normalizeWorkingHoursDay(raw.sun),
  }
}

function safeHoursFromDb(raw: unknown): WorkingHoursObj {
  if (!looksLikeWorkingHours(raw)) return defaultWorkingHours()
  return normalizeWorkingHours(raw)
}

function toInputJsonValue(hours: WorkingHoursObj): Prisma.InputJsonValue {
  return {
    mon: { enabled: hours.mon.enabled, start: hours.mon.start, end: hours.mon.end },
    tue: { enabled: hours.tue.enabled, start: hours.tue.start, end: hours.tue.end },
    wed: { enabled: hours.wed.enabled, start: hours.wed.start, end: hours.wed.end },
    thu: { enabled: hours.thu.enabled, start: hours.thu.start, end: hours.thu.end },
    fri: { enabled: hours.fri.enabled, start: hours.fri.start, end: hours.fri.end },
    sat: { enabled: hours.sat.enabled, start: hours.sat.start, end: hours.sat.end },
    sun: { enabled: hours.sun.enabled, start: hours.sun.start, end: hours.sun.end },
  } satisfies Prisma.InputJsonObject
}

function decimalToNumber(v: unknown): number | null {
  if (v == null) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'object' && typeof (v as { toNumber?: unknown }).toNumber === 'function') {
    const n = (v as { toNumber: () => number }).toNumber()
    return Number.isFinite(n) ? n : null
  }
  if (typeof v === 'object' && typeof (v as { toString?: unknown }).toString === 'function') {
    const n = Number((v as { toString: () => string }).toString())
    return Number.isFinite(n) ? n : null
  }
  return null
}

/* ----------------------------
   GET
---------------------------- */

export async function GET() {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const professionalId = auth.professionalId

    const locations = await prisma.professionalLocation.findMany({
      where: { professionalId },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        type: true,
        name: true,
        isPrimary: true,
        isBookable: true,

        formattedAddress: true,
        addressLine1: true,
        addressLine2: true,
        city: true,
        state: true,
        postalCode: true,
        countryCode: true,
        placeId: true,

        lat: true,
        lng: true,

        timeZone: true,
        workingHours: true,

        bufferMinutes: true,
        stepMinutes: true,
        advanceNoticeMinutes: true,
        maxDaysAhead: true,

        createdAt: true,
        updatedAt: true,
      },
      take: 100,
    })

    return jsonOk({
      locations: locations.map((l) => ({
        ...l,
        lat: decimalToNumber(l.lat),
        lng: decimalToNumber(l.lng),
        workingHours: safeHoursFromDb(l.workingHours),
        createdAt: l.createdAt.toISOString(),
        updatedAt: l.updatedAt.toISOString(),
      })),
    })
  } catch (e) {
    console.error('GET /api/pro/locations error', e)
    return jsonFail(500, 'Failed to load locations')
  }
}

/* ----------------------------
   POST
---------------------------- */

export async function POST(req: Request) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const professionalId = auth.professionalId

    const raw: unknown = await req.json().catch(() => ({}))
    const body: UnknownRecord = isRecord(raw) ? raw : {}

    const type = normalizeProfessionalLocationType(body.type)
    if (!type) return jsonFail(400, 'Missing/invalid type.')

    const name = hasOwn(body, 'name') ? pickString(body.name) : null

    const isBookable = hasOwn(body, 'isBookable') ? body.isBookable : undefined
    if (isBookable !== undefined && typeof isBookable !== 'boolean') {
      return jsonFail(400, 'isBookable must be boolean.')
    }

    const wantsPrimary = hasOwn(body, 'isPrimary') ? body.isPrimary : undefined
    if (wantsPrimary !== undefined && typeof wantsPrimary !== 'boolean') {
      return jsonFail(400, 'isPrimary must be boolean.')
    }

    const formattedAddress = hasOwn(body, 'formattedAddress') ? pickString(body.formattedAddress) : null
    const addressLine1 = hasOwn(body, 'addressLine1') ? pickString(body.addressLine1) : null
    const addressLine2 = hasOwn(body, 'addressLine2') ? pickString(body.addressLine2) : null
    const city = hasOwn(body, 'city') ? pickString(body.city) : null
    const state = hasOwn(body, 'state') ? pickString(body.state) : null
    const postalCode = hasOwn(body, 'postalCode') ? pickString(body.postalCode) : null
    const countryCode = hasOwn(body, 'countryCode') ? pickString(body.countryCode) : null
    const placeId = hasOwn(body, 'placeId') ? pickString(body.placeId) : null

    let latRaw: number | null | undefined = undefined
    if (hasOwn(body, 'lat')) {
      if (body.lat === null) {
        latRaw = null
      } else {
        const n = pickNumber(body.lat)
        if (n == null) return jsonFail(400, 'lat must be a number or null.')
        latRaw = n
      }
    }

    let lngRaw: number | null | undefined = undefined
    if (hasOwn(body, 'lng')) {
      if (body.lng === null) {
        lngRaw = null
      } else {
        const n = pickNumber(body.lng)
        if (n == null) return jsonFail(400, 'lng must be a number or null.')
        lngRaw = n
      }
    }

    const timeZone = hasOwn(body, 'timeZone') ? pickString(body.timeZone) : null

    const bufferMinutes = hasOwn(body, 'bufferMinutes')
      ? clampInt(pickInt(body.bufferMinutes) ?? 0, 0, 180)
      : undefined

    const stepMinutes = hasOwn(body, 'stepMinutes')
      ? clampInt(pickInt(body.stepMinutes) ?? 15, 5, 60)
      : undefined

    const advanceNoticeMinutes = hasOwn(body, 'advanceNoticeMinutes')
      ? clampInt(pickInt(body.advanceNoticeMinutes) ?? 15, 0, 30 * 24 * 60)
      : undefined

    const maxDaysAhead = hasOwn(body, 'maxDaysAhead')
      ? clampInt(pickInt(body.maxDaysAhead) ?? 365, 1, 3650)
      : undefined

    let workingHours: WorkingHoursObj = defaultWorkingHours()
    if (hasOwn(body, 'workingHours')) {
      if (!looksLikeWorkingHours(body.workingHours)) {
        return jsonFail(
          400,
          'workingHours must contain mon..sun with { enabled, start, end }, valid HH:MM times, and end after start.',
        )
      }
      workingHours = normalizeWorkingHours(body.workingHours)
    }

    const willBookable = typeof isBookable === 'boolean' ? isBookable : false

    if (willBookable) {
      if (!timeZone || !isValidIanaTimeZone(timeZone)) {
        return jsonFail(400, 'Bookable locations must have a valid IANA timeZone.')
      }

      const latNum = latRaw === undefined ? null : latRaw
      const lngNum = lngRaw === undefined ? null : lngRaw
      if (latNum == null || lngNum == null) {
        return jsonFail(400, 'Bookable locations must include lat/lng.')
      }

      if (requireAddressForType(type)) {
        if (!placeId || !formattedAddress) {
          return jsonFail(400, 'Salon/Suite bookable locations require placeId and formattedAddress.')
        }
      }
    }

    const created = await prisma.$transaction(async (tx) => {
      const existingCount = await tx.professionalLocation.count({ where: { professionalId } })
      const isFirst = existingCount === 0
      const willPrimary = isFirst ? true : Boolean(wantsPrimary)

      if (willPrimary) {
        await tx.professionalLocation.updateMany({
          where: { professionalId, isPrimary: true },
          data: { isPrimary: false },
        })
      }

      return tx.professionalLocation.create({
        data: {
          professionalId,
          type,
          name,

          isPrimary: willPrimary,
          isBookable: willBookable,

          formattedAddress,
          addressLine1,
          addressLine2,
          city,
          state,
          postalCode,
          countryCode,
          placeId,

          lat: latRaw == null ? null : new Prisma.Decimal(String(latRaw)),
          lng: lngRaw == null ? null : new Prisma.Decimal(String(lngRaw)),

          timeZone: timeZone ?? null,
          workingHours: toInputJsonValue(workingHours),

          ...(bufferMinutes !== undefined ? { bufferMinutes } : {}),
          ...(stepMinutes !== undefined ? { stepMinutes } : {}),
          ...(advanceNoticeMinutes !== undefined ? { advanceNoticeMinutes } : {}),
          ...(maxDaysAhead !== undefined ? { maxDaysAhead } : {}),
        },
        select: {
          id: true,
          type: true,
          name: true,
          isPrimary: true,
          isBookable: true,
          formattedAddress: true,
          addressLine1: true,
          addressLine2: true,
          city: true,
          state: true,
          postalCode: true,
          countryCode: true,
          placeId: true,
          lat: true,
          lng: true,
          timeZone: true,
          workingHours: true,
          bufferMinutes: true,
          stepMinutes: true,
          advanceNoticeMinutes: true,
          maxDaysAhead: true,
          createdAt: true,
          updatedAt: true,
        },
      })
    })

    return jsonOk(
      {
        location: {
          ...created,
          lat: decimalToNumber(created.lat),
          lng: decimalToNumber(created.lng),
          workingHours: safeHoursFromDb(created.workingHours),
          createdAt: created.createdAt.toISOString(),
          updatedAt: created.updatedAt.toISOString(),
        },
      },
      201,
    )
  } catch (e) {
    if (e instanceof Error && e.message === 'INVALID_WORKING_HOURS') {
      return jsonFail(
        400,
        'workingHours must contain valid HH:MM times and each day must have end after start.',
      )
    }

    console.error('POST /api/pro/locations error', e)
    return jsonFail(500, 'Failed to create location')
  }
}