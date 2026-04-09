// app/pro/last-minute/OpeningsClient.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getZonedParts, isValidIanaTimeZone, sanitizeTimeZone, zonedTimeToUtc } from '@/lib/timeZone'
import { safeJsonRecord, readErrorMessage } from '@/lib/http'
import { isRecord } from '@/lib/guards'
import { pickStringOrEmpty } from '@/lib/pick'

type OfferingLite = {
  id: string
  serviceId: string
  name: string
  basePrice: string
}

type Props = {
  offerings: OfferingLite[]
}

type LocationType = 'SALON' | 'MOBILE'
type VisibilityMode = 'TARGETED_ONLY' | 'PUBLIC_AT_DISCOVERY' | 'PUBLIC_IMMEDIATE'
type Tier = 'WAITLIST' | 'REACTIVATION' | 'DISCOVERY'
type OfferType = 'NONE' | 'PERCENT_OFF' | 'AMOUNT_OFF' | 'FREE_SERVICE' | 'FREE_ADD_ON'

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
  freeAddOnService: { id: string; name: string } | null
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

const DEFAULT_VISIBILITY_MODE: VisibilityMode = 'PUBLIC_AT_DISCOVERY'
const DEFAULT_LOCATION_TYPE: LocationType = 'SALON'

const INITIAL_TIER_PLANS: TierPlanFormState[] = [
  {
    tier: 'WAITLIST',
    offerType: 'NONE',
    percentOff: '',
    amountOff: '',
    freeAddOnServiceId: '',
  },
  {
    tier: 'REACTIVATION',
    offerType: 'NONE',
    percentOff: '',
    amountOff: '',
    freeAddOnServiceId: '',
  },
  {
    tier: 'DISCOVERY',
    offerType: 'NONE',
    percentOff: '',
    amountOff: '',
    freeAddOnServiceId: '',
  },
]

function getBrowserTimeZone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (tz && isValidIanaTimeZone(tz)) return tz
  } catch {
    // ignore
  }
  return 'UTC'
}

function parseDatetimeLocal(value: string) {
  const m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/)
  if (!m) return null

  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  const hour = Number(m[4])
  const minute = Number(m[5])

  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null

  return { year, month, day, hour, minute }
}

function toDatetimeLocalFromIso(isoUtc: string, timeZone: string) {
  const d = new Date(isoUtc)
  if (Number.isNaN(d.getTime())) return ''

  const tz = sanitizeTimeZone(timeZone, 'UTC')
  const p = getZonedParts(d, tz)
  const pad = (n: number) => String(n).padStart(2, '0')

  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`
}

function datetimeLocalToIso(value: string, timeZone: string) {
  const parts = parseDatetimeLocal(value)
  if (!parts) return null

  const tz = sanitizeTimeZone(timeZone, 'UTC')
  const utc = zonedTimeToUtc({ ...parts, second: 0, timeZone: tz })
  return Number.isNaN(utc.getTime()) ? null : utc.toISOString()
}

function prettyWhenInTimeZone(isoUtc: string, timeZone: string) {
  const d = new Date(isoUtc)
  if (Number.isNaN(d.getTime())) return 'Invalid date'

  const tz = sanitizeTimeZone(timeZone, 'UTC')
  return new Intl.DateTimeFormat(undefined, {
    timeZone: tz,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d)
}

function asStringOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null
}

function asNumberOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function readArrayField(data: Record<string, unknown> | null, key: string): unknown[] {
  if (!data) return []
  const v = data[key]
  return Array.isArray(v) ? v : []
}

function parseOpeningServiceRow(x: unknown): OpeningServiceRow | null {
  if (!isRecord(x)) return null

  const id = pickStringOrEmpty(x.id)
  const openingId = pickStringOrEmpty(x.openingId)
  const serviceId = pickStringOrEmpty(x.serviceId)
  const offeringId = pickStringOrEmpty(x.offeringId)
  const createdAt = pickStringOrEmpty(x.createdAt)
  const sortOrder = asNumberOrNull(x.sortOrder)

  if (!id || !openingId || !serviceId || !offeringId || !createdAt || sortOrder == null) {
    return null
  }

  if (!isRecord(x.service) || !isRecord(x.offering)) return null

  const serviceName = asStringOrNull(x.service.name)
  const serviceMinPrice = asStringOrNull(x.service.minPrice)
  const serviceDefaultDurationMinutes = asNumberOrNull(x.service.defaultDurationMinutes)
  const isAddOnEligible = typeof x.service.isAddOnEligible === 'boolean' ? x.service.isAddOnEligible : null
  const addOnGroup = x.service.addOnGroup === null ? null : asStringOrNull(x.service.addOnGroup)

  if (!serviceName || !serviceMinPrice || serviceDefaultDurationMinutes == null || isAddOnEligible == null) {
    return null
  }

  const offeringTitle = x.offering.title === null ? null : asStringOrNull(x.offering.title)
  const offersInSalon = typeof x.offering.offersInSalon === 'boolean' ? x.offering.offersInSalon : null
  const offersMobile = typeof x.offering.offersMobile === 'boolean' ? x.offering.offersMobile : null
  const salonPriceStartingAt =
    x.offering.salonPriceStartingAt === null ? null : asStringOrNull(x.offering.salonPriceStartingAt)
  const salonDurationMinutes =
    x.offering.salonDurationMinutes === null ? null : asNumberOrNull(x.offering.salonDurationMinutes)
  const mobilePriceStartingAt =
    x.offering.mobilePriceStartingAt === null ? null : asStringOrNull(x.offering.mobilePriceStartingAt)
  const mobileDurationMinutes =
    x.offering.mobileDurationMinutes === null ? null : asNumberOrNull(x.offering.mobileDurationMinutes)

  if (offersInSalon == null || offersMobile == null) return null

  return {
    id,
    openingId,
    serviceId,
    offeringId,
    sortOrder,
    createdAt,
    service: {
      id: serviceId,
      name: serviceName,
      minPrice: serviceMinPrice,
      defaultDurationMinutes: serviceDefaultDurationMinutes,
      isAddOnEligible,
      addOnGroup,
    },
    offering: {
      id: offeringId,
      title: offeringTitle,
      offersInSalon,
      offersMobile,
      salonPriceStartingAt,
      salonDurationMinutes,
      mobilePriceStartingAt,
      mobileDurationMinutes,
    },
  }
}

function isTier(value: string): value is Tier {
  return value === 'WAITLIST' || value === 'REACTIVATION' || value === 'DISCOVERY'
}

function isOfferType(value: string): value is OfferType {
  return (
    value === 'NONE' ||
    value === 'PERCENT_OFF' ||
    value === 'AMOUNT_OFF' ||
    value === 'FREE_SERVICE' ||
    value === 'FREE_ADD_ON'
  )
}

function parseTierPlanRow(x: unknown): TierPlanRow | null {
  if (!isRecord(x)) return null

  const id = pickStringOrEmpty(x.id)
  const openingId = pickStringOrEmpty(x.openingId)
  const tierRaw = pickStringOrEmpty(x.tier)
  const scheduledFor = pickStringOrEmpty(x.scheduledFor)
  const offerTypeRaw = pickStringOrEmpty(x.offerType)
  const createdAt = pickStringOrEmpty(x.createdAt)
  const updatedAt = pickStringOrEmpty(x.updatedAt)

  if (!id || !openingId || !tierRaw || !scheduledFor || !offerTypeRaw || !createdAt || !updatedAt) {
    return null
  }

  if (!isTier(tierRaw) || !isOfferType(offerTypeRaw)) return null

  const freeAddOnService = (() => {
    if (x.freeAddOnService === null || x.freeAddOnService === undefined) return null
    if (!isRecord(x.freeAddOnService)) return null

    const serviceId = pickStringOrEmpty(x.freeAddOnService.id)
    const serviceName = asStringOrNull(x.freeAddOnService.name)
    if (!serviceId || !serviceName) return null

    return {
      id: serviceId,
      name: serviceName,
    }
  })()

  return {
    id,
    openingId,
    tier: tierRaw,
    scheduledFor,
    processedAt: x.processedAt === null ? null : asStringOrNull(x.processedAt),
    cancelledAt: x.cancelledAt === null ? null : asStringOrNull(x.cancelledAt),
    lastError: x.lastError === null ? null : asStringOrNull(x.lastError),
    offerType: offerTypeRaw,
    percentOff: x.percentOff === null ? null : asNumberOrNull(x.percentOff),
    amountOff: x.amountOff === null ? null : asStringOrNull(x.amountOff),
    freeAddOnServiceId: x.freeAddOnServiceId === null ? null : asStringOrNull(x.freeAddOnServiceId),
    freeAddOnService,
    createdAt,
    updatedAt,
  }
}

function parseOpeningRow(x: unknown): OpeningRow | null {
  if (!isRecord(x)) return null

  const id = pickStringOrEmpty(x.id)
  const professionalId = pickStringOrEmpty(x.professionalId)
  const status = pickStringOrEmpty(x.status)
  const visibilityModeRaw = pickStringOrEmpty(x.visibilityMode)
  const startAt = pickStringOrEmpty(x.startAt)
  const locationTypeRaw = pickStringOrEmpty(x.locationType)
  const locationId = pickStringOrEmpty(x.locationId)
  const timeZone = pickStringOrEmpty(x.timeZone)
  const recipientCount = asNumberOrNull(x.recipientCount)

  if (!id || !professionalId || !status || !visibilityModeRaw || !startAt || !locationTypeRaw || !locationId || !timeZone) {
    return null
  }

  if (
    visibilityModeRaw !== 'TARGETED_ONLY' &&
    visibilityModeRaw !== 'PUBLIC_AT_DISCOVERY' &&
    visibilityModeRaw !== 'PUBLIC_IMMEDIATE'
  ) {
    return null
  }

  if (locationTypeRaw !== 'SALON' && locationTypeRaw !== 'MOBILE') return null
  if (recipientCount == null) return null

  const location = (() => {
    if (x.location === null || x.location === undefined) return null
    if (!isRecord(x.location)) return null

    const locationInnerId = pickStringOrEmpty(x.location.id)
    const type = pickStringOrEmpty(x.location.type)
    if (!locationInnerId || !type) return null

    return {
      id: locationInnerId,
      type,
      name: x.location.name === null ? null : asStringOrNull(x.location.name),
      city: x.location.city === null ? null : asStringOrNull(x.location.city),
      state: x.location.state === null ? null : asStringOrNull(x.location.state),
      formattedAddress:
        x.location.formattedAddress === null ? null : asStringOrNull(x.location.formattedAddress),
      timeZone: x.location.timeZone === null ? null : asStringOrNull(x.location.timeZone),
      lat: x.location.lat === null ? null : asStringOrNull(x.location.lat),
      lng: x.location.lng === null ? null : asStringOrNull(x.location.lng),
    }
  })()

  const services = readArrayField(x, 'services')
    .map(parseOpeningServiceRow)
    .filter((row): row is OpeningServiceRow => row !== null)

  const tierPlans = readArrayField(x, 'tierPlans')
    .map(parseTierPlanRow)
    .filter((row): row is TierPlanRow => row !== null)

  return {
    id,
    professionalId,
    status,
    visibilityMode: visibilityModeRaw,
    startAt,
    endAt: x.endAt === null ? null : asStringOrNull(x.endAt),
    launchAt: x.launchAt === null ? null : asStringOrNull(x.launchAt),
    expiresAt: x.expiresAt === null ? null : asStringOrNull(x.expiresAt),
    publicVisibleFrom: x.publicVisibleFrom === null ? null : asStringOrNull(x.publicVisibleFrom),
    publicVisibleUntil: x.publicVisibleUntil === null ? null : asStringOrNull(x.publicVisibleUntil),
    bookedAt: x.bookedAt === null ? null : asStringOrNull(x.bookedAt),
    cancelledAt: x.cancelledAt === null ? null : asStringOrNull(x.cancelledAt),
    note: x.note === null ? null : asStringOrNull(x.note),
    locationType: locationTypeRaw,
    locationId,
    timeZone,
    recipientCount,
    location,
    services,
    tierPlans,
  }
}

function tierLabel(tier: Tier): string {
  if (tier === 'WAITLIST') return 'Tier 1 · Waitlist'
  if (tier === 'REACTIVATION') return 'Tier 2 · Reactivation'
  return 'Tier 3 · Discovery'
}

function visibilityLabel(mode: VisibilityMode): string {
  if (mode === 'TARGETED_ONLY') return 'Targeted only'
  if (mode === 'PUBLIC_IMMEDIATE') return 'Public immediately'
  return 'Public at discovery'
}

function offerTypeLabel(type: OfferType): string {
  if (type === 'PERCENT_OFF') return 'Percent off'
  if (type === 'AMOUNT_OFF') return 'Amount off'
  if (type === 'FREE_SERVICE') return 'Free service'
  if (type === 'FREE_ADD_ON') return 'Free add-on'
  return 'No incentive'
}

function describeTierPlan(plan: TierPlanRow): string {
  if (plan.offerType === 'PERCENT_OFF' && plan.percentOff != null) {
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

function buildInitialStartAtLocal(timeZone: string) {
  const now = new Date()
  now.setSeconds(0, 0)
  now.setMinutes(0)
  now.setHours(now.getHours() + 1)
  return toDatetimeLocalFromIso(now.toISOString(), timeZone)
}

function buildInitialEndAtLocal(timeZone: string) {
  const now = new Date()
  now.setSeconds(0, 0)
  now.setMinutes(0)
  now.setHours(now.getHours() + 2)
  return toDatetimeLocalFromIso(now.toISOString(), timeZone)
}

export default function OpeningsClient({ offerings }: Props) {
  const router = useRouter()
  const timeZone = useMemo(() => getBrowserTimeZone(), [])

  const [items, setItems] = useState<OpeningRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const [selectedOfferingIds, setSelectedOfferingIds] = useState<string[]>(() =>
    offerings[0]?.id ? [offerings[0].id] : [],
  )
  const [locationType, setLocationType] = useState<LocationType>(DEFAULT_LOCATION_TYPE)
  const [visibilityMode, setVisibilityMode] = useState<VisibilityMode>(DEFAULT_VISIBILITY_MODE)
  const [startAtLocal, setStartAtLocal] = useState(() => buildInitialStartAtLocal(timeZone))
  const [endAtLocal, setEndAtLocal] = useState(() => buildInitialEndAtLocal(timeZone))
  const [useEndAt, setUseEndAt] = useState(true)
  const [note, setNote] = useState('')
  const [tierPlans, setTierPlans] = useState<TierPlanFormState[]>(INITIAL_TIER_PLANS)

  useEffect(() => {
    if (selectedOfferingIds.length === 0 && offerings[0]?.id) {
      setSelectedOfferingIds([offerings[0].id])
    }
  }, [offerings, selectedOfferingIds])

  const offeringLabelById = useMemo(() => {
    const map = new Map<string, string>()
    for (const offering of offerings) {
      map.set(offering.id, `${offering.name} · $${offering.basePrice}`)
    }
    return map
  }, [offerings])

  const selectedOfferingCountLabel =
    selectedOfferingIds.length === 1
      ? '1 offering selected'
      : `${selectedOfferingIds.length} offerings selected`

  async function loadOpenings() {
    setLoading(true)
    setErr(null)

    try {
      const res = await fetch('/api/pro/openings?hours=48&take=100', { cache: 'no-store' })
      const data = await safeJsonRecord(res)

      if (!res.ok) {
        throw new Error(readErrorMessage(data) ?? 'Failed to load openings.')
      }

      const list = readArrayField(data, 'openings')
        .map(parseOpeningRow)
        .filter((row): row is OpeningRow => row !== null)

      list.sort((a, b) => +new Date(a.startAt) - +new Date(b.startAt))
      setItems(list)
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to load openings.')
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadOpenings()
  }, [])

  function toggleOffering(offeringId: string) {
    setSelectedOfferingIds((prev) =>
      prev.includes(offeringId) ? prev.filter((id) => id !== offeringId) : [...prev, offeringId],
    )
  }

  function updateTierPlan(
    tier: Tier,
    patch: Partial<TierPlanFormState>,
  ) {
    setTierPlans((prev) =>
      prev.map((plan) =>
        plan.tier === tier
          ? {
              ...plan,
              ...patch,
            }
          : plan,
      ),
    )
  }

  function resetCreateForm() {
    setSelectedOfferingIds(offerings[0]?.id ? [offerings[0].id] : [])
    setLocationType(DEFAULT_LOCATION_TYPE)
    setVisibilityMode(DEFAULT_VISIBILITY_MODE)
    setStartAtLocal(buildInitialStartAtLocal(timeZone))
    setEndAtLocal(buildInitialEndAtLocal(timeZone))
    setUseEndAt(true)
    setNote('')
    setTierPlans(INITIAL_TIER_PLANS)
  }

  async function createOpening() {
    if (busy) return
    setBusy(true)
    setErr(null)

    try {
      if (selectedOfferingIds.length === 0) {
        throw new Error('Select at least one offering.')
      }

      const startIso = datetimeLocalToIso(startAtLocal, timeZone)
      if (!startIso) {
        throw new Error('Start time is invalid.')
      }

      let endIso: string | null = null
      if (useEndAt) {
        endIso = datetimeLocalToIso(endAtLocal, timeZone)
        if (!endIso) {
          throw new Error('End time is invalid.')
        }
        if (+new Date(endIso) <= +new Date(startIso)) {
          throw new Error('End must be after start.')
        }
      }

      const requestTierPlans = tierPlans.map((plan) => {
        if (plan.offerType === 'PERCENT_OFF') {
          const percentOff = Number(plan.percentOff)
          if (!Number.isFinite(percentOff)) {
            throw new Error(`${tierLabel(plan.tier)} needs a valid percent-off value.`)
          }

          return {
            tier: plan.tier,
            offerType: plan.offerType,
            percentOff: Math.trunc(percentOff),
          }
        }

        if (plan.offerType === 'AMOUNT_OFF') {
          const amountOff = plan.amountOff.trim()
          if (!amountOff) {
            throw new Error(`${tierLabel(plan.tier)} needs an amount-off value.`)
          }

          return {
            tier: plan.tier,
            offerType: plan.offerType,
            amountOff,
          }
        }

        if (plan.offerType === 'FREE_ADD_ON') {
          const freeAddOnServiceId = plan.freeAddOnServiceId.trim()
          if (!freeAddOnServiceId) {
            throw new Error(`${tierLabel(plan.tier)} needs a free add-on service id.`)
          }

          return {
            tier: plan.tier,
            offerType: plan.offerType,
            freeAddOnServiceId,
          }
        }

        return {
          tier: plan.tier,
          offerType: plan.offerType,
        }
      })

      const res = await fetch('/api/pro/openings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          offeringIds: selectedOfferingIds,
          startAt: startIso,
          endAt: useEndAt ? endIso : null,
          locationType,
          visibilityMode,
          note: note.trim() || null,
          tierPlans: requestTierPlans,
        }),
      })

      const data = await safeJsonRecord(res)
      if (!res.ok) {
        throw new Error(readErrorMessage(data) ?? 'Failed to create opening.')
      }

      resetCreateForm()
      await loadOpenings()
      router.refresh()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to create opening.')
    } finally {
      setBusy(false)
    }
  }

  async function cancelOpening(openingId: string) {
    if (busy) return
    setBusy(true)
    setErr(null)

    try {
      const res = await fetch(`/api/pro/openings?id=${encodeURIComponent(openingId)}`, {
        method: 'DELETE',
      })
      const data = await safeJsonRecord(res)

      if (!res.ok) {
        throw new Error(readErrorMessage(data) ?? 'Failed to cancel opening.')
      }

      await loadOpenings()
      router.refresh()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to cancel opening.')
    } finally {
      setBusy(false)
    }
  }

  const card = 'tovis-glass rounded-card border border-white/10 bg-bgSecondary p-4'
  const label = 'text-[12px] font-black text-textPrimary'
  const hint = 'text-[12px] font-semibold text-textSecondary'
  const field =
    'w-full rounded-xl border border-white/10 bg-bgPrimary px-3 py-3 text-[13px] text-textPrimary placeholder:text-textSecondary/70 focus:outline-none focus:ring-2 focus:ring-accentPrimary/40 disabled:opacity-60'
  const btnPrimary =
    'rounded-full border border-accentPrimary/60 bg-accentPrimary px-4 py-2 text-[12px] font-black text-bgPrimary hover:bg-accentPrimaryHover disabled:opacity-60'
  const btnGhost =
    'rounded-full border border-white/10 bg-bgPrimary px-4 py-2 text-[12px] font-black text-textPrimary hover:bg-surfaceGlass disabled:opacity-60'
  const btnDanger =
    'rounded-full border border-white/10 bg-bgPrimary px-4 py-2 text-[12px] font-black text-toneDanger hover:bg-surfaceGlass disabled:opacity-60'
  const subCard = 'rounded-card border border-white/10 bg-bgPrimary p-3'

  return (
    <div className="grid gap-3">
      <section className={card}>
        <div className="text-[14px] font-black text-textPrimary">Create a last-minute opening</div>
        <div className={`${hint} mt-1`}>
          Build the slot once, then let waitlist, reactivation, and discovery roll out automatically.
        </div>

        <div className="mt-4 grid gap-4">
          <div className="grid gap-2">
            <div className={label}>Offerings</div>
            <div className={`${hint}`}>{selectedOfferingCountLabel}</div>

            <div className="grid gap-2">
              {offerings.length === 0 ? (
                <div className={hint}>No active offerings available.</div>
              ) : (
                offerings.map((offering) => {
                  const checked = selectedOfferingIds.includes(offering.id)
                  return (
                    <label
                      key={offering.id}
                      className={`${subCard} flex items-center justify-between gap-3 cursor-pointer`}
                    >
                      <div className="min-w-0">
                        <div className="text-[13px] font-black text-textPrimary truncate">{offering.name}</div>
                        <div className={hint}>Starting at ${offering.basePrice}</div>
                      </div>

                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={busy}
                        onChange={() => toggleOffering(offering.id)}
                        className="accent-accentPrimary"
                      />
                    </label>
                  )
                })
              )}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-2">
              <span className={label}>Location type</span>
              <select
                value={locationType}
                disabled={busy}
                onChange={(e) => {
                  const next = e.target.value
                  if (next === 'SALON' || next === 'MOBILE') {
                    setLocationType(next)
                  }
                }}
                className={field}
              >
                <option value="SALON">Salon</option>
                <option value="MOBILE">Mobile</option>
              </select>
            </label>

            <label className="grid gap-2">
              <span className={label}>Visibility</span>
              <select
                value={visibilityMode}
                disabled={busy}
                onChange={(e) => {
                  const next = e.target.value
                  if (
                    next === 'TARGETED_ONLY' ||
                    next === 'PUBLIC_AT_DISCOVERY' ||
                    next === 'PUBLIC_IMMEDIATE'
                  ) {
                    setVisibilityMode(next)
                  }
                }}
                className={field}
              >
                <option value="TARGETED_ONLY">Targeted only</option>
                <option value="PUBLIC_AT_DISCOVERY">Public at discovery</option>
                <option value="PUBLIC_IMMEDIATE">Public immediately</option>
              </select>
            </label>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-2">
              <span className={label}>Start</span>
              <input
                type="datetime-local"
                value={startAtLocal}
                disabled={busy}
                onChange={(e) => setStartAtLocal(e.target.value)}
                className={field}
              />
            </label>

            <label className="grid gap-2">
              <span className={label}>End {useEndAt ? '' : '(optional)'}</span>
              <input
                type="datetime-local"
                value={endAtLocal}
                disabled={busy || !useEndAt}
                onChange={(e) => setEndAtLocal(e.target.value)}
                className={[field, !useEndAt ? 'opacity-60' : ''].join(' ')}
              />
            </label>
          </div>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={useEndAt}
              disabled={busy}
              onChange={() => setUseEndAt((value) => !value)}
              className="accent-accentPrimary"
            />
            <span className="text-[12px] font-semibold text-textPrimary">Include an end time</span>
          </label>

          <label className="grid gap-2">
            <span className={label}>Note (optional)</span>
            <input
              value={note}
              disabled={busy}
              placeholder="e.g. Great for trims, touch-ups, or quick maintenance."
              onChange={(e) => setNote(e.target.value)}
              className={field}
            />
          </label>

          <div className="grid gap-3">
            <div>
              <div className="text-[13px] font-black text-textPrimary">Tier plans</div>
              <div className={`${hint} mt-1`}>
                Waitlist goes first, then reactivation, then discovery. Launch timing is handled by the backend.
              </div>
            </div>

            {tierPlans.map((plan) => (
              <div key={plan.tier} className={subCard}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-[13px] font-black text-textPrimary">{tierLabel(plan.tier)}</div>
                    <div className={hint}>
                      {plan.tier === 'WAITLIST'
                        ? 'Recommended: no incentive.'
                        : plan.tier === 'REACTIVATION'
                          ? 'Use a gentle nudge if needed.'
                          : 'This is your broadest audience.'}
                    </div>
                  </div>

                  <div className="min-w-[220px]">
                    <select
                      value={plan.offerType}
                      disabled={busy}
                      onChange={(e) => {
                        const next = e.target.value
                        if (
                          next === 'NONE' ||
                          next === 'PERCENT_OFF' ||
                          next === 'AMOUNT_OFF' ||
                          next === 'FREE_SERVICE' ||
                          next === 'FREE_ADD_ON'
                        ) {
                          updateTierPlan(plan.tier, {
                            offerType: next,
                            percentOff: '',
                            amountOff: '',
                            freeAddOnServiceId: '',
                          })
                        }
                      }}
                      className={field}
                    >
                      <option value="NONE">No incentive</option>
                      <option value="PERCENT_OFF">Percent off</option>
                      <option value="AMOUNT_OFF">Amount off</option>
                      <option value="FREE_SERVICE">Free service</option>
                      <option value="FREE_ADD_ON">Free add-on</option>
                    </select>
                  </div>
                </div>

                {plan.offerType === 'PERCENT_OFF' ? (
                  <div className="mt-3">
                    <label className="grid gap-2">
                      <span className={label}>Percent off</span>
                      <input
                        value={plan.percentOff}
                        disabled={busy}
                        inputMode="numeric"
                        placeholder="e.g. 10"
                        onChange={(e) => updateTierPlan(plan.tier, { percentOff: e.target.value })}
                        className={field}
                      />
                    </label>
                  </div>
                ) : null}

                {plan.offerType === 'AMOUNT_OFF' ? (
                  <div className="mt-3">
                    <label className="grid gap-2">
                      <span className={label}>Amount off</span>
                      <input
                        value={plan.amountOff}
                        disabled={busy}
                        inputMode="decimal"
                        placeholder="e.g. 20"
                        onChange={(e) => updateTierPlan(plan.tier, { amountOff: e.target.value })}
                        className={field}
                      />
                    </label>
                  </div>
                ) : null}

                {plan.offerType === 'FREE_ADD_ON' ? (
                  <div className="mt-3 grid gap-2">
                    <label className="grid gap-2">
                      <span className={label}>Free add-on service id</span>
                      <input
                        value={plan.freeAddOnServiceId}
                        disabled={busy}
                        placeholder="Paste add-on service id"
                        onChange={(e) =>
                          updateTierPlan(plan.tier, { freeAddOnServiceId: e.target.value })
                        }
                        className={field}
                      />
                    </label>
                    <div className={hint}>
                      This file does not have add-on service options yet. We’ll wire the selector once page data includes them.
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between gap-2">
            <div className="text-[12px] font-semibold text-textSecondary">
              Times entered in <span className="font-black">{sanitizeTimeZone(timeZone, 'UTC')}</span>
            </div>

            <button
              type="button"
              disabled={busy || offerings.length === 0}
              onClick={createOpening}
              className={btnPrimary}
            >
              {busy ? 'Working…' : 'Create opening'}
            </button>
          </div>

          {err ? <div className="text-[12px] font-black text-toneDanger">{err}</div> : null}
        </div>
      </section>

      <section className={card}>
        <div className="flex items-baseline justify-between gap-3">
          <div className="text-[14px] font-black text-textPrimary">Your openings</div>
          <button type="button" disabled={loading || busy} onClick={loadOpenings} className={btnGhost}>
            Refresh
          </button>
        </div>

        <div className={`${hint} mt-1`}>
          Next 48 hours. Rollouts schedule automatically from the tier plan you saved on the opening.
        </div>

        <div className="mt-4 grid gap-3">
          {loading ? (
            <div className={hint}>Loading…</div>
          ) : items.length === 0 ? (
            <div className={hint}>No openings yet.</div>
          ) : (
            items.map((opening) => {
              const when = prettyWhenInTimeZone(opening.startAt, opening.timeZone)
              const locationLabel = opening.location?.name || opening.location?.formattedAddress || opening.locationType
              const uniqueServiceNames = Array.from(
                new Set(opening.services.map((row) => row.service.name).filter((name) => name.length > 0)),
              )
              const serviceSummary = uniqueServiceNames.length > 0 ? uniqueServiceNames.join(', ') : 'Services'
              const status = String(opening.status || 'UNKNOWN').toUpperCase()

              return (
                <div key={opening.id} className="rounded-card border border-white/10 bg-bgPrimary p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[13px] font-black text-textPrimary">{serviceSummary}</div>
                      <div className="text-[12px] font-semibold text-textSecondary">
                        {when} · {sanitizeTimeZone(opening.timeZone, 'UTC')}
                      </div>
                      <div className="mt-1 text-[12px] font-semibold text-textSecondary">
                        {opening.locationType} · {visibilityLabel(opening.visibilityMode)} · {locationLabel}
                      </div>
                    </div>

                    <div className="text-right text-[12px] font-semibold text-textSecondary">
                      <div>{status}</div>
                      <div>{opening.recipientCount} recipients</div>
                    </div>
                  </div>

                  {opening.note ? (
                    <div className="mt-2 text-[12px] font-semibold text-textSecondary">{opening.note}</div>
                  ) : null}

                  <div className="mt-3 grid gap-2">
                    {opening.tierPlans.map((plan) => (
                      <div
                        key={plan.id}
                        className="rounded-xl border border-white/10 bg-bgSecondary/60 px-3 py-2 text-[12px] font-semibold text-textSecondary"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-black text-textPrimary">{tierLabel(plan.tier)}</span>
                          <span>{prettyWhenInTimeZone(plan.scheduledFor, opening.timeZone)}</span>
                        </div>

                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <span>{describeTierPlan(plan)}</span>
                          {plan.processedAt ? <span>· processed</span> : null}
                          {plan.cancelledAt ? <span>· cancelled</span> : null}
                          {plan.lastError ? <span className="text-toneDanger">· {plan.lastError}</span> : null}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-3 flex flex-wrap justify-end gap-2">
                    <button
                      type="button"
                      disabled={busy || status !== 'ACTIVE'}
                      onClick={() => cancelOpening(opening.id)}
                      className={btnDanger}
                    >
                      Cancel opening
                    </button>
                  </div>
                </div>
              )
            })
          )}

          {err ? <div className="text-[12px] font-black text-toneDanger">{err}</div> : null}
        </div>
      </section>
    </div>
  )
}