// app/(main)/booking/AvailabilityDrawer/hooks/useAvailability.ts
'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type {
  AvailabilityOffering,
  AvailabilityOtherPro,
  AvailabilitySummaryResponse,
  DrawerContext,
  ProCard,
  ServiceLocationType,
} from '../types'
import { safeJson } from '../utils/safeJson'
import { redirectToLogin } from '../utils/authRedirect'

type CacheEntry = {
  at: number
  data: AvailabilitySummaryResponse
}

const CACHE_TTL_MS = 30_000
const SOFT_THROTTLE_MS = 800

function isRecord(x: unknown): x is Record<string, unknown> {
  return Boolean(x && typeof x === 'object' && !Array.isArray(x))
}

function pickString(x: unknown): string | null {
  return typeof x === 'string' && x.trim() ? x.trim() : null
}

function pickNumber(x: unknown): number | null {
  return typeof x === 'number' && Number.isFinite(x) ? x : null
}

function pickBool(x: unknown): boolean | null {
  return typeof x === 'boolean' ? x : null
}

function pickApiError(raw: unknown): string | null {
  if (!isRecord(raw)) return null
  return pickString(raw.error)
}

function pickLocationType(x: unknown): ServiceLocationType | null {
  const s = pickString(x)?.toUpperCase() ?? ''
  if (s === 'SALON') return 'SALON'
  if (s === 'MOBILE') return 'MOBILE'
  return null
}

function parseOffering(x: unknown): AvailabilityOffering | null {
  if (!isRecord(x)) return null

  const id = pickString(x.id)
  const offersInSalon = pickBool(x.offersInSalon)
  const offersMobile = pickBool(x.offersMobile)
  if (!id || offersInSalon == null || offersMobile == null) return null

  const salonDurationMinutes = x.salonDurationMinutes == null ? null : pickNumber(x.salonDurationMinutes)
  const mobileDurationMinutes = x.mobileDurationMinutes == null ? null : pickNumber(x.mobileDurationMinutes)

  const salonPriceStartingAt = x.salonPriceStartingAt == null ? null : pickString(x.salonPriceStartingAt)
  const mobilePriceStartingAt = x.mobilePriceStartingAt == null ? null : pickString(x.mobilePriceStartingAt)

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

function parseProCardBase(x: unknown): ProCard | null {
  if (!isRecord(x)) return null
  const id = pickString(x.id)
  if (!id) return null

  const businessName = x.businessName == null ? null : pickString(x.businessName)
  const avatarUrl = x.avatarUrl == null ? null : pickString(x.avatarUrl)
  const location = x.location == null ? null : pickString(x.location)
  const offeringId = x.offeringId == null ? null : pickString(x.offeringId)
  const timeZone = x.timeZone == null ? null : pickString(x.timeZone)
  const isCreator = x.isCreator == null ? undefined : pickBool(x.isCreator) ?? undefined

  return {
    id,
    businessName: businessName ?? null,
    avatarUrl: avatarUrl ?? null,
    location: location ?? null,
    offeringId: offeringId ?? null,
    timeZone: timeZone ?? null,
    isCreator,
  }
}

function parseOtherPro(x: unknown): AvailabilityOtherPro | null {
  if (!isRecord(x)) return null

  const base = parseProCardBase(x)
  if (!base?.id) return null

  const offeringId = pickString(x.offeringId)
  const locationId = pickString(x.locationId)
  const timeZone = pickString(x.timeZone)
  if (!offeringId || !locationId || !timeZone) return null

  const distanceMiles = x.distanceMiles == null ? null : pickNumber(x.distanceMiles)

  return {
    ...base,
    offeringId,
    locationId,
    timeZone,
    distanceMiles: distanceMiles ?? null,
  }
}

function parseSummaryResponse(raw: unknown): AvailabilitySummaryResponse | null {
  if (!isRecord(raw)) return null

  if (raw.ok === false) {
    const error = pickApiError(raw)
    if (!error) return null
    const timeZone = raw.timeZone == null ? undefined : pickString(raw.timeZone) ?? undefined
    const locationId = raw.locationId == null ? undefined : pickString(raw.locationId) ?? undefined
    return { ok: false, error, timeZone, locationId }
  }

  if (raw.ok !== true) return null
  if (raw.mode !== 'SUMMARY') return null

  const mediaId = raw.mediaId === null ? null : pickString(raw.mediaId)
  if (raw.mediaId !== null && mediaId == null) return null

  const serviceId = pickString(raw.serviceId)
  const professionalId = pickString(raw.professionalId)
  const serviceName = pickString(raw.serviceName)
  const serviceCategoryName = raw.serviceCategoryName === null ? null : pickString(raw.serviceCategoryName)

  if (!serviceId || !professionalId || !serviceName) return null
  if (raw.serviceCategoryName !== null && serviceCategoryName == null) return null

  const locationType = pickLocationType(raw.locationType)
  const locationId = pickString(raw.locationId)
  const timeZone = pickString(raw.timeZone)
  if (!locationType || !locationId || !timeZone) return null

  const stepMinutes = pickNumber(raw.stepMinutes)
  const leadTimeMinutes = pickNumber(raw.leadTimeMinutes)
  const adjacencyBufferMinutes = pickNumber(raw.adjacencyBufferMinutes)
  const maxDaysAhead = pickNumber(raw.maxDaysAhead)
  const durationMinutes = pickNumber(raw.durationMinutes)

  if (
    stepMinutes == null ||
    leadTimeMinutes == null ||
    adjacencyBufferMinutes == null ||
    maxDaysAhead == null ||
    durationMinutes == null
  ) {
    return null
  }

  const primaryBase = parseProCardBase(raw.primaryPro)
  const primaryOfferingId = isRecord(raw.primaryPro) ? pickString(raw.primaryPro.offeringId) : null
  if (!primaryBase || !primaryOfferingId) return null

  const availableDaysRaw = raw.availableDays
  if (!Array.isArray(availableDaysRaw)) return null
  const availableDays: Array<{ date: string; slotCount: number }> = []
  for (const row of availableDaysRaw) {
    if (!isRecord(row)) return null
    const date = pickString(row.date)
    const slotCount = pickNumber(row.slotCount)
    if (!date || slotCount == null) return null
    availableDays.push({ date, slotCount })
  }

  const otherProsRaw = raw.otherPros
  if (!Array.isArray(otherProsRaw)) return null
  const otherPros: AvailabilityOtherPro[] = []
  for (const row of otherProsRaw) {
    const p = parseOtherPro(row)
    if (!p) return null
    otherPros.push(p)
  }

  const waitlistSupported = pickBool(raw.waitlistSupported)
  if (waitlistSupported == null) return null

  const offering = parseOffering(raw.offering)
  if (!offering) return null

  return {
    ok: true,
    mode: 'SUMMARY',
    mediaId: mediaId ?? null,
    serviceId,
    professionalId,
    serviceName,
    serviceCategoryName: serviceCategoryName ?? null,
    locationType,
    locationId,
    timeZone,
    stepMinutes,
    leadTimeMinutes,
    adjacencyBufferMinutes,
    maxDaysAhead,
    durationMinutes,
    primaryPro: {
      ...primaryBase,
      offeringId: primaryOfferingId,
      isCreator: true as const,
      timeZone,
    },
    availableDays,
    otherPros,
    waitlistSupported,
    offering,
  }
}

function buildQueryKey(args: {
  proId: string
  serviceId: string
  locationType: ServiceLocationType
  mediaId?: string
  viewer?: { lat: number; lng: number; radiusMiles: number | null; placeId: string | null } | null
}) {
  const v = args.viewer
  const vKey = v ? `|v=${v.lat.toFixed(4)},${v.lng.toFixed(4)},${v.radiusMiles ?? ''},${v.placeId ?? ''}` : ''
  return `pro=${args.proId}|service=${args.serviceId}|loc=${args.locationType}|media=${args.mediaId || ''}${vKey}`
}

export function useAvailability(open: boolean, context: DrawerContext, locationType: ServiceLocationType) {
  const router = useRouter()

  const abortRef = useRef<AbortController | null>(null)
  const cacheRef = useRef<Map<string, CacheEntry>>(new Map())
  const inFlightKeyRef = useRef<string | null>(null)
  const lastRequestAtRef = useRef<number>(0)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<AvailabilitySummaryResponse | null>(null)

  const proId = useMemo(() => String(context.professionalId || '').trim(), [context.professionalId])
  const serviceId = useMemo(() => String(context.serviceId || '').trim(), [context.serviceId])
  const mediaId = useMemo(() => (context.mediaId ? String(context.mediaId).trim() : ''), [context.mediaId])

  const viewer = useMemo(() => {
    const lat = typeof context.viewerLat === 'number' && Number.isFinite(context.viewerLat) ? context.viewerLat : null
    const lng = typeof context.viewerLng === 'number' && Number.isFinite(context.viewerLng) ? context.viewerLng : null
    if (lat == null || lng == null) return null

    const radiusMiles =
      typeof context.viewerRadiusMiles === 'number' && Number.isFinite(context.viewerRadiusMiles)
        ? context.viewerRadiusMiles
        : null

    const placeId = typeof context.viewerPlaceId === 'string' && context.viewerPlaceId.trim() ? context.viewerPlaceId.trim() : null

    return { lat, lng, radiusMiles, placeId }
  }, [context.viewerLat, context.viewerLng, context.viewerRadiusMiles, context.viewerPlaceId])

  const queryKey = useMemo(
    () => buildQueryKey({ proId, serviceId, locationType, mediaId, viewer }),
    [proId, serviceId, locationType, mediaId, viewer],
  )

  const cleanup = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    inFlightKeyRef.current = null
  }, [])

  useEffect(() => cleanup, [cleanup])

  const fetchAvailability = useCallback(
    async (key: string) => {
      if (inFlightKeyRef.current === key) return

      const now = Date.now()
      const hit = cacheRef.current.get(key)
      const hasUsableData = Boolean(hit?.data)

      if (now - lastRequestAtRef.current < SOFT_THROTTLE_MS && hasUsableData) return
      lastRequestAtRef.current = now

      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      inFlightKeyRef.current = key

      setLoading(true)
      setError(null)
      // ✅ do NOT clear existing data here (premium refresh UX)

      const qs = new URLSearchParams()
      qs.set('professionalId', proId)
      qs.set('serviceId', serviceId)
      qs.set('locationType', locationType)
      if (mediaId) qs.set('mediaId', mediaId)

      if (viewer) {
        qs.set('viewerLat', String(viewer.lat))
        qs.set('viewerLng', String(viewer.lng))
        if (viewer.radiusMiles != null) qs.set('radiusMiles', String(viewer.radiusMiles))
        if (viewer.placeId) qs.set('viewerPlaceId', viewer.placeId)
      }

      try {
        const res = await fetch(`/api/availability/day?${qs.toString()}`, {
          method: 'GET',
          cache: 'no-store',
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        })

        const raw = await safeJson(res)

        if (res.status === 401) {
          redirectToLogin(router, 'availability')
          throw new Error('Please log in to view availability.')
        }

        if (!res.ok) {
          throw new Error(pickApiError(raw) ?? `Request failed (${res.status}).`)
        }

        const parsed = parseSummaryResponse(raw)
        if (!parsed || parsed.ok !== true || parsed.mode !== 'SUMMARY') {
          throw new Error('Availability endpoint returned unexpected response.')
        }

        cacheRef.current.set(key, { at: Date.now(), data: parsed })
        setData(parsed)
      } catch (e: unknown) {
        if (e instanceof Error && e.name === 'AbortError') return
        setError(e instanceof Error ? e.message : 'Failed to load availability.')
      } finally {
        if (abortRef.current === controller) abortRef.current = null
        if (inFlightKeyRef.current === key) inFlightKeyRef.current = null
        setLoading(false)
      }
    },
    [router, proId, serviceId, locationType, mediaId, viewer],
  )

  useEffect(() => {
    if (!open) return

    if (!proId) {
      setLoading(false)
      setData(null)
      setError('Missing professional. Please try again.')
      return
    }

    if (!serviceId) {
      setLoading(false)
      setData(null)
      setError('No service is linked yet. Ask the pro to attach a service to this look.')
      return
    }

    const hit = cacheRef.current.get(queryKey)
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
      setData(hit.data)
      void fetchAvailability(queryKey)
      return
    }

    void fetchAvailability(queryKey)
  }, [open, proId, serviceId, queryKey, fetchAvailability])

  return { loading, error, data, setError, setData }
}