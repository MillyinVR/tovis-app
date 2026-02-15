// app/(main)/booking/AvailabilityDrawer/hooks/useAvailability.ts
'use client'

import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import type { AvailabilitySummaryResponse, DrawerContext, ServiceLocationType } from '../types'
import { safeJson } from '../utils/safeJson'
import { redirectToLogin } from '../utils/authRedirect'

type CacheEntry = {
  at: number
  data: AvailabilitySummaryResponse
}

const CACHE_TTL_MS = 30_000
const SOFT_THROTTLE_MS = 800

function buildQueryKey(args: {
  proId: string
  serviceId: string
  locationType: ServiceLocationType
  mediaId?: string
}) {
  return `pro=${args.proId}|service=${args.serviceId}|loc=${args.locationType}|media=${args.mediaId || ''}`
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

  const proId = useMemo(() => String(context?.professionalId || '').trim(), [context?.professionalId])
  const serviceId = useMemo(() => String(context?.serviceId || '').trim(), [context?.serviceId])
  const mediaId = useMemo(() => (context?.mediaId ? String(context.mediaId).trim() : ''), [context?.mediaId])

  const queryKey = useMemo(() => {
    return buildQueryKey({ proId, serviceId, locationType, mediaId })
  }, [proId, serviceId, locationType, mediaId])

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
      // ✅ Do NOT clear existing data here (premium refresh UX)

      const qs = new URLSearchParams()
      qs.set('professionalId', proId)
      qs.set('serviceId', serviceId)
      qs.set('locationType', locationType)
      if (mediaId) qs.set('mediaId', mediaId)

      try {
        // ✅ SUMMARY = /api/availability/day without date
        const res = await fetch(`/api/availability/day?${qs.toString()}`, {
          method: 'GET',
          cache: 'no-store',
          signal: controller.signal,
        })

        const body = await safeJson(res)

        if (res.status === 401) {
          redirectToLogin(router, 'availability')
          throw new Error('Please log in to view availability.')
        }

        if (!res.ok || !body?.ok) throw new Error(body?.error || `Request failed (${res.status}).`)
        if (body?.mode !== 'SUMMARY') throw new Error('Availability endpoint returned unexpected response.')

        const next = body as AvailabilitySummaryResponse
        cacheRef.current.set(key, { at: Date.now(), data: next })
        setData(next)
      } catch (e: any) {
        if (e?.name === 'AbortError') return
        setError(e?.message || 'Failed to load availability.')
      } finally {
        if (abortRef.current === controller) abortRef.current = null
        if (inFlightKeyRef.current === key) inFlightKeyRef.current = null
        setLoading(false)
      }
    },
    [router, proId, serviceId, locationType, mediaId],
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
