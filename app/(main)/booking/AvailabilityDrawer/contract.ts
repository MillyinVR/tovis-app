// app/(main)/booking/AvailabilityDrawer/contract.ts
import type {
  AvailabilityDayResponse,
  AvailabilityOffering,
  AvailabilityOtherPro,
  AvailabilitySummaryResponse,
  HoldParsed,
  MoneyString,
  ProCard,
  ServiceLocationType,
} from './types'

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

function pickString(x: unknown): string | null {
  return typeof x === 'string' && x.trim() ? x.trim() : null
}

function pickNumber(x: unknown): number | null {
  return typeof x === 'number' && Number.isFinite(x) ? x : null
}

function pickBoolean(x: unknown): boolean | null {
  return typeof x === 'boolean' ? x : null
}

function pickServiceLocationType(x: unknown): ServiceLocationType | null {
  const s = pickString(x)?.toUpperCase() ?? ''
  if (s === 'SALON' || s === 'MOBILE') return s as ServiceLocationType
  return null
}

function pickMoneyString(x: unknown): MoneyString | null {
  return typeof x === 'string' ? x : null
}

function pickOffering(x: unknown): AvailabilityOffering | null {
  if (!isRecord(x)) return null

  const id = pickString(x.id)
  const offersInSalon = pickBoolean(x.offersInSalon)
  const offersMobile = pickBoolean(x.offersMobile)

  if (!id || offersInSalon == null || offersMobile == null) return null

  const salonDurationMinutes =
    x.salonDurationMinutes == null ? null : pickNumber(x.salonDurationMinutes)
  const mobileDurationMinutes =
    x.mobileDurationMinutes == null ? null : pickNumber(x.mobileDurationMinutes)

  const salonPriceStartingAt =
    x.salonPriceStartingAt == null ? null : pickMoneyString(x.salonPriceStartingAt)
  const mobilePriceStartingAt =
    x.mobilePriceStartingAt == null ? null : pickMoneyString(x.mobilePriceStartingAt)

  if (x.salonDurationMinutes != null && salonDurationMinutes == null) return null
  if (x.mobileDurationMinutes != null && mobileDurationMinutes == null) return null
  if (x.salonPriceStartingAt != null && salonPriceStartingAt == null) return null
  if (x.mobilePriceStartingAt != null && mobilePriceStartingAt == null) return null

  return {
    id,
    offersInSalon,
    offersMobile,
    salonDurationMinutes,
    mobileDurationMinutes,
    salonPriceStartingAt,
    mobilePriceStartingAt,
  }
}

function pickProCardBase(x: unknown): ProCard | null {
  if (!isRecord(x)) return null

  const id = pickString(x.id)
  if (!id) return null

  const businessName = x.businessName == null ? null : pickString(x.businessName)
  const avatarUrl = x.avatarUrl == null ? null : pickString(x.avatarUrl)
  const location = x.location == null ? null : pickString(x.location)
  const offeringId = x.offeringId == null ? null : pickString(x.offeringId)
  const timeZone = x.timeZone == null ? null : pickString(x.timeZone)
  const locationId = x.locationId == null ? null : pickString(x.locationId)
  const distanceMiles = x.distanceMiles == null ? null : pickNumber(x.distanceMiles)

  const isCreator =
    x.isCreator == null ? undefined : pickBoolean(x.isCreator) ?? undefined

  let slots: string[] | undefined
  if (Array.isArray(x.slots)) {
    if (!x.slots.every((s) => typeof s === 'string')) return null
    slots = x.slots.slice()
  }

  return {
    id,
    businessName: businessName ?? null,
    avatarUrl: avatarUrl ?? null,
    location: location ?? null,
    offeringId: offeringId ?? null,
    timeZone: timeZone ?? null,
    isCreator,
    locationId: locationId ?? null,
    distanceMiles: distanceMiles ?? null,
    slots,
  }
}

function pickAvailabilityOtherPro(x: unknown): AvailabilityOtherPro | null {
  if (!isRecord(x)) return null

  const base = pickProCardBase(x)
  if (!base) return null

  const offeringId = pickString(x.offeringId)
  const locationId = pickString(x.locationId)
  const timeZone = pickString(x.timeZone)

  if (!offeringId || !locationId || !timeZone) return null

  const distanceMiles = x.distanceMiles == null ? null : pickNumber(x.distanceMiles)
  if (x.distanceMiles != null && distanceMiles == null) return null

  return {
    ...base,
    offeringId,
    locationId,
    timeZone,
    distanceMiles: distanceMiles ?? null,
  }
}
function pickSummaryDebug(x: unknown):
  | {
      emptyReason?: string | null
      otherProsCount?: number
      includeOtherPros?: boolean
      center?: {
        lat: number
        lng: number
        radiusMiles: number
      } | null
      usedViewerCenter?: boolean
      addOnIds?: string[]
      clientAddressId?: string | null
      requestedSummaryDays?: number
    }
  | undefined {
  if (x == null) return undefined
  if (!isRecord(x)) return undefined

  const emptyReason =
    x.emptyReason == null ? undefined : pickString(x.emptyReason) ?? undefined

  const otherProsCount =
    x.otherProsCount == null ? undefined : pickNumber(x.otherProsCount) ?? undefined

  const includeOtherPros =
    x.includeOtherPros == null
      ? undefined
      : pickBoolean(x.includeOtherPros) ?? undefined

  const usedViewerCenter =
    x.usedViewerCenter == null
      ? undefined
      : pickBoolean(x.usedViewerCenter) ?? undefined

  const requestedSummaryDays =
    x.requestedSummaryDays == null
      ? undefined
      : pickNumber(x.requestedSummaryDays) ?? undefined

  const addOnIds =
    Array.isArray(x.addOnIds) && x.addOnIds.every((v) => typeof v === 'string')
      ? x.addOnIds.slice()
      : undefined

  const clientAddressId =
    x.clientAddressId == null ? undefined : pickString(x.clientAddressId) ?? undefined

  let center:
    | {
        lat: number
        lng: number
        radiusMiles: number
      }
    | null
    | undefined

  if (x.center === null) {
    center = null
  } else if (isRecord(x.center)) {
    const lat = pickNumber(x.center.lat)
    const lng = pickNumber(x.center.lng)
    const radiusMiles = pickNumber(x.center.radiusMiles)

    if (lat != null && lng != null && radiusMiles != null) {
      center = { lat, lng, radiusMiles }
    }
  }

  return {
    ...(emptyReason !== undefined ? { emptyReason } : {}),
    ...(otherProsCount !== undefined ? { otherProsCount } : {}),
    ...(includeOtherPros !== undefined ? { includeOtherPros } : {}),
    ...(center !== undefined ? { center } : {}),
    ...(usedViewerCenter !== undefined ? { usedViewerCenter } : {}),
    ...(addOnIds !== undefined ? { addOnIds } : {}),
    ...(clientAddressId !== undefined ? { clientAddressId } : {}),
    ...(requestedSummaryDays !== undefined ? { requestedSummaryDays } : {}),
  }
}

export function parseAvailabilitySummaryResponse(
  x: unknown,
): AvailabilitySummaryResponse | null {
  if (!isRecord(x)) return null

  const ok = x.ok
  if (ok === false) {
    const error = pickString(x.error)
    if (!error) return null

    const timeZone =
      x.timeZone == null ? undefined : pickString(x.timeZone) ?? undefined
    const locationId =
      x.locationId == null ? undefined : pickString(x.locationId) ?? undefined

    return { ok: false, error, timeZone, locationId }
  }

  if (ok !== true) return null
  if (x.mode !== 'SUMMARY') return null

  const mediaId = x.mediaId === null ? null : pickString(x.mediaId)
  if (x.mediaId !== null && mediaId == null) return null

  const serviceId = pickString(x.serviceId)
  const professionalId = pickString(x.professionalId)
  const serviceName = x.serviceName === null ? null : pickString(x.serviceName)
  const serviceCategoryName =
    x.serviceCategoryName === null ? null : pickString(x.serviceCategoryName)

  if (!serviceId || !professionalId) return null
  if (x.serviceName !== null && serviceName == null) return null
  if (x.serviceCategoryName !== null && serviceCategoryName == null) return null

  const locationType = pickServiceLocationType(x.locationType)
  const locationId = pickString(x.locationId)
  const timeZone = pickString(x.timeZone)
  if (!locationType || !locationId || !timeZone) return null

  const stepMinutes = pickNumber(x.stepMinutes)
  const leadTimeMinutes = pickNumber(x.leadTimeMinutes)
  const locationBufferMinutes = pickNumber(x.locationBufferMinutes)
  const adjacencyBufferMinutes =
    pickNumber(x.adjacencyBufferMinutes) ?? locationBufferMinutes
  const maxDaysAhead = pickNumber(x.maxDaysAhead)
  const durationMinutes = pickNumber(x.durationMinutes)

  if (
    stepMinutes == null ||
    leadTimeMinutes == null ||
    locationBufferMinutes == null ||
    adjacencyBufferMinutes == null ||
    maxDaysAhead == null ||
    durationMinutes == null
  ) {
    return null
  }

  const windowStartDate = pickString(x.windowStartDate)
  const windowEndDate = pickString(x.windowEndDate)
  const nextStartDate =
    x.nextStartDate === null ? null : pickString(x.nextStartDate)
  const hasMoreDays = pickBoolean(x.hasMoreDays)

  if (!windowStartDate || !windowEndDate || hasMoreDays == null) return null
  if (x.nextStartDate !== null && nextStartDate == null) return null

  const primaryProBase = pickProCardBase(x.primaryPro)
  if (!primaryProBase) return null
  if (!primaryProBase.offeringId) return null
  if (!primaryProBase.locationId) return null

  const availableDaysRaw = x.availableDays
  if (!Array.isArray(availableDaysRaw)) return null

  const availableDays: Array<{ date: string; slotCount: number }> = []
  for (const row of availableDaysRaw) {
    if (!isRecord(row)) return null

    const date = pickString(row.date)
    const slotCount = pickNumber(row.slotCount)
    if (!date || slotCount == null) return null

    availableDays.push({ date, slotCount })
  }

  const otherProsRaw = x.otherPros
  if (!Array.isArray(otherProsRaw)) return null

  const otherPros: AvailabilityOtherPro[] = []
  for (const row of otherProsRaw) {
    const op = pickAvailabilityOtherPro(row)
    if (!op) return null
    otherPros.push(op)
  }

  const waitlistSupported = pickBoolean(x.waitlistSupported)
  if (waitlistSupported == null) return null

  const offering = pickOffering(x.offering)
  if (!offering) return null

  const debug = pickSummaryDebug(x.debug)

  let firstDaySlots: string[] | undefined
  if (Array.isArray(x.firstDaySlots) && x.firstDaySlots.every((s) => typeof s === 'string')) {
    firstDaySlots = (x.firstDaySlots as string[]).slice()
  }

  return {
    ok: true,
    mode: 'SUMMARY',
    mediaId: mediaId ?? null,
    serviceId,
    professionalId,
    serviceName: serviceName ?? null,
    serviceCategoryName: serviceCategoryName ?? null,
    locationType,
    locationId,
    timeZone,
    stepMinutes,
    leadTimeMinutes,
    locationBufferMinutes,
    adjacencyBufferMinutes,
    maxDaysAhead,
    durationMinutes,
    windowStartDate,
    windowEndDate,
    nextStartDate: nextStartDate ?? null,
    hasMoreDays,
    primaryPro: {
      ...primaryProBase,
      offeringId: primaryProBase.offeringId,
      isCreator: true as const,
      timeZone,
      locationId: primaryProBase.locationId,
    },
    availableDays,
    ...(firstDaySlots !== undefined ? { firstDaySlots } : {}),
    otherPros,
    waitlistSupported,
    offering,
    ...(debug !== undefined ? { debug } : {}),
  }
}

export function parseAvailabilityDayResponse(
  x: unknown,
): AvailabilityDayResponse | null {
  if (!isRecord(x)) return null

  const ok = x.ok
  if (ok === false) {
    const error = pickString(x.error)
    if (!error) return null

    const timeZone =
      x.timeZone == null ? undefined : pickString(x.timeZone) ?? undefined
    const locationId =
      x.locationId == null ? undefined : pickString(x.locationId) ?? undefined

    return { ok: false, error, timeZone, locationId }
  }

  if (ok !== true) return null
  if (x.mode !== 'DAY') return null

  const slotsRaw = x.slots
  if (!Array.isArray(slotsRaw)) return null
  if (!slotsRaw.every((s) => typeof s === 'string')) return null

  const professionalId = pickString(x.professionalId)
  const serviceId = pickString(x.serviceId)
  const locationType = pickServiceLocationType(x.locationType)
  const date = pickString(x.date)
  const locationId = pickString(x.locationId)
  const timeZone = pickString(x.timeZone)

  const stepMinutes = pickNumber(x.stepMinutes)
  const leadTimeMinutes = pickNumber(x.leadTimeMinutes)
  const locationBufferMinutes = pickNumber(x.locationBufferMinutes)
  const adjacencyBufferMinutes =
    pickNumber(x.adjacencyBufferMinutes) ?? locationBufferMinutes
  const maxDaysAhead = pickNumber(x.maxDaysAhead)

  const durationMinutes = pickNumber(x.durationMinutes)
  const dayStartUtc = pickString(x.dayStartUtc)
  const dayEndExclusiveUtc = pickString(x.dayEndExclusiveUtc)

  if (
    !professionalId ||
    !serviceId ||
    !locationType ||
    !date ||
    !locationId ||
    !timeZone ||
    stepMinutes == null ||
    leadTimeMinutes == null ||
    locationBufferMinutes == null ||
    adjacencyBufferMinutes == null ||
    maxDaysAhead == null ||
    durationMinutes == null ||
    !dayStartUtc ||
    !dayEndExclusiveUtc
  ) {
    return null
  }

  const offering =
    x.offering == null ? undefined : pickOffering(x.offering) ?? undefined
  if (x.offering != null && !offering) return null

  const debug = x.debug
  const addOnIds =
    Array.isArray(x.addOnIds) && x.addOnIds.every((v) => typeof v === 'string')
      ? x.addOnIds.slice()
      : undefined
  const clientAddressId =
    x.clientAddressId == null ? null : pickString(x.clientAddressId)

  if (x.clientAddressId != null && clientAddressId == null) return null

  return {
    ok: true,
    mode: 'DAY',
    professionalId,
    serviceId,
    locationType,
    date,
    locationId,
    timeZone,
    stepMinutes,
    leadTimeMinutes,
    locationBufferMinutes,
    adjacencyBufferMinutes,
    maxDaysAhead,
    durationMinutes,
    dayStartUtc,
    dayEndExclusiveUtc,
    slots: slotsRaw.slice(),
    offering,
    ...(debug !== undefined ? { debug } : {}),
    ...(addOnIds ? { addOnIds } : {}),
    ...(clientAddressId !== null ? { clientAddressId } : {}),
  }
}

export function parseCreateHoldResponse(x: unknown): HoldParsed | null {
  if (!isRecord(x)) return null
  if (x.ok !== true) return null

  const holdRaw = x.hold
  if (!isRecord(holdRaw)) return null

  const holdId = pickString(holdRaw.id)
  const scheduledForISO = pickString(holdRaw.scheduledFor)
  const expiresAtISO = pickString(holdRaw.expiresAt)
  if (!holdId || !scheduledForISO || !expiresAtISO) return null

  const expiresAt = new Date(expiresAtISO)
  if (!Number.isFinite(expiresAt.getTime())) return null

  const locationType = pickServiceLocationType(holdRaw.locationType)

  return {
    holdId,
    scheduledForISO,
    holdUntilMs: expiresAt.getTime(),
    locationType: locationType ?? null,
  }
}