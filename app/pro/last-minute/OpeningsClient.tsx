// app/pro/last-minute/OpeningsClient.tsx
'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

import {
  getZonedParts,
  isValidIanaTimeZone,
  sanitizeTimeZone,
  zonedTimeToUtc,
} from '@/lib/timeZone'
import { readErrorMessage, safeJsonRecord } from '@/lib/http'
import { isRecord } from '@/lib/guards'
import { pickStringOrEmpty } from '@/lib/pick'

export type OfferingLite = {
  id: string
  serviceId: string
  name: string
  basePrice: string
}

export type LastMinuteOpeningsView = 'combined' | 'create' | 'list'

type Props = {
  offerings: OfferingLite[]
  view?: LastMinuteOpeningsView
  onCreated?: () => void
}

type LocationType = 'SALON' | 'MOBILE'
type VisibilityMode =
  | 'TARGETED_ONLY'
  | 'PUBLIC_AT_DISCOVERY'
  | 'PUBLIC_IMMEDIATE'
type Tier = 'WAITLIST' | 'REACTIVATION' | 'DISCOVERY'
type OfferType =
  | 'NONE'
  | 'PERCENT_OFF'
  | 'AMOUNT_OFF'
  | 'FREE_SERVICE'
  | 'FREE_ADD_ON'

type TierPlanFormState = {
  tier: Tier
  offerType: OfferType
  percentOff: string
  amountOff: string
  freeAddOnServiceId: string
}

type OpeningServiceRow = {
  id: string
  openingId: string
  serviceId: string
  offeringId: string
  sortOrder: number
  createdAt: string
  service: {
    id: string
    name: string
    minPrice: string
    defaultDurationMinutes: number
    isAddOnEligible: boolean
    addOnGroup: string | null
  }
  offering: {
    id: string
    title: string | null
    offersInSalon: boolean
    offersMobile: boolean
    salonPriceStartingAt: string | null
    salonDurationMinutes: number | null
    mobilePriceStartingAt: string | null
    mobileDurationMinutes: number | null
  }
}

type TierPlanRow = {
  id: string
  openingId: string
  tier: Tier
  scheduledFor: string
  processedAt: string | null
  cancelledAt: string | null
  lastError: string | null
  offerType: OfferType
  percentOff: number | null
  amountOff: string | null
  freeAddOnServiceId: string | null
  freeAddOnService: {
    id: string
    name: string
  } | null
  createdAt: string
  updatedAt: string
}

type OpeningRow = {
  id: string
  professionalId: string
  status: string
  visibilityMode: VisibilityMode
  startAt: string
  endAt: string | null
  launchAt: string | null
  expiresAt: string | null
  publicVisibleFrom: string | null
  publicVisibleUntil: string | null
  bookedAt: string | null
  cancelledAt: string | null
  note: string | null
  locationType: LocationType
  locationId: string
  timeZone: string
  recipientCount: number
  location: {
    id: string
    type: string
    name: string | null
    city: string | null
    state: string | null
    formattedAddress: string | null
    timeZone: string | null
    lat: string | null
    lng: string | null
  } | null
  services: OpeningServiceRow[]
  tierPlans: TierPlanRow[]
}

type Option<Value extends string> = {
  value: Value
  label: string
}

type TierPlanRequest =
  | {
      tier: Tier
      offerType: 'NONE'
    }
  | {
      tier: Tier
      offerType: 'PERCENT_OFF'
      percentOff: number
    }
  | {
      tier: Tier
      offerType: 'AMOUNT_OFF'
      amountOff: string
    }
  | {
      tier: Tier
      offerType: 'FREE_SERVICE'
    }
  | {
      tier: Tier
      offerType: 'FREE_ADD_ON'
      freeAddOnServiceId: string
    }

type LastMinuteOpeningsContextValue = {
  offerings: OfferingLite[]
  timeZone: string
  items: OpeningRow[]
  loading: boolean
  busy: boolean
  error: string | null
  selectedOfferingIds: string[]
  selectedOfferingCountLabel: string
  locationType: LocationType
  visibilityMode: VisibilityMode
  startAtLocal: string
  endAtLocal: string
  useEndAt: boolean
  note: string
  tierPlans: TierPlanFormState[]
  canCreateOpening: boolean
  loadOpenings: () => Promise<void>
  createOpening: () => Promise<void>
  cancelOpening: (openingId: string) => Promise<void>
  toggleOffering: (offeringId: string) => void
  setLocationType: (value: LocationType) => void
  setVisibilityMode: (value: VisibilityMode) => void
  setStartAtLocal: (value: string) => void
  setEndAtLocal: (value: string) => void
  setUseEndAt: (value: boolean) => void
  setNote: (value: string) => void
  updateTierPlan: (tier: Tier, patch: Partial<TierPlanFormState>) => void
}

type LastMinuteOpeningsProviderProps = {
  offerings: OfferingLite[]
  onCreated?: () => void
  children: ReactNode
}

const OPENINGS_LIST_ENDPOINT = '/api/pro/openings?hours=48&take=100'
const OPENINGS_MUTATION_ENDPOINT = '/api/pro/openings'

const DEFAULT_VISIBILITY_MODE: VisibilityMode = 'PUBLIC_AT_DISCOVERY'
const DEFAULT_LOCATION_TYPE: LocationType = 'SALON'

const TIERS: ReadonlyArray<Tier> = [
  'WAITLIST',
  'REACTIVATION',
  'DISCOVERY',
]

const LOCATION_OPTIONS: ReadonlyArray<Option<LocationType>> = [
  {
    value: 'SALON',
    label: 'Salon',
  },
  {
    value: 'MOBILE',
    label: 'Mobile',
  },
]

const VISIBILITY_OPTIONS: ReadonlyArray<Option<VisibilityMode>> = [
  {
    value: 'TARGETED_ONLY',
    label: 'Targeted only',
  },
  {
    value: 'PUBLIC_AT_DISCOVERY',
    label: 'Public at discovery',
  },
  {
    value: 'PUBLIC_IMMEDIATE',
    label: 'Public immediately',
  },
]

const OFFER_TYPE_OPTIONS: ReadonlyArray<Option<OfferType>> = [
  {
    value: 'NONE',
    label: 'No incentive',
  },
  {
    value: 'PERCENT_OFF',
    label: 'Percent off',
  },
  {
    value: 'AMOUNT_OFF',
    label: 'Amount off',
  },
  {
    value: 'FREE_SERVICE',
    label: 'Free service',
  },
  {
    value: 'FREE_ADD_ON',
    label: 'Free add-on',
  },
]

const LastMinuteOpeningsContext =
  createContext<LastMinuteOpeningsContextValue | null>(null)

function getBrowserTimeZone(): string {
  try {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone

    if (timeZone && isValidIanaTimeZone(timeZone)) {
      return timeZone
    }
  } catch {
    // Browser timezone detection is best-effort.
  }

  return 'UTC'
}

function buildInitialTierPlans(): TierPlanFormState[] {
  return TIERS.map((tier) => ({
    tier,
    offerType: 'NONE',
    percentOff: '',
    amountOff: '',
    freeAddOnServiceId: '',
  }))
}

function parseDatetimeLocal(value: string) {
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/,
  )

  if (!match) {
    return null
  }

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])

  if (!year || month < 1 || month > 12 || day < 1 || day > 31) {
    return null
  }

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null
  }

  return {
    year,
    month,
    day,
    hour,
    minute,
  }
}

function toDatetimeLocalFromIso(isoUtc: string, timeZone: string): string {
  const date = new Date(isoUtc)

  if (Number.isNaN(date.getTime())) {
    return ''
  }

  const safeTimeZone = sanitizeTimeZone(timeZone, 'UTC')
  const parts = getZonedParts(date, safeTimeZone)
  const pad = (value: number) => String(value).padStart(2, '0')

  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(
    parts.hour,
  )}:${pad(parts.minute)}`
}

function datetimeLocalToIso(
  value: string,
  timeZone: string,
): string | null {
  const parts = parseDatetimeLocal(value)

  if (!parts) {
    return null
  }

  const safeTimeZone = sanitizeTimeZone(timeZone, 'UTC')
  const utc = zonedTimeToUtc({
    ...parts,
    second: 0,
    timeZone: safeTimeZone,
  })

  return Number.isNaN(utc.getTime()) ? null : utc.toISOString()
}

function prettyWhenInTimeZone(isoUtc: string, timeZone: string): string {
  const date = new Date(isoUtc)

  if (Number.isNaN(date.getTime())) {
    return 'Invalid date'
  }

  const safeTimeZone = sanitizeTimeZone(timeZone, 'UTC')

  return new Intl.DateTimeFormat(undefined, {
    timeZone: safeTimeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

function buildInitialStartAtLocal(timeZone: string): string {
  const date = new Date()
  date.setSeconds(0, 0)
  date.setMinutes(0)
  date.setHours(date.getHours() + 1)

  return toDatetimeLocalFromIso(date.toISOString(), timeZone)
}

function buildInitialEndAtLocal(timeZone: string): string {
  const date = new Date()
  date.setSeconds(0, 0)
  date.setMinutes(0)
  date.setHours(date.getHours() + 2)

  return toDatetimeLocalFromIso(date.toISOString(), timeZone)
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function asNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : asStringOrNull(value)
}

function readArrayField(
  data: Record<string, unknown> | null,
  key: string,
): unknown[] {
  if (!data) {
    return []
  }

  const value = data[key]

  return Array.isArray(value) ? value : []
}

function parseLocationType(value: string): LocationType | null {
  if (value === 'SALON' || value === 'MOBILE') {
    return value
  }

  return null
}

function parseVisibilityMode(value: string): VisibilityMode | null {
  if (
    value === 'TARGETED_ONLY' ||
    value === 'PUBLIC_AT_DISCOVERY' ||
    value === 'PUBLIC_IMMEDIATE'
  ) {
    return value
  }

  return null
}

function parseTier(value: string): Tier | null {
  if (
    value === 'WAITLIST' ||
    value === 'REACTIVATION' ||
    value === 'DISCOVERY'
  ) {
    return value
  }

  return null
}

function parseOfferType(value: string): OfferType | null {
  if (
    value === 'NONE' ||
    value === 'PERCENT_OFF' ||
    value === 'AMOUNT_OFF' ||
    value === 'FREE_SERVICE' ||
    value === 'FREE_ADD_ON'
  ) {
    return value
  }

  return null
}

function parseOpeningServiceRow(value: unknown): OpeningServiceRow | null {
  if (!isRecord(value)) {
    return null
  }

  const id = pickStringOrEmpty(value.id)
  const openingId = pickStringOrEmpty(value.openingId)
  const serviceId = pickStringOrEmpty(value.serviceId)
  const offeringId = pickStringOrEmpty(value.offeringId)
  const createdAt = pickStringOrEmpty(value.createdAt)
  const sortOrder = asNumberOrNull(value.sortOrder)

  if (
    !id ||
    !openingId ||
    !serviceId ||
    !offeringId ||
    !createdAt ||
    sortOrder === null
  ) {
    return null
  }

  const service = value.service
  const offering = value.offering

  if (!isRecord(service) || !isRecord(offering)) {
    return null
  }

  const nestedServiceId = pickStringOrEmpty(service.id) || serviceId
  const nestedOfferingId = pickStringOrEmpty(offering.id) || offeringId

  const serviceName = asStringOrNull(service.name)
  const serviceMinPrice = asStringOrNull(service.minPrice)
  const serviceDefaultDurationMinutes = asNumberOrNull(
    service.defaultDurationMinutes,
  )
  const isAddOnEligible =
    typeof service.isAddOnEligible === 'boolean'
      ? service.isAddOnEligible
      : null
  const addOnGroup = nullableString(service.addOnGroup)

  if (
    !serviceName ||
    !serviceMinPrice ||
    serviceDefaultDurationMinutes === null ||
    isAddOnEligible === null
  ) {
    return null
  }

  const offersInSalon =
    typeof offering.offersInSalon === 'boolean'
      ? offering.offersInSalon
      : null
  const offersMobile =
    typeof offering.offersMobile === 'boolean'
      ? offering.offersMobile
      : null

  if (offersInSalon === null || offersMobile === null) {
    return null
  }

  return {
    id,
    openingId,
    serviceId,
    offeringId,
    sortOrder,
    createdAt,
    service: {
      id: nestedServiceId,
      name: serviceName,
      minPrice: serviceMinPrice,
      defaultDurationMinutes: serviceDefaultDurationMinutes,
      isAddOnEligible,
      addOnGroup,
    },
    offering: {
      id: nestedOfferingId,
      title: nullableString(offering.title),
      offersInSalon,
      offersMobile,
      salonPriceStartingAt: nullableString(offering.salonPriceStartingAt),
      salonDurationMinutes: asNumberOrNull(offering.salonDurationMinutes),
      mobilePriceStartingAt: nullableString(offering.mobilePriceStartingAt),
      mobileDurationMinutes: asNumberOrNull(offering.mobileDurationMinutes),
    },
  }
}

function parseTierPlanRow(value: unknown): TierPlanRow | null {
  if (!isRecord(value)) {
    return null
  }

  const id = pickStringOrEmpty(value.id)
  const openingId = pickStringOrEmpty(value.openingId)
  const tier = parseTier(pickStringOrEmpty(value.tier))
  const scheduledFor = pickStringOrEmpty(value.scheduledFor)
  const offerType = parseOfferType(pickStringOrEmpty(value.offerType))
  const createdAt = pickStringOrEmpty(value.createdAt)
  const updatedAt = pickStringOrEmpty(value.updatedAt)

  if (
    !id ||
    !openingId ||
    !tier ||
    !scheduledFor ||
    !offerType ||
    !createdAt ||
    !updatedAt
  ) {
    return null
  }

  const freeAddOnService = (() => {
    const rawService = value.freeAddOnService

    if (rawService === null || rawService === undefined) {
      return null
    }

    if (!isRecord(rawService)) {
      return null
    }

    const serviceId = pickStringOrEmpty(rawService.id)
    const serviceName = asStringOrNull(rawService.name)

    if (!serviceId || !serviceName) {
      return null
    }

    return {
      id: serviceId,
      name: serviceName,
    }
  })()

  return {
    id,
    openingId,
    tier,
    scheduledFor,
    processedAt: nullableString(value.processedAt),
    cancelledAt: nullableString(value.cancelledAt),
    lastError: nullableString(value.lastError),
    offerType,
    percentOff: asNumberOrNull(value.percentOff),
    amountOff: nullableString(value.amountOff),
    freeAddOnServiceId: nullableString(value.freeAddOnServiceId),
    freeAddOnService,
    createdAt,
    updatedAt,
  }
}

function parseOpeningRow(value: unknown): OpeningRow | null {
  if (!isRecord(value)) {
    return null
  }

  const id = pickStringOrEmpty(value.id)
  const professionalId = pickStringOrEmpty(value.professionalId)
  const status = pickStringOrEmpty(value.status)
  const visibilityMode = parseVisibilityMode(
    pickStringOrEmpty(value.visibilityMode),
  )
  const startAt = pickStringOrEmpty(value.startAt)
  const locationType = parseLocationType(pickStringOrEmpty(value.locationType))
  const locationId = pickStringOrEmpty(value.locationId)
  const timeZone = pickStringOrEmpty(value.timeZone)
  const recipientCount = asNumberOrNull(value.recipientCount)

  if (
    !id ||
    !professionalId ||
    !status ||
    !visibilityMode ||
    !startAt ||
    !locationType ||
    !locationId ||
    !timeZone ||
    recipientCount === null
  ) {
    return null
  }

  const location = (() => {
    const rawLocation = value.location

    if (rawLocation === null || rawLocation === undefined) {
      return null
    }

    if (!isRecord(rawLocation)) {
      return null
    }

    const innerLocationId = pickStringOrEmpty(rawLocation.id)
    const type = pickStringOrEmpty(rawLocation.type)

    if (!innerLocationId || !type) {
      return null
    }

    return {
      id: innerLocationId,
      type,
      name: nullableString(rawLocation.name),
      city: nullableString(rawLocation.city),
      state: nullableString(rawLocation.state),
      formattedAddress: nullableString(rawLocation.formattedAddress),
      timeZone: nullableString(rawLocation.timeZone),
      lat: nullableString(rawLocation.lat),
      lng: nullableString(rawLocation.lng),
    }
  })()

  const services = readArrayField(value, 'services')
    .map(parseOpeningServiceRow)
    .filter((row): row is OpeningServiceRow => row !== null)

  const tierPlans = readArrayField(value, 'tierPlans')
    .map(parseTierPlanRow)
    .filter((row): row is TierPlanRow => row !== null)

  return {
    id,
    professionalId,
    status,
    visibilityMode,
    startAt,
    endAt: nullableString(value.endAt),
    launchAt: nullableString(value.launchAt),
    expiresAt: nullableString(value.expiresAt),
    publicVisibleFrom: nullableString(value.publicVisibleFrom),
    publicVisibleUntil: nullableString(value.publicVisibleUntil),
    bookedAt: nullableString(value.bookedAt),
    cancelledAt: nullableString(value.cancelledAt),
    note: nullableString(value.note),
    locationType,
    locationId,
    timeZone,
    recipientCount,
    location,
    services,
    tierPlans,
  }
}

function tierLabel(tier: Tier): string {
  switch (tier) {
    case 'WAITLIST':
      return 'Tier 1 · Waitlist'
    case 'REACTIVATION':
      return 'Tier 2 · Reactivation'
    case 'DISCOVERY':
      return 'Tier 3 · Discovery'
  }
}

function tierHint(tier: Tier): string {
  switch (tier) {
    case 'WAITLIST':
      return 'Highest intent — recommended with no incentive.'
    case 'REACTIVATION':
      return 'Lapsed clients — use a gentle nudge if needed.'
    case 'DISCOVERY':
      return 'Broadest audience — use sparingly.'
  }
}

function visibilityLabel(mode: VisibilityMode): string {
  switch (mode) {
    case 'TARGETED_ONLY':
      return 'Targeted only'
    case 'PUBLIC_IMMEDIATE':
      return 'Public immediately'
    case 'PUBLIC_AT_DISCOVERY':
      return 'Public at discovery'
  }
}

function describeTierPlan(plan: TierPlanRow): string {
  if (plan.offerType === 'PERCENT_OFF' && plan.percentOff !== null) {
    return `${plan.percentOff}% off`
  }

  if (plan.offerType === 'AMOUNT_OFF' && plan.amountOff) {
    return `$${plan.amountOff} off`
  }

  if (plan.offerType === 'FREE_SERVICE') {
    return 'Free service'
  }

  if (plan.offerType === 'FREE_ADD_ON') {
    return plan.freeAddOnService?.name || 'Free add-on'
  }

  return 'No incentive'
}

function uniqueNonEmpty(values: string[]): string[] {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter(Boolean)),
  )
}

function serviceSummary(opening: OpeningRow): string {
  const names = uniqueNonEmpty(
    opening.services.map((row) => row.service.name),
  )

  return names.length > 0 ? names.join(', ') : 'Services'
}

function locationSummary(opening: OpeningRow): string {
  return (
    opening.location?.name ||
    opening.location?.formattedAddress ||
    opening.locationType
  )
}

function statusLabel(status: string): string {
  return status.trim().toUpperCase() || 'UNKNOWN'
}

function sameStringArray(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false
  }

  return left.every((value, index) => value === right[index])
}

function reconcileSelectedOfferingIds(
  selectedOfferingIds: string[],
  offerings: OfferingLite[],
): string[] {
  const validOfferingIds = new Set(offerings.map((offering) => offering.id))
  const nextSelectedOfferingIds = selectedOfferingIds.filter((id) =>
    validOfferingIds.has(id),
  )

  if (nextSelectedOfferingIds.length > 0) {
    return nextSelectedOfferingIds
  }

  const firstOfferingId = offerings[0]?.id

  return firstOfferingId ? [firstOfferingId] : []
}

function buildTierPlanRequest(plan: TierPlanFormState): TierPlanRequest {
  switch (plan.offerType) {
    case 'PERCENT_OFF': {
      const percentOff = Number(plan.percentOff)

      if (!Number.isFinite(percentOff)) {
        throw new Error(`${tierLabel(plan.tier)} needs a valid percent-off value.`)
      }

      return {
        tier: plan.tier,
        offerType: 'PERCENT_OFF',
        percentOff: Math.trunc(percentOff),
      }
    }

    case 'AMOUNT_OFF': {
      const amountOff = plan.amountOff.trim()

      if (!amountOff) {
        throw new Error(`${tierLabel(plan.tier)} needs an amount-off value.`)
      }

      return {
        tier: plan.tier,
        offerType: 'AMOUNT_OFF',
        amountOff,
      }
    }

    case 'FREE_SERVICE':
      return {
        tier: plan.tier,
        offerType: 'FREE_SERVICE',
      }

    case 'FREE_ADD_ON': {
      const freeAddOnServiceId = plan.freeAddOnServiceId.trim()

      if (!freeAddOnServiceId) {
        throw new Error(`${tierLabel(plan.tier)} needs a free add-on service.`)
      }

      return {
        tier: plan.tier,
        offerType: 'FREE_ADD_ON',
        freeAddOnServiceId,
      }
    }

    case 'NONE':
      return {
        tier: plan.tier,
        offerType: 'NONE',
      }
  }
}

function useLastMinuteOpeningsController({
  offerings,
  onCreated,
}: {
  offerings: OfferingLite[]
  onCreated?: () => void
}): LastMinuteOpeningsContextValue {
  const timeZone = useMemo(() => getBrowserTimeZone(), [])

  const [items, setItems] = useState<OpeningRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [selectedOfferingIds, setSelectedOfferingIds] = useState<string[]>(
    () => reconcileSelectedOfferingIds([], offerings),
  )
  const [locationType, setLocationType] =
    useState<LocationType>(DEFAULT_LOCATION_TYPE)
  const [visibilityMode, setVisibilityMode] = useState<VisibilityMode>(
    DEFAULT_VISIBILITY_MODE,
  )
  const [startAtLocal, setStartAtLocal] = useState(() =>
    buildInitialStartAtLocal(timeZone),
  )
  const [endAtLocal, setEndAtLocal] = useState(() =>
    buildInitialEndAtLocal(timeZone),
  )
  const [useEndAt, setUseEndAt] = useState(true)
  const [note, setNote] = useState('')
  const [tierPlans, setTierPlans] = useState<TierPlanFormState[]>(() =>
    buildInitialTierPlans(),
  )

  useEffect(() => {
    setSelectedOfferingIds((current) => {
      const next = reconcileSelectedOfferingIds(current, offerings)

      return sameStringArray(current, next) ? current : next
    })
  }, [offerings])

  const selectedOfferingCountLabel =
    selectedOfferingIds.length === 1
      ? '1 offering selected'
      : `${selectedOfferingIds.length} offerings selected`

  const canCreateOpening = offerings.length > 0 && selectedOfferingIds.length > 0

  const loadOpenings = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const response = await fetch(OPENINGS_LIST_ENDPOINT, {
        cache: 'no-store',
      })
      const data = await safeJsonRecord(response)

      if (!response.ok) {
        throw new Error(
          readErrorMessage(data) ?? 'Failed to load openings.',
        )
      }

      const openings = readArrayField(data, 'openings')
        .map(parseOpeningRow)
        .filter((row): row is OpeningRow => row !== null)
        .sort(
          (left, right) =>
            new Date(left.startAt).getTime() -
            new Date(right.startAt).getTime(),
        )

      setItems(openings)
    } catch (caughtError: unknown) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Failed to load openings.',
      )
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadOpenings()
  }, [loadOpenings])

  const toggleOffering = useCallback((offeringId: string) => {
    setSelectedOfferingIds((current) =>
      current.includes(offeringId)
        ? current.filter((id) => id !== offeringId)
        : [...current, offeringId],
    )
  }, [])

  const updateTierPlan = useCallback(
    (tier: Tier, patch: Partial<TierPlanFormState>) => {
      setTierPlans((current) =>
        current.map((plan) =>
          plan.tier === tier
            ? {
                ...plan,
                ...patch,
              }
            : plan,
        ),
      )
    },
    [],
  )

  const resetCreateForm = useCallback(() => {
    setSelectedOfferingIds(reconcileSelectedOfferingIds([], offerings))
    setLocationType(DEFAULT_LOCATION_TYPE)
    setVisibilityMode(DEFAULT_VISIBILITY_MODE)
    setStartAtLocal(buildInitialStartAtLocal(timeZone))
    setEndAtLocal(buildInitialEndAtLocal(timeZone))
    setUseEndAt(true)
    setNote('')
    setTierPlans(buildInitialTierPlans())
  }, [offerings, timeZone])

  const createOpening = useCallback(async () => {
    if (busy) {
      return
    }

    setBusy(true)
    setError(null)

    try {
      if (selectedOfferingIds.length === 0) {
        throw new Error('Select at least one offering.')
      }

      const startAt = datetimeLocalToIso(startAtLocal, timeZone)

      if (!startAt) {
        throw new Error('Start time is invalid.')
      }

      const endAt = useEndAt
        ? datetimeLocalToIso(endAtLocal, timeZone)
        : null

      if (useEndAt && !endAt) {
        throw new Error('End time is invalid.')
      }

      if (endAt && new Date(endAt).getTime() <= new Date(startAt).getTime()) {
        throw new Error('End must be after start.')
      }

      const requestTierPlans = tierPlans.map(buildTierPlanRequest)

      const response = await fetch(OPENINGS_MUTATION_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          offeringIds: selectedOfferingIds,
          startAt,
          endAt,
          locationType,
          visibilityMode,
          note: note.trim() || null,
          tierPlans: requestTierPlans,
        }),
      })

      const data = await safeJsonRecord(response)

      if (!response.ok) {
        throw new Error(
          readErrorMessage(data) ?? 'Failed to create opening.',
        )
      }

      resetCreateForm()
      await loadOpenings()
      onCreated?.()
    } catch (caughtError: unknown) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Failed to create opening.',
      )
    } finally {
      setBusy(false)
    }
  }, [
    busy,
    selectedOfferingIds,
    startAtLocal,
    timeZone,
    useEndAt,
    endAtLocal,
    tierPlans,
    locationType,
    visibilityMode,
    note,
    resetCreateForm,
    loadOpenings,
    onCreated,
  ])

  const cancelOpening = useCallback(
    async (openingId: string) => {
      if (busy) {
        return
      }

      setBusy(true)
      setError(null)

      try {
        const response = await fetch(
          `${OPENINGS_MUTATION_ENDPOINT}?id=${encodeURIComponent(openingId)}`,
          {
            method: 'DELETE',
          },
        )
        const data = await safeJsonRecord(response)

        if (!response.ok) {
          throw new Error(
            readErrorMessage(data) ?? 'Failed to cancel opening.',
          )
        }

        await loadOpenings()
      } catch (caughtError: unknown) {
        setError(
          caughtError instanceof Error
            ? caughtError.message
            : 'Failed to cancel opening.',
        )
      } finally {
        setBusy(false)
      }
    },
    [busy, loadOpenings],
  )

  return useMemo(
    () => ({
      offerings,
      timeZone,
      items,
      loading,
      busy,
      error,
      selectedOfferingIds,
      selectedOfferingCountLabel,
      locationType,
      visibilityMode,
      startAtLocal,
      endAtLocal,
      useEndAt,
      note,
      tierPlans,
      canCreateOpening,
      loadOpenings,
      createOpening,
      cancelOpening,
      toggleOffering,
      setLocationType,
      setVisibilityMode,
      setStartAtLocal,
      setEndAtLocal,
      setUseEndAt,
      setNote,
      updateTierPlan,
    }),
    [
      offerings,
      timeZone,
      items,
      loading,
      busy,
      error,
      selectedOfferingIds,
      selectedOfferingCountLabel,
      locationType,
      visibilityMode,
      startAtLocal,
      endAtLocal,
      useEndAt,
      note,
      tierPlans,
      canCreateOpening,
      loadOpenings,
      createOpening,
      cancelOpening,
      toggleOffering,
      updateTierPlan,
    ],
  )
}

function useLastMinuteOpenings(): LastMinuteOpeningsContextValue {
  const context = useContext(LastMinuteOpeningsContext)

  if (!context) {
    throw new Error(
      'Last Minute openings components must be used inside LastMinuteOpeningsProvider.',
    )
  }

  return context
}

export function LastMinuteOpeningsProvider({
  offerings,
  onCreated,
  children,
}: LastMinuteOpeningsProviderProps) {
  const value = useLastMinuteOpeningsController({
    offerings,
    onCreated,
  })

  return (
    <LastMinuteOpeningsContext.Provider value={value}>
      {children}
    </LastMinuteOpeningsContext.Provider>
  )
}

function OpeningErrorMessage() {
  const { error } = useLastMinuteOpenings()

  if (!error) {
    return null
  }

  return (
    <div className="lm-opening-error" role="alert">
      {error}
    </div>
  )
}

function FieldCaption({ children }: { children: ReactNode }) {
  return <div className="lm-opening-field-caption">{children}</div>
}

function FieldLabel({ children }: { children: ReactNode }) {
  return <span className="lm-opening-field-label">{children}</span>
}

function TierPlanEditor({ plan }: { plan: TierPlanFormState }) {
  const { busy, updateTierPlan } = useLastMinuteOpenings()

  return (
    <div className="lm-tier-plan-editor">
      <div className="lm-tier-plan-editor-header">
        <div className="lm-tier-plan-copy">
          <div className="lm-tier-plan-title">{tierLabel(plan.tier)}</div>
          <div className="lm-tier-plan-hint">{tierHint(plan.tier)}</div>
        </div>

        <label className="lm-opening-select-wrap">
          <FieldLabel>Incentive</FieldLabel>
          <select
            value={plan.offerType}
            disabled={busy}
            className="lm-opening-field"
            onChange={(event) => {
              const next = parseOfferType(event.currentTarget.value)

              if (!next) {
                return
              }

              updateTierPlan(plan.tier, {
                offerType: next,
                percentOff: '',
                amountOff: '',
                freeAddOnServiceId: '',
              })
            }}
          >
            {OFFER_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {plan.offerType === 'PERCENT_OFF' ? (
        <label className="lm-opening-field-group">
          <FieldLabel>Percent off</FieldLabel>
          <input
            value={plan.percentOff}
            disabled={busy}
            inputMode="numeric"
            placeholder="e.g. 10"
            className="lm-opening-field"
            onChange={(event) =>
              updateTierPlan(plan.tier, {
                percentOff: event.currentTarget.value,
              })
            }
          />
        </label>
      ) : null}

      {plan.offerType === 'AMOUNT_OFF' ? (
        <label className="lm-opening-field-group">
          <FieldLabel>Amount off</FieldLabel>
          <input
            value={plan.amountOff}
            disabled={busy}
            inputMode="decimal"
            placeholder="e.g. 20"
            className="lm-opening-field"
            onChange={(event) =>
              updateTierPlan(plan.tier, {
                amountOff: event.currentTarget.value,
              })
            }
          />
        </label>
      ) : null}

      {plan.offerType === 'FREE_ADD_ON' ? (
        <div className="lm-opening-field-group">
          <label className="lm-opening-field-group">
            <FieldLabel>Free add-on service ID</FieldLabel>
            <input
              value={plan.freeAddOnServiceId}
              disabled={busy}
              placeholder="Paste add-on service ID"
              className="lm-opening-field"
              onChange={(event) =>
                updateTierPlan(plan.tier, {
                  freeAddOnServiceId: event.currentTarget.value,
                })
              }
            />
          </label>

          <FieldCaption>
            This is still an ID field until the page payload includes eligible
            add-on services.
          </FieldCaption>
        </div>
      ) : null}
    </div>
  )
}

export function LastMinuteCreateOpeningPanel() {
  const {
    offerings,
    timeZone,
    busy,
    selectedOfferingIds,
    selectedOfferingCountLabel,
    locationType,
    visibilityMode,
    startAtLocal,
    endAtLocal,
    useEndAt,
    note,
    tierPlans,
    canCreateOpening,
    createOpening,
    toggleOffering,
    setLocationType,
    setVisibilityMode,
    setStartAtLocal,
    setEndAtLocal,
    setUseEndAt,
    setNote,
  } = useLastMinuteOpenings()

  return (
    <section
      className="lm-opening-create-panel"
      aria-label="Create a last-minute opening"
    >
      <div className="lm-opening-panel-header">
        <div className="lm-opening-panel-title">
          Create a last-minute opening
        </div>
        <p className="lm-opening-panel-copy">
          Build the slot once, then let waitlist, reactivation, and discovery
          roll out through the backend workflow.
        </p>
      </div>

      <form
        className="lm-opening-form"
        onSubmit={(event) => {
          event.preventDefault()
          void createOpening()
        }}
      >
        <div className="lm-opening-form-section">
          <div className="lm-opening-form-section-header">
            <FieldLabel>Offerings</FieldLabel>
            <FieldCaption>{selectedOfferingCountLabel}</FieldCaption>
          </div>

          <div className="lm-offering-option-list">
            {offerings.length === 0 ? (
              <div className="lm-opening-empty">
                No active offerings available.
              </div>
            ) : (
              offerings.map((offering) => {
                const checked = selectedOfferingIds.includes(offering.id)

                return (
                  <label
                    key={offering.id}
                    className="lm-offering-option"
                    data-selected={checked ? 'true' : 'false'}
                  >
                    <span className="lm-offering-option-copy">
                      <span className="lm-offering-option-name">
                        {offering.name}
                      </span>
                      <span className="lm-offering-option-meta">
                        Starting at ${offering.basePrice}
                      </span>
                    </span>

                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={busy}
                      className="lm-opening-checkbox"
                      onChange={() => toggleOffering(offering.id)}
                    />
                  </label>
                )
              })
            )}
          </div>
        </div>

        <div className="lm-opening-form-grid">
          <label className="lm-opening-field-group">
            <FieldLabel>Location type</FieldLabel>
            <select
              value={locationType}
              disabled={busy}
              className="lm-opening-field"
              onChange={(event) => {
                const next = parseLocationType(event.currentTarget.value)

                if (next) {
                  setLocationType(next)
                }
              }}
            >
              {LOCATION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="lm-opening-field-group">
            <FieldLabel>Visibility</FieldLabel>
            <select
              value={visibilityMode}
              disabled={busy}
              className="lm-opening-field"
              onChange={(event) => {
                const next = parseVisibilityMode(event.currentTarget.value)

                if (next) {
                  setVisibilityMode(next)
                }
              }}
            >
              {VISIBILITY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="lm-opening-form-grid">
          <label className="lm-opening-field-group">
            <FieldLabel>Start</FieldLabel>
            <input
              type="datetime-local"
              value={startAtLocal}
              disabled={busy}
              className="lm-opening-field"
              onChange={(event) => setStartAtLocal(event.currentTarget.value)}
            />
          </label>

          <label className="lm-opening-field-group">
            <FieldLabel>End {useEndAt ? '' : '(optional)'}</FieldLabel>
            <input
              type="datetime-local"
              value={endAtLocal}
              disabled={busy || !useEndAt}
              className="lm-opening-field"
              data-muted={!useEndAt ? 'true' : 'false'}
              onChange={(event) => setEndAtLocal(event.currentTarget.value)}
            />
          </label>
        </div>

        <label className="lm-opening-inline-check">
          <input
            type="checkbox"
            checked={useEndAt}
            disabled={busy}
            className="lm-opening-checkbox"
            onChange={() => setUseEndAt(!useEndAt)}
          />
          <span>Include an end time</span>
        </label>

        <label className="lm-opening-field-group">
          <FieldLabel>Note optional</FieldLabel>
          <input
            value={note}
            disabled={busy}
            placeholder="e.g. Great for trims, touch-ups, or quick maintenance."
            className="lm-opening-field"
            onChange={(event) => setNote(event.currentTarget.value)}
          />
        </label>

        <div className="lm-opening-form-section">
          <div className="lm-opening-form-section-header">
            <FieldLabel>Tier plans</FieldLabel>
            <FieldCaption>
              Waitlist goes first, then reactivation, then discovery. Launch
              timing stays server-owned.
            </FieldCaption>
          </div>

          <div className="lm-tier-plan-list">
            {tierPlans.map((plan) => (
              <TierPlanEditor key={plan.tier} plan={plan} />
            ))}
          </div>
        </div>

        <div className="lm-opening-form-footer">
          <div className="lm-opening-timezone-note">
            Times entered in{' '}
            <strong>{sanitizeTimeZone(timeZone, 'UTC')}</strong>
          </div>

          <button
            type="submit"
            disabled={busy || !canCreateOpening}
            className="lm-opening-button"
            data-variant="primary"
          >
            {busy ? 'Working…' : 'Create opening'}
          </button>
        </div>

        <OpeningErrorMessage />
      </form>
    </section>
  )
}

function TierPlanChip({ plan, timeZone }: { plan: TierPlanRow; timeZone: string }) {
  return (
    <div className="lm-opening-tier-chip">
      <div className="lm-opening-tier-chip-main">
        <span className="lm-opening-tier-chip-title">
          {tierLabel(plan.tier)}
        </span>
        <span className="lm-opening-tier-chip-time">
          {prettyWhenInTimeZone(plan.scheduledFor, timeZone)}
        </span>
      </div>

      <div className="lm-opening-tier-chip-meta">
        <span>{describeTierPlan(plan)}</span>
        {plan.processedAt ? <span>Processed</span> : null}
        {plan.cancelledAt ? <span>Cancelled</span> : null}
        {plan.lastError ? (
          <span className="lm-opening-tier-chip-error">{plan.lastError}</span>
        ) : null}
      </div>
    </div>
  )
}

function OpeningCard({ opening }: { opening: OpeningRow }) {
  const { busy, cancelOpening } = useLastMinuteOpenings()
  const status = statusLabel(opening.status)
  const isActive = status === 'ACTIVE'

  return (
    <article className="lm-opening-card">
      <div className="lm-opening-card-header">
        <div className="lm-opening-card-main">
          <h3 className="lm-opening-card-title">{serviceSummary(opening)}</h3>

          <div className="lm-opening-card-time">
            {prettyWhenInTimeZone(opening.startAt, opening.timeZone)} ·{' '}
            {sanitizeTimeZone(opening.timeZone, 'UTC')}
          </div>

          <div className="lm-opening-card-meta">
            {opening.locationType} · {visibilityLabel(opening.visibilityMode)} ·{' '}
            {locationSummary(opening)}
          </div>
        </div>

        <div className="lm-opening-card-status">
          <span className="lm-opening-status-pill">{status}</span>
          <span>{opening.recipientCount} recipients</span>
        </div>
      </div>

      {opening.note ? (
        <p className="lm-opening-card-note">{opening.note}</p>
      ) : null}

      <div className="lm-opening-tier-chip-list">
        {opening.tierPlans.map((plan) => (
          <TierPlanChip
            key={plan.id}
            plan={plan}
            timeZone={opening.timeZone}
          />
        ))}
      </div>

      <div className="lm-opening-card-actions">
        <button
          type="button"
          disabled={busy || !isActive}
          className="lm-opening-button"
          data-variant="danger"
          onClick={() => {
            void cancelOpening(opening.id)
          }}
        >
          Cancel opening
        </button>
      </div>
    </article>
  )
}

export function LastMinuteOpeningsListPanel() {
  const { items, loading, busy, loadOpenings } = useLastMinuteOpenings()

  return (
    <section
      className="lm-opening-list-panel"
      aria-label="Last-minute openings list"
    >
      <div className="lm-opening-panel-header" data-layout="split">
        <div>
          <div className="lm-opening-panel-title">Your openings</div>
          <p className="lm-opening-panel-copy">
            Next 48 hours. Rollouts schedule automatically from the opening
            tier plan.
          </p>
        </div>

        <button
          type="button"
          disabled={loading || busy}
          className="lm-opening-button"
          data-variant="ghost"
          onClick={() => {
            void loadOpenings()
          }}
        >
          Refresh
        </button>
      </div>

      <div className="lm-opening-list">
        {loading ? (
          <div className="lm-opening-empty">Loading…</div>
        ) : items.length === 0 ? (
          <div className="lm-opening-empty">No openings yet.</div>
        ) : (
          items.map((opening) => (
            <OpeningCard key={opening.id} opening={opening} />
          ))
        )}
      </div>

      <OpeningErrorMessage />
    </section>
  )
}

function LastMinuteCombinedOpenings() {
  return (
    <div className="lm-openings-client" data-view="combined">
      <LastMinuteCreateOpeningPanel />
      <LastMinuteOpeningsListPanel />
    </div>
  )
}

export default function OpeningsClient({
  offerings,
  view = 'combined',
  onCreated,
}: Props) {
  return (
    <LastMinuteOpeningsProvider offerings={offerings} onCreated={onCreated}>
      {view === 'create' ? <LastMinuteCreateOpeningPanel /> : null}
      {view === 'list' ? <LastMinuteOpeningsListPanel /> : null}
      {view === 'combined' ? <LastMinuteCombinedOpenings /> : null}
    </LastMinuteOpeningsProvider>
  )
}