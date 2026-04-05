// app/(main)/booking/AvailabilityDrawer/contract.ts
import type {
  AvailabilityAlternatesResponse,
  AvailabilityBootstrapResponse,
  AvailabilityDayResponse,
  AvailabilityOffering,
  AvailabilityOtherPro,
  AvailabilityPrimaryPro,
  AvailabilityRequestBase,
  AvailabilitySelectedDay,
  AvailabilitySummaryDebug,
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

function pickStringArray(x: unknown): string[] | null {
  if (!Array.isArray(x)) return null
  if (!x.every((v) => typeof v === 'string')) return null
  return x.slice()
}

function pickServiceLocationType(x: unknown): ServiceLocationType | null {
  const s = pickString(x)?.toUpperCase() ?? ''

  if (s === 'SALON') return 'SALON'
  if (s === 'MOBILE') return 'MOBILE'

  return null
}

function pickMoneyString(x: unknown): MoneyString | null {
  return typeof x === 'string' ? x : null
}

function buildLegacyAvailabilityVersion(
  parts: Array<string | number | null | undefined>,
): string {
  return `legacy-unversioned:${parts.map((part) => String(part ?? '')).join('|')}`
}

function pickFreshness(
  x: Record<string, unknown>,
  fallbackParts: Array<string | number | null | undefined>,
): { availabilityVersion: string; generatedAt: string } | null {
  const availabilityVersion = pickString(x.availabilityVersion)
  const generatedAt = pickString(x.generatedAt)

  if (availabilityVersion && generatedAt) {
    return { availabilityVersion, generatedAt }
  }

  return {
    availabilityVersion: buildLegacyAvailabilityVersion(fallbackParts),
    generatedAt: '1970-01-01T00:00:00.000Z',
  }
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
    x.salonPriceStartingAt == null
      ? null
      : pickMoneyString(x.salonPriceStartingAt)
  const mobilePriceStartingAt =
    x.mobilePriceStartingAt == null
      ? null
      : pickMoneyString(x.mobilePriceStartingAt)

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

  const businessName =
    x.businessName == null ? null : pickString(x.businessName)
  const avatarUrl = x.avatarUrl == null ? null : pickString(x.avatarUrl)
  const location = x.location == null ? null : pickString(x.location)
  const offeringId = x.offeringId == null ? null : pickString(x.offeringId)
  const timeZone = x.timeZone == null ? null : pickString(x.timeZone)
  const locationId = x.locationId == null ? null : pickString(x.locationId)
  const distanceMiles =
    x.distanceMiles == null ? null : pickNumber(x.distanceMiles)

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

function pickAvailabilityPrimaryPro(
  x: unknown,
  fallbackTimeZone: string,
): AvailabilityPrimaryPro | null {
  const base = pickProCardBase(x)
  if (!base || !isRecord(x)) return null

  const offeringId = pickString(x.offeringId)
  const locationId = pickString(x.locationId)
  const timeZone = pickString(x.timeZone) ?? fallbackTimeZone

  if (!offeringId || !locationId || !timeZone) return null

  return {
    ...base,
    offeringId,
    locationId,
    timeZone,
    isCreator: true,
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

  const distanceMiles =
    x.distanceMiles == null ? null : pickNumber(x.distanceMiles)
  if (x.distanceMiles != null && distanceMiles == null) return null

  return {
    ...base,
    offeringId,
    locationId,
    timeZone,
    distanceMiles: distanceMiles ?? null,
  }
}

function pickAvailabilitySelectedDay(
  x: unknown,
): AvailabilitySelectedDay | null | undefined {
  if (x == null) return null
  if (!isRecord(x)) return undefined

  const date = pickString(x.date)
  const slots = pickStringArray(x.slots)

  if (!date || !slots) return undefined

  return {
    date,
    slots,
  }
}

function pickSummaryDebug(x: unknown): AvailabilitySummaryDebug | undefined {
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

  const addOnIds = pickStringArray(x.addOnIds) ?? undefined

  const clientAddressId =
    x.clientAddressId == null
      ? undefined
      : pickString(x.clientAddressId) ?? undefined

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

function pickAvailabilityRequestBaseFromRecord(
  x: unknown,
): AvailabilityRequestBase | null {
  if (!isRecord(x)) return null

  const professionalId = pickString(x.professionalId)
  const serviceId = pickString(x.serviceId)
  const offeringId = x.offeringId == null ? null : pickString(x.offeringId)
  const locationType = pickServiceLocationType(x.locationType)
  const locationId = pickString(x.locationId)
  const clientAddressId =
    x.clientAddressId == null ? null : pickString(x.clientAddressId)
  const addOnIds = pickStringArray(x.addOnIds)
  const durationMinutes = pickNumber(x.durationMinutes)

  if (!professionalId || !serviceId || !locationType || !locationId) return null
  if (x.offeringId != null && offeringId == null) return null
  if (x.clientAddressId != null && clientAddressId == null) return null
  if (!addOnIds || durationMinutes == null) return null

  return {
    professionalId,
    serviceId,
    offeringId,
    locationType,
    locationId,
    clientAddressId,
    addOnIds,
    durationMinutes,
  }
}

function pickAvailabilityRequestBaseFromLegacyDay(
  x: Record<string, unknown>,
  offering: AvailabilityOffering | undefined,
): AvailabilityRequestBase | null {
  const professionalId = pickString(x.professionalId)
  const serviceId = pickString(x.serviceId)
  const locationType = pickServiceLocationType(x.locationType)
  const locationId = pickString(x.locationId)
  const durationMinutes = pickNumber(x.durationMinutes)
  const addOnIds = x.addOnIds == null ? [] : pickStringArray(x.addOnIds)
  const clientAddressId =
    x.clientAddressId == null ? null : pickString(x.clientAddressId)

  if (
    !professionalId ||
    !serviceId ||
    !locationType ||
    !locationId ||
    durationMinutes == null
  ) {
    return null
  }
  if (x.addOnIds != null && addOnIds == null) return null
  if (x.clientAddressId != null && clientAddressId == null) return null

return {
  professionalId,
  serviceId,
  offeringId: offering?.id ?? null,
  locationType,
  locationId,
  clientAddressId,
  addOnIds: addOnIds ?? [],
  durationMinutes,
}
}

function pickAlternatesRequestFromRecord(
  x: unknown,
): {
  serviceId: string
  offeringId: string | null
  locationType: ServiceLocationType
  locationId: string
  clientAddressId: string | null
  addOnIds: string[]
  durationMinutes: number
  date: string
} | null {
  if (!isRecord(x)) return null

  const serviceId = pickString(x.serviceId)
  const offeringId = x.offeringId == null ? null : pickString(x.offeringId)
  const locationType = pickServiceLocationType(x.locationType)
  const locationId = pickString(x.locationId)
  const clientAddressId =
    x.clientAddressId == null ? null : pickString(x.clientAddressId)
  const addOnIds = pickStringArray(x.addOnIds)
  const durationMinutes = pickNumber(x.durationMinutes)
  const date = pickString(x.date)

  if (
    !serviceId ||
    !locationType ||
    !locationId ||
    !date ||
    durationMinutes == null
  ) {
    return null
  }
  if (x.offeringId != null && offeringId == null) return null
  if (x.clientAddressId != null && clientAddressId == null) return null
  if (!addOnIds) return null

  return {
    serviceId,
    offeringId,
    locationType,
    locationId,
    clientAddressId,
    addOnIds,
    durationMinutes,
    date,
  }
}

export function parseAvailabilityBootstrapResponse(
  x: unknown,
): AvailabilityBootstrapResponse | null {
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
  if (x.mode !== 'BOOTSTRAP') return null

  const mediaId = x.mediaId === null ? null : pickString(x.mediaId)
  if (x.mediaId !== null && mediaId == null) return null

  const serviceName = x.serviceName === null ? null : pickString(x.serviceName)
  const serviceCategoryName =
    x.serviceCategoryName === null ? null : pickString(x.serviceCategoryName)

  if (x.serviceName !== null && serviceName == null) return null
  if (x.serviceCategoryName !== null && serviceCategoryName == null) return null

  const timeZone = pickString(x.timeZone)
  if (!timeZone) return null

  const stepMinutes = pickNumber(x.stepMinutes)
  const leadTimeMinutes = pickNumber(x.leadTimeMinutes)
  const locationBufferMinutes = pickNumber(x.locationBufferMinutes)
  const adjacencyBufferMinutes =
    pickNumber(x.adjacencyBufferMinutes) ?? locationBufferMinutes
  const maxDaysAhead = pickNumber(x.maxDaysAhead)

  if (
    stepMinutes == null ||
    leadTimeMinutes == null ||
    locationBufferMinutes == null ||
    adjacencyBufferMinutes == null ||
    maxDaysAhead == null
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

  const primaryPro = pickAvailabilityPrimaryPro(x.primaryPro, timeZone)
  if (!primaryPro) return null

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
    const parsed = pickAvailabilityOtherPro(row)
    if (!parsed) return null
    otherPros.push(parsed)
  }

  const waitlistSupported = pickBoolean(x.waitlistSupported)
  if (waitlistSupported == null) return null

  const offering = pickOffering(x.offering)
  if (!offering) return null

  const debug = pickSummaryDebug(x.debug)

  const selectedDay = pickAvailabilitySelectedDay(x.selectedDay)
  if (selectedDay === undefined) return null

  const request = pickAvailabilityRequestBaseFromRecord(x.request)
  if (!request) return null

  const freshness = pickFreshness(x, [
    'BOOTSTRAP',
    request.professionalId,
    request.serviceId,
    request.offeringId,
    request.locationType,
    request.locationId,
    request.clientAddressId,
    request.durationMinutes,
    windowStartDate,
    windowEndDate,
  ])
  if (!freshness) return null

  return {
    ok: true,
    mode: 'BOOTSTRAP',
    ...freshness,
    request,
    mediaId: mediaId ?? null,
    serviceName: serviceName ?? null,
    serviceCategoryName: serviceCategoryName ?? null,
    professionalId: request.professionalId,
    serviceId: request.serviceId,
    locationType: request.locationType,
    locationId: request.locationId,
    timeZone,
    stepMinutes,
    leadTimeMinutes,
    locationBufferMinutes,
    adjacencyBufferMinutes,
    maxDaysAhead,
    durationMinutes: request.durationMinutes,
    windowStartDate,
    windowEndDate,
    nextStartDate: nextStartDate ?? null,
    hasMoreDays,
    primaryPro,
    availableDays,
    selectedDay,
    otherPros,
    waitlistSupported,
    offering,
    ...(debug !== undefined ? { debug } : {}),
  }
}

/**
 * Transitional alias for older imports only.
 * This no longer accepts legacy SUMMARY transport payloads.
 */
export function parseAvailabilitySummaryResponse(
  x: unknown,
): AvailabilitySummaryResponse | null {
  return parseAvailabilityBootstrapResponse(x)
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

  const slots = pickStringArray(x.slots)
  if (!slots) return null

  const timeZone = pickString(x.timeZone)
  if (!timeZone) return null

  const stepMinutes = pickNumber(x.stepMinutes)
  const leadTimeMinutes = pickNumber(x.leadTimeMinutes)
  const locationBufferMinutes = pickNumber(x.locationBufferMinutes)
  const adjacencyBufferMinutes =
    pickNumber(x.adjacencyBufferMinutes) ?? locationBufferMinutes
  const maxDaysAhead = pickNumber(x.maxDaysAhead)
  const dayStartUtc = pickString(x.dayStartUtc)
  const dayEndExclusiveUtc = pickString(x.dayEndExclusiveUtc)

  if (
    stepMinutes == null ||
    leadTimeMinutes == null ||
    locationBufferMinutes == null ||
    adjacencyBufferMinutes == null ||
    maxDaysAhead == null ||
    !dayStartUtc ||
    !dayEndExclusiveUtc
  ) {
    return null
  }

  const offering =
    x.offering == null ? undefined : pickOffering(x.offering) ?? undefined
  if (x.offering != null && !offering) return null

  const request =
    ((): (AvailabilityRequestBase & { date: string }) | null => {
      if (isRecord(x.request)) {
        const base = pickAvailabilityRequestBaseFromRecord(x.request)
        const date = pickString(x.request.date)
        if (!base || !date) return null
        return { ...base, date }
      }

      const base = pickAvailabilityRequestBaseFromLegacyDay(x, offering)
      const date = pickString(x.date)
      if (!base || !date) return null
      return { ...base, date }
    })()

  if (!request) return null

  const freshness = pickFreshness(x, [
    'DAY',
    request.professionalId,
    request.serviceId,
    request.offeringId,
    request.locationType,
    request.locationId,
    request.clientAddressId,
    request.durationMinutes,
    request.date,
  ])
  if (!freshness) return null

  const debug = x.debug

  return {
    ok: true,
    mode: 'DAY',
    ...freshness,
    request,
    professionalId: request.professionalId,
    serviceId: request.serviceId,
    locationType: request.locationType,
    date: request.date,
    locationId: request.locationId,
    timeZone,
    stepMinutes,
    leadTimeMinutes,
    locationBufferMinutes,
    adjacencyBufferMinutes,
    maxDaysAhead,
    durationMinutes: request.durationMinutes,
    dayStartUtc,
    dayEndExclusiveUtc,
    slots,
    ...(offering ? { offering } : {}),
    ...(debug !== undefined ? { debug } : {}),
  }
}

export function parseAvailabilityAlternatesResponse(
  x: unknown,
): AvailabilityAlternatesResponse | null {
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
  if (x.mode !== 'ALTERNATES') return null

  const request = pickAlternatesRequestFromRecord(x.request)
  const selectedDay = pickString(x.selectedDay)
  if (!request || !selectedDay) return null

  const alternatesRaw = x.alternates
  if (!Array.isArray(alternatesRaw)) return null

  const alternates: Array<{ pro: AvailabilityOtherPro; slots: string[] }> = []
  for (const row of alternatesRaw) {
    if (!isRecord(row)) return null
    const pro = pickAvailabilityOtherPro(row.pro)
    const slots = pickStringArray(row.slots)
    if (!pro || !slots) return null
    alternates.push({ pro, slots })
  }

  const freshness = pickFreshness(x, [
    'ALTERNATES',
    request.serviceId,
    request.offeringId,
    request.locationType,
    request.locationId,
    request.clientAddressId,
    request.durationMinutes,
    request.date,
  ])
  if (!freshness) return null

  const debug = x.debug

  return {
    ok: true,
    mode: 'ALTERNATES',
    ...freshness,
    request,
    selectedDay,
    alternates,
    ...(debug !== undefined ? { debug } : {}),
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
