// lib/proLocations/locationInput.ts

import { Prisma, ProfessionalLocationType } from '@prisma/client'

import {
  clampInt,
  pickEnum,
  pickInt,
  pickNumber,
  pickString,
} from '@/app/api/_utils/pick'
import { hasOwn, isRecord, type UnknownRecord } from '@/lib/guards'
import {
  defaultWorkingHours,
  normalizeWorkingHours,
  safeHoursFromDb,
  toInputJsonValue,
  type WorkingHoursObj,
} from '@/lib/scheduling/workingHoursValidation'
import { isValidIanaTimeZone } from '@/lib/timeZone'

export const PROFESSIONAL_LOCATION_SELECT = {
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

export type ProfessionalLocationRow = Prisma.ProfessionalLocationGetPayload<{
  select: typeof PROFESSIONAL_LOCATION_SELECT
}>

export type ParsedProfessionalLocationAddressInput = {
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

export type ParsedProfessionalLocationScheduleInput = {
  timeZone: string | null
  workingHours: WorkingHoursObj
  bufferMinutes: number | undefined
  stepMinutes: number | undefined
  advanceNoticeMinutes: number | undefined
  maxDaysAhead: number | undefined
}

export type ParseProfessionalLocationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string }

export function normalizeProfessionalLocationType(
  value: unknown,
): ProfessionalLocationType | null {
  return pickEnum(value, Object.values(ProfessionalLocationType))
}

export function requiresAddressForBookableProfessionalLocation(
  type: ProfessionalLocationType,
): boolean {
  return (
    type === ProfessionalLocationType.SALON ||
    type === ProfessionalLocationType.SUITE
  )
}

export function professionalLocationDecimalToNumber(
  value: unknown,
): number | null {
  if (value == null) return null

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }

  if (!isRecord(value)) return null

  const maybeToNumber = value.toNumber
  if (typeof maybeToNumber === 'function') {
    const parsed = maybeToNumber.call(value)
    return typeof parsed === 'number' && Number.isFinite(parsed)
      ? parsed
      : null
  }

  const maybeToString = value.toString
  if (typeof maybeToString === 'function') {
    const parsed = Number(String(maybeToString.call(value)))
    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

export function professionalLocationNumberToDecimalOrNull(
  value: number | null | undefined,
): Prisma.Decimal | null {
  if (value == null) return null
  return new Prisma.Decimal(String(value))
}

export function mapProfessionalLocation(location: ProfessionalLocationRow) {
  return {
    ...location,
    lat: professionalLocationDecimalToNumber(location.lat),
    lng: professionalLocationDecimalToNumber(location.lng),
    workingHours: safeHoursFromDb(location.workingHours),
    createdAt: location.createdAt.toISOString(),
    updatedAt: location.updatedAt.toISOString(),
  }
}

export function pickNullableProfessionalLocationString(
  body: UnknownRecord,
  key: string,
): string | null {
  return hasOwn(body, key) ? pickString(body[key]) : null
}

export function parseNullableProfessionalLocationCoordinate(args: {
  body: UnknownRecord
  key: 'lat' | 'lng'
}): ParseProfessionalLocationResult<number | null | undefined> {
  const { body, key } = args

  if (!hasOwn(body, key)) {
    return { ok: true, value: undefined }
  }

  if (body[key] === null) {
    return { ok: true, value: null }
  }

  const numberValue = pickNumber(body[key])

  if (numberValue == null || !Number.isFinite(numberValue)) {
    return { ok: false, error: `${key} must be a number or null.` }
  }

  return { ok: true, value: numberValue }
}

export function parseProfessionalLocationAddressInput(
  body: UnknownRecord,
): ParseProfessionalLocationResult<ParsedProfessionalLocationAddressInput> {
  const lat = parseNullableProfessionalLocationCoordinate({
    body,
    key: 'lat',
  })

  if (!lat.ok) return lat

  const lng = parseNullableProfessionalLocationCoordinate({
    body,
    key: 'lng',
  })

  if (!lng.ok) return lng

  return {
    ok: true,
    value: {
      formattedAddress: pickNullableProfessionalLocationString(
        body,
        'formattedAddress',
      ),
      addressLine1: pickNullableProfessionalLocationString(
        body,
        'addressLine1',
      ),
      addressLine2: pickNullableProfessionalLocationString(
        body,
        'addressLine2',
      ),
      city: pickNullableProfessionalLocationString(body, 'city'),
      state: pickNullableProfessionalLocationString(body, 'state'),
      postalCode: pickNullableProfessionalLocationString(body, 'postalCode'),
      countryCode: pickNullableProfessionalLocationString(body, 'countryCode'),
      placeId: pickNullableProfessionalLocationString(body, 'placeId'),
      latRaw: lat.value,
      lngRaw: lng.value,
    },
  }
}

export function parseProfessionalLocationScheduleInput(
  body: UnknownRecord,
): ParseProfessionalLocationResult<ParsedProfessionalLocationScheduleInput> {
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
        ok: false,
        error:
          'workingHours must contain mon..sun with { enabled, start, end }, valid HH:MM times, and end after start.',
      }
    }

    workingHours = normalized
  }

  return {
    ok: true,
    value: {
      timeZone,
      workingHours,
      bufferMinutes,
      stepMinutes,
      advanceNoticeMinutes,
      maxDaysAhead,
    },
  }
}

export function validateBookableProfessionalLocation(args: {
  type: ProfessionalLocationType
  timeZone: string | null
  address: ParsedProfessionalLocationAddressInput
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
    requiresAddressForBookableProfessionalLocation(type) &&
    (!address.placeId || !address.formattedAddress)
  ) {
    return 'Salon/Suite bookable locations require placeId and formattedAddress.'
  }

  return null
}

export function buildProfessionalLocationAddressPrivacyInput(
  address: ParsedProfessionalLocationAddressInput,
) {
  return {
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
  }
}

export function buildProfessionalLocationLegacyAddressData(
  address: ParsedProfessionalLocationAddressInput,
) {
  return {
    formattedAddress: address.formattedAddress,
    addressLine1: address.addressLine1,
    addressLine2: address.addressLine2,
    city: address.city,
    state: address.state,
    postalCode: address.postalCode,
    countryCode: address.countryCode,
    placeId: address.placeId,
    lat: professionalLocationNumberToDecimalOrNull(address.latRaw),
    lng: professionalLocationNumberToDecimalOrNull(address.lngRaw),
  }
}

export function buildProfessionalLocationScheduleCreateData(
  schedule: ParsedProfessionalLocationScheduleInput,
) {
  return {
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
  }
}