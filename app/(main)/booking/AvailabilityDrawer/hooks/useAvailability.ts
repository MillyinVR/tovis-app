// app/(main)/booking/AvailabilityDrawer/hooks/useAvailability.ts
'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { AvailabilitySummaryResponse, DrawerContext, ServiceLocationType } from '../types'
import { safeJson } from '../utils/safeJson'
import { redirectToLogin } from '../utils/authRedirect'

export function useAvailability(open: boolean, context: DrawerContext, locationType: ServiceLocationType) {
  const router = useRouter()
  const abortRef = useRef<AbortController | null>(null)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<AvailabilitySummaryResponse | null>(null)

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      abortRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!open) return

    const proId = String(context?.professionalId || '').trim()
    const serviceId = String(context?.serviceId || '').trim()

    if (!proId) {
      setLoading(false)
      setData(null)
      setError('Missing professional. Please try again.')
      return
    }

    // This is the #1 reason the drawer “shows nothing” from Looks.
    if (!serviceId) {
      setLoading(false)
      setData(null)
      setError('No service is linked yet. Ask the pro to attach a service to this look.')
      return
    }

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setLoading(true)
    setError(null)
    setData(null)

    const qs = new URLSearchParams()
    qs.set('professionalId', proId)
    qs.set('serviceId', serviceId)
    qs.set('locationType', locationType)
    if (context.mediaId) qs.set('mediaId', String(context.mediaId))

    fetch(`/api/availability/day?${qs.toString()}`, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (res) => {
        const body = await safeJson(res)

        if (res.status === 401) {
          redirectToLogin(router, 'availability')
          throw new Error('Please log in to view availability.')
        }

        if (!res.ok || !body?.ok) throw new Error(body?.error || `Request failed (${res.status}).`)
        if (body?.mode !== 'SUMMARY') throw new Error('Availability endpoint returned unexpected response.')

        setData(body as AvailabilitySummaryResponse)
      })
      .catch((e: any) => {
        if (e?.name === 'AbortError') return
        setError(e?.message || 'Failed to load availability.')
      })
      .finally(() => {
        if (abortRef.current === controller) abortRef.current = null
        setLoading(false)
      })
  }, [open, context?.professionalId, context?.serviceId, context?.mediaId, locationType, router])

  return { loading, error, data, setError, setData }
}
