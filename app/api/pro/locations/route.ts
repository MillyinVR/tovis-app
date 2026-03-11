// app/api/pro/locations/route.ts
import { prisma } from '@/lib/prisma'
import { Prisma, ProfessionalLocationType } from '@prisma/client'
import { jsonFail, jsonOk } from '@/app/api/_utils/responses'
import { requirePro } from '@/app/api/_utils/auth/requirePro'
import { isValidIanaTimeZone } from '@/lib/timeZone'
import { isRecord, type UnknownRecord, hasOwn } from '@/lib/guards'
import {
  clampInt,
  pickEnum,
  pickInt,
  pickNumber,
  pickString,
} from '@/app/api/_utils/pick'
import {
  defaultWorkingHours,
  normalizeWorkingHours,
  safeHoursFromDb,
  toInputJsonValue,
  type WorkingHoursObj,
} from '@/lib/scheduling/workingHoursValidation'

export const dynamic = 'force-dynamic'

function normalizeProfessionalLocationType(
  v: unknown,
): ProfessionalLocationType | null {
  return pickEnum(v, Object.values(ProfessionalLocationType))
}

function requireAddressForType(t: ProfessionalLocationType) {
  return (
    t === ProfessionalLocationType.SALON ||
    t === ProfessionalLocationType.SUITE
  )
}

function decimalToNumber(v: unknown): number | null {
  if (v == null) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null

  if (
    typeof v === 'object' &&
    typeof (v as { toNumber?: unknown }).toNumber === 'function'
  ) {
    const n = (v as { toNumber: () => number }).toNumber()
    return Number.isFinite(n) ? n : null
  }

  if (
    typeof v === 'object' &&
    typeof (v as { toString?: unknown }).toString === 'function'
  ) {
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
      locations: locations.map((location) => ({
        ...location,
        lat: decimalToNumber(location.lat),
        lng: decimalToNumber(location.lng),
        workingHours: safeHoursFromDb(location.workingHours),
        createdAt: location.createdAt.toISOString(),
        updatedAt: location.updatedAt.toISOString(),
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

    const isBookable = hasOwn(body, 'isBookable')
      ? body.isBookable
      : undefined
    if (isBookable !== undefined && typeof isBookable !== 'boolean') {
      return jsonFail(400, 'isBookable must be boolean.')
    }

    const wantsPrimary = hasOwn(body, 'isPrimary') ? body.isPrimary : undefined
    if (wantsPrimary !== undefined && typeof wantsPrimary !== 'boolean') {
      return jsonFail(400, 'isPrimary must be boolean.')
    }

    const formattedAddress = hasOwn(body, 'formattedAddress')
      ? pickString(body.formattedAddress)
      : null
    const addressLine1 = hasOwn(body, 'addressLine1')
      ? pickString(body.addressLine1)
      : null
    const addressLine2 = hasOwn(body, 'addressLine2')
      ? pickString(body.addressLine2)
      : null
    const city = hasOwn(body, 'city') ? pickString(body.city) : null
    const state = hasOwn(body, 'state') ? pickString(body.state) : null
    const postalCode = hasOwn(body, 'postalCode')
      ? pickString(body.postalCode)
      : null
    const countryCode = hasOwn(body, 'countryCode')
      ? pickString(body.countryCode)
      : null
    const placeId = hasOwn(body, 'placeId') ? pickString(body.placeId) : null

    let latRaw: number | null | undefined
    if (hasOwn(body, 'lat')) {
      if (body.lat === null) {
        latRaw = null
      } else {
        const n = pickNumber(body.lat)
        if (n == null) return jsonFail(400, 'lat must be a number or null.')
        latRaw = n
      }
    }

    let lngRaw: number | null | undefined
    if (hasOwn(body, 'lng')) {
      if (body.lng === null) {
        lngRaw = null
      } else {
        const n = pickNumber(body.lng)
        if (n == null) return jsonFail(400, 'lng must be a number or null.')
        lngRaw = n
      }
    }

    const timeZone = hasOwn(body, 'timeZone')
      ? pickString(body.timeZone)
      : null

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
      const normalized = normalizeWorkingHours(body.workingHours)
      if (!normalized) {
        return jsonFail(
          400,
          'workingHours must contain mon..sun with { enabled, start, end }, valid HH:MM times, and end after start.',
        )
      }
      workingHours = normalized
    }

    const willBookable = typeof isBookable === 'boolean' ? isBookable : false

    if (willBookable) {
      if (!timeZone || !isValidIanaTimeZone(timeZone)) {
        return jsonFail(
          400,
          'Bookable locations must have a valid IANA timeZone.',
        )
      }

      const latNum = latRaw === undefined ? null : latRaw
      const lngNum = lngRaw === undefined ? null : lngRaw

      if (latNum == null || lngNum == null) {
        return jsonFail(400, 'Bookable locations must include lat/lng.')
      }

      if (requireAddressForType(type)) {
        if (!placeId || !formattedAddress) {
          return jsonFail(
            400,
            'Salon/Suite bookable locations require placeId and formattedAddress.',
          )
        }
      }
    }

    const created = await prisma.$transaction(async (tx) => {
      const existingCount = await tx.professionalLocation.count({
        where: { professionalId },
      })

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
          ...(advanceNoticeMinutes !== undefined
            ? { advanceNoticeMinutes }
            : {}),
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
    console.error('POST /api/pro/locations error', e)
    return jsonFail(500, 'Failed to create location')
  }
}