// app/(main)/booking/AvailabilityDrawer/hooks/useAvailability.ts
'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { AvailabilitySummaryResponse, DrawerContext, ServiceLocationType } from '../types'
import { safeJson } from '../utils/safeJson'
import { redirectToLogin } from '../utils/authRedirect'

export function useAvailability(open: boolean, context: DrawerContext) {
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
    if (!open || !context?.professionalId || !context?.serviceId) return

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setLoading(true)
    setError(null)
    setData(null)

    const qs = new URLSearchParams({
      professionalId: context.professionalId,
      serviceId: context.serviceId,
      mediaId: context.mediaId,
    })

    // optional (future): if you want to pass preferred location type in the URL
    // qs.set('locationType', 'SALON')

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
  }, [open, context?.professionalId, context?.serviceId, context?.mediaId, router])

  return { loading, error, data, setError, setData }
}
