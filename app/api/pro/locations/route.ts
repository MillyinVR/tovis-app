// app/api/pro/locations/route.ts
import { prisma } from '@/lib/prisma'
import { Prisma, ProfessionalLocationType } from '@prisma/client'
import { jsonFail, jsonOk } from '@/app/api/_utils/responses'
import { requirePro } from '@/app/api/_utils/auth/requirePro'
import { isValidIanaTimeZone } from '@/lib/timeZone'
import { isRecord, type UnknownRecord, hasOwn } from '@/lib/guards'
import { clampInt, pickEnum, pickInt, pickNumber, pickString } from '@/app/api/_utils/pick'

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

/** Accepts "9:00" or "09:00" -> returns "HH:MM" */
function normalizeHHMM(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : ''
  const m = /^(\d{1,2}):(\d{2})$/.exec(s)
  if (!m) return null
  const hh = Number(m[1])
  const mm = Number(m[2])
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

function looksLikeWorkingHours(v: unknown): v is WorkingHoursObj {
  if (!isRecord(v)) return false
  for (const d of DAYS) {
    const day = v[d]
    if (!isRecord(day)) return false
    if (typeof day.enabled !== 'boolean') return false
    if (typeof day.start !== 'string' || typeof day.end !== 'string') return false
  }
  return true
}

function normalizeWorkingHours(raw: WorkingHoursObj): WorkingHoursObj {
  const fallback = defaultWorkingHours()
  const out: WorkingHoursObj = { ...fallback }

  for (const d of DAYS) {
    const src = raw[d]
    const start = normalizeHHMM(src?.start) ?? fallback[d].start
    const end = normalizeHHMM(src?.end) ?? fallback[d].end
    out[d] = { enabled: Boolean(src?.enabled), start, end }
  }

  return out
}

/**
 * Prisma JSON boundary cast (exception-with-receipts).
 * Our WorkingHoursObj is valid JSON; TS doesn’t prove it.
 */
function toInputJsonValue(hours: WorkingHoursObj): Prisma.InputJsonValue {
  return hours as unknown as Prisma.InputJsonValue
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

    // safer default: create drafts unless client explicitly marks bookable
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

    // lat/lng accept: number OR string number OR null (explicit clear)
    let latRaw: number | null | undefined = undefined
    if (hasOwn(body, 'lat')) {
      if (body.lat === null) latRaw = null
      else {
        const n = pickNumber(body.lat)
        if (n == null) return jsonFail(400, 'lat must be a number or null')
        latRaw = n
      }
    }

    let lngRaw: number | null | undefined = undefined
    if (hasOwn(body, 'lng')) {
      if (body.lng === null) lngRaw = null
      else {
        const n = pickNumber(body.lng)
        if (n == null) return jsonFail(400, 'lng must be a number or null')
        lngRaw = n
      }
    }

    const timeZone = hasOwn(body, 'timeZone') ? pickString(body.timeZone) : null

    // optional schedule knobs (fallbacks mirror original behavior)
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

    // workingHours (optional)
    let workingHours: WorkingHoursObj = defaultWorkingHours()
    if (hasOwn(body, 'workingHours')) {
      if (!looksLikeWorkingHours(body.workingHours)) {
        return jsonFail(400, 'workingHours must be an object with mon..sun: { enabled, start, end }.')
      }
      workingHours = normalizeWorkingHours(body.workingHours)
    }

    const willBookable = typeof isBookable === 'boolean' ? isBookable : false

    // If bookable, timezone MUST be valid
    if (willBookable) {
      if (!timeZone || !isValidIanaTimeZone(timeZone)) {
        return jsonFail(400, 'Bookable locations must have a valid IANA timeZone (e.g. America/Los_Angeles).')
      }

      // If bookable, always require lat/lng (availability + nearby pros depends on it)
      const latNum = latRaw === undefined ? null : latRaw
      const lngNum = lngRaw === undefined ? null : lngRaw
      if (latNum == null || lngNum == null) {
        return jsonFail(400, 'Bookable locations must include lat/lng.')
      }

      // If salon/suite and bookable, require address bits
      if (requireAddressForType(type)) {
        if (!placeId || !formattedAddress) {
          return jsonFail(400, 'Salon/Suite bookable locations require placeId + formattedAddress.')
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

      const row = await tx.professionalLocation.create({
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
          isPrimary: true,
          isBookable: true,
          timeZone: true,
          createdAt: true,
          updatedAt: true,
        },
      })

      return row
    })

    return jsonOk(
      {
        location: {
          ...created,
          createdAt: created.createdAt.toISOString(),
          updatedAt: created.updatedAt.toISOString(),
        },
      },
      201,
    )
  } catch (e) {
    console.error('POST /api/pro/locations error', e)
    return jsonFail(500, 'Failed to create location')
  }
}