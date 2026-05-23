// app/api/pro/locations/route.ts

import { Prisma, ProfessionalLocationType } from '@prisma/client'

import { requirePro } from '@/app/api/_utils/auth/requirePro'
import {
  clampInt,
  pickEnum,
  pickInt,
  pickNumber,
  pickString,
} from '@/app/api/_utils/pick'
import { enforceRateLimit, rateLimitIdentity } from '@/app/api/_utils/rateLimit'
import { jsonFail, jsonOk } from '@/app/api/_utils/responses'
import { bumpScheduleConfigVersion } from '@/lib/booking/cacheVersion'
import { hasOwn, isRecord, type UnknownRecord } from '@/lib/guards'
import { prisma } from '@/lib/prisma'
import { refreshLocation } from '@/lib/search/index/refreshSearchIndex'
import { buildAddressPrivacyWriteData } from '@/lib/security/addressEncryption'
import {
  defaultWorkingHours,
  normalizeWorkingHours,
  safeHoursFromDb,
  toInputJsonValue,
  type WorkingHoursObj,
} from '@/lib/scheduling/workingHoursValidation'
import { isValidIanaTimeZone } from '@/lib/timeZone'

export const dynamic = 'force-dynamic'

const LOCATION_SELECT = {
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
} satisfies Prisma.ProfessionalLocationSelect

type ProfessionalLocationRow = Prisma.ProfessionalLocationGetPayload<{
  select: typeof LOCATION_SELECT
}>

type ParsedAddressInput = {
  formattedAddress: string | null
  addressLine1: string | null
  addressLine2: string | null
  city: string | null
  state: string | null
  postalCode: string | null
  countryCode: string | null
  placeId: string | null
  latRaw: number | null | undefined
  lngRaw: number | null | undefined
}

type ParsedScheduleInput = {
  timeZone: string | null
  workingHours: WorkingHoursObj
  bufferMinutes: number | undefined
  stepMinutes: number | undefined
  advanceNoticeMinutes: number | undefined
  maxDaysAhead: number | undefined
}

function normalizeProfessionalLocationType(
  value: unknown,
): ProfessionalLocationType | null {
  return pickEnum(value, Object.values(ProfessionalLocationType))
}

function requiresAddressForBookableLocation(
  type: ProfessionalLocationType,
): boolean {
  return (
    type === ProfessionalLocationType.SALON ||
    type === ProfessionalLocationType.SUITE
  )
}

function decimalToNumber(value: unknown): number | null {
  if (value == null) return null

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }

  if (!isRecord(value)) return null

  const maybeToNumber = value.toNumber
  if (typeof maybeToNumber === 'function') {
    const parsed = maybeToNumber.call(value)
    return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null
  }

  const maybeToString = value.toString
  if (typeof maybeToString === 'function') {
    const parsed = Number(String(maybeToString.call(value)))
    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

function decimalOrNull(value: number | null | undefined): Prisma.Decimal | null {
  if (value == null) return null
  return new Prisma.Decimal(String(value))
}

function mapLocation(location: ProfessionalLocationRow) {
  return {
    ...location,
    lat: decimalToNumber(location.lat),
    lng: decimalToNumber(location.lng),
    workingHours: safeHoursFromDb(location.workingHours),
    createdAt: location.createdAt.toISOString(),
    updatedAt: location.updatedAt.toISOString(),
  }
}

function pickNullableString(
  body: UnknownRecord,
  key: string,
): string | null {
  return hasOwn(body, key) ? pickString(body[key]) : null
}

function parseNullableCoordinate(args: {
  body: UnknownRecord
  key: 'lat' | 'lng'
}): { ok: true; value: number | null | undefined } | { ok: false; error: string } {
  const { body, key } = args

  if (!hasOwn(body, key)) {
    return { ok: true, value: undefined }
  }

  if (body[key] === null) {
    return { ok: true, value: null }
  }

  const numberValue = pickNumber(body[key])

  if (numberValue == null) {
    return { ok: false, error: `${key} must be a number or null.` }
  }

  return { ok: true, value: numberValue }
}

function parseAddressInput(
  body: UnknownRecord,
): ParsedAddressInput | { error: string } {
  const lat = parseNullableCoordinate({ body, key: 'lat' })
  if (!lat.ok) return { error: lat.error }

  const lng = parseNullableCoordinate({ body, key: 'lng' })
  if (!lng.ok) return { error: lng.error }

  return {
    formattedAddress: pickNullableString(body, 'formattedAddress'),
    addressLine1: pickNullableString(body, 'addressLine1'),
    addressLine2: pickNullableString(body, 'addressLine2'),
    city: pickNullableString(body, 'city'),
    state: pickNullableString(body, 'state'),
    postalCode: pickNullableString(body, 'postalCode'),
    countryCode: pickNullableString(body, 'countryCode'),
    placeId: pickNullableString(body, 'placeId'),
    latRaw: lat.value,
    lngRaw: lng.value,
  }
}

function parseScheduleInput(
  body: UnknownRecord,
): ParsedScheduleInput | { error: string } {
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
    const normalized = normalizeWorkingHours(body.workingHours)

    if (!normalized) {
      return {
        error:
          'workingHours must contain mon..sun with { enabled, start, end }, valid HH:MM times, and end after start.',
      }
    }

    workingHours = normalized
  }

  return {
    timeZone,
    workingHours,
    bufferMinutes,
    stepMinutes,
    advanceNoticeMinutes,
    maxDaysAhead,
  }
}

function validateBookableLocation(args: {
  type: ProfessionalLocationType
  timeZone: string | null
  address: ParsedAddressInput
}): string | null {
  const { type, timeZone, address } = args

  if (!timeZone || !isValidIanaTimeZone(timeZone)) {
    return 'Bookable locations must have a valid IANA timeZone.'
  }

  const latNum = address.latRaw === undefined ? null : address.latRaw
  const lngNum = address.lngRaw === undefined ? null : address.lngRaw

  if (latNum == null || lngNum == null) {
    return 'Bookable locations must include lat/lng.'
  }

  if (
    requiresAddressForBookableLocation(type) &&
    (!address.placeId || !address.formattedAddress)
  ) {
    return 'Salon/Suite bookable locations require placeId and formattedAddress.'
  }

  return null
}

export async function GET() {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const locations = await prisma.professionalLocation.findMany({
      where: { professionalId: auth.professionalId },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      select: LOCATION_SELECT,
      take: 100,
    })

    return jsonOk({
      locations: locations.map(mapLocation),
    })
  } catch (error) {
    console.error('GET /api/pro/locations error', error)
    return jsonFail(500, 'Failed to load locations')
  }
}

export async function POST(req: Request) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const professionalId = auth.professionalId

    const limited = await enforceRateLimit({
      bucket: 'pro:locations:write',
      identity: await rateLimitIdentity(auth.userId),
    })

    if (limited) return limited

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

    const address = parseAddressInput(body)
    if ('error' in address) return jsonFail(400, address.error)

    const schedule = parseScheduleInput(body)
    if ('error' in schedule) return jsonFail(400, schedule.error)

    const willBookable = typeof isBookable === 'boolean' ? isBookable : false

    if (willBookable) {
      const validationError = validateBookableLocation({
        type,
        timeZone: schedule.timeZone,
        address,
      })

      if (validationError) {
        return jsonFail(400, validationError)
      }
    }

    const addressPrivacyData = buildAddressPrivacyWriteData({
      formattedAddress: address.formattedAddress,
      addressLine1: address.addressLine1,
      addressLine2: address.addressLine2,
      city: address.city,
      state: address.state,
      postalCode: address.postalCode,
      countryCode: address.countryCode,
      placeId: address.placeId,
      lat: address.latRaw,
      lng: address.lngRaw,
    })

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

          // Keep legacy/public columns in sync for current read compatibility.
          // The encrypted/search-safe fields below are the privacy boundary.
          formattedAddress: address.formattedAddress,
          addressLine1: address.addressLine1,
          addressLine2: address.addressLine2,
          city: address.city,
          state: address.state,
          postalCode: address.postalCode,
          countryCode: address.countryCode,
          placeId: address.placeId,

          lat: decimalOrNull(address.latRaw),
          lng: decimalOrNull(address.lngRaw),

          ...addressPrivacyData,

          timeZone: schedule.timeZone ?? null,
          workingHours: toInputJsonValue(schedule.workingHours),

          ...(schedule.bufferMinutes !== undefined
            ? { bufferMinutes: schedule.bufferMinutes }
            : {}),
          ...(schedule.stepMinutes !== undefined
            ? { stepMinutes: schedule.stepMinutes }
            : {}),
          ...(schedule.advanceNoticeMinutes !== undefined
            ? { advanceNoticeMinutes: schedule.advanceNoticeMinutes }
            : {}),
          ...(schedule.maxDaysAhead !== undefined
            ? { maxDaysAhead: schedule.maxDaysAhead }
            : {}),
        },
        select: LOCATION_SELECT,
      })
    })

    await bumpScheduleConfigVersion(professionalId)
    await refreshLocation(created.id, 'location.create')

    return jsonOk(
      {
        location: mapLocation(created),
      },
      201,
    )
  } catch (error) {
    console.error('POST /api/pro/locations error', error)
    return jsonFail(500, 'Failed to create location')
  }
}