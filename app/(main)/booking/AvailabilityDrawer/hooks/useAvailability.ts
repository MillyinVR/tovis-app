// app/(main)/booking/AvailabilityDrawer/hooks/useAvailability.ts 
'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import type {
  AvailabilitySummaryResponse,
  DrawerContext,
  ServiceLocationType,
} from '../types'

import { redirectToLogin } from '../utils/authRedirect'
import {
  INITIAL_WINDOW_DAYS,
  NEXT_WINDOW_DAYS,
} from '../utils/availabilityWindow'
import { mergeAvailableDays } from '../utils/mergeAvailableDays'
import {
  buildAvailabilityPrefetchArgsFromContext,
  buildAvailabilitySummaryPrefetchKey,
  fetchAvailabilitySummaryWindow,
  getAnyCachedAvailabilitySummaryWindow,
  getCachedAvailabilitySummaryWindow,
} from '../utils/availabilityPrefetch'

type SummaryOk = Extract<
  AvailabilitySummaryResponse,
  { ok: true; mode: 'SUMMARY' }
>

function mergeSummaryData(
  current: SummaryOk | null,
  incoming: SummaryOk,
): SummaryOk {
  if (!current) return incoming

  return {
    ...current,
    availableDays: mergeAvailableDays(
      current.availableDays,
      incoming.availableDays,
    ),
    windowStartDate: current.windowStartDate,
    windowEndDate: incoming.windowEndDate,
    nextStartDate: incoming.nextStartDate,
    hasMoreDays: incoming.hasMoreDays,
    otherPros:
      current.otherPros.length > 0 ? current.otherPros : incoming.otherPros,
    debug: incoming.debug ?? current.debug,
  }
}

export function useAvailability(
  open: boolean,
  context: DrawerContext,
  locationType: ServiceLocationType | null,
  clientAddressId?: string | null,
  includeOtherPros = true,
) {
  const router = useRouter()
  const requestSeqRef = useRef(0)

  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<SummaryOk | null>(null)

  const proId = useMemo(
    () => String(context.professionalId || '').trim(),
    [context.professionalId],
  )

  const serviceId = useMemo(
    () => String(context.serviceId || '').trim(),
    [context.serviceId],
  )

  const normalizedClientAddressId = useMemo(
    () => (clientAddressId ? String(clientAddressId).trim() : ''),
    [clientAddressId],
  )

  const requiresClientAddress = locationType === 'MOBILE'

  const canFetch =
    open &&
    Boolean(proId) &&
    Boolean(serviceId) &&
    (!requiresClientAddress || Boolean(normalizedClientAddressId))

  const ctxProfessionalId = context.professionalId
  const ctxServiceId = context.serviceId
  const ctxMediaId = context.mediaId
  const ctxViewerLat = context.viewerLat
  const ctxViewerLng = context.viewerLng
  const ctxViewerRadiusMiles = context.viewerRadiusMiles
  const ctxViewerPlaceId = context.viewerPlaceId

  const initialPrefetchArgs = useMemo(
    () =>
      buildAvailabilityPrefetchArgsFromContext({
        context,
        locationType,
        clientAddressId: requiresClientAddress ? normalizedClientAddressId : null,
        includeOtherPros,
        days: INITIAL_WINDOW_DAYS,
        startDate: null,
      }),
    [
      ctxProfessionalId,
      ctxServiceId,
      ctxMediaId,
      ctxViewerLat,
      ctxViewerLng,
      ctxViewerRadiusMiles,
      ctxViewerPlaceId,
      locationType,
      normalizedClientAddressId,
      requiresClientAddress,
      includeOtherPros,
    ],
  )

  const initialWindowKey = useMemo(() => {
    if (!initialPrefetchArgs) return null

    return buildAvailabilitySummaryPrefetchKey({
      professionalId: initialPrefetchArgs.professionalId,
      serviceId: initialPrefetchArgs.serviceId,
      locationType: initialPrefetchArgs.locationType,
      mediaId: initialPrefetchArgs.mediaId,
      clientAddressId: initialPrefetchArgs.clientAddressId,
      viewer: initialPrefetchArgs.viewer,
      startDate: null,
      days: INITIAL_WINDOW_DAYS,
      includeOtherPros,
    })
  }, [initialPrefetchArgs, includeOtherPros])

  const loadInitial = useCallback(
    async (keepExistingData: boolean) => {
      const seq = ++requestSeqRef.current

      if (keepExistingData) {
        setRefreshing(true)
        setLoading(false)
      } else {
        setLoading(true)
        setRefreshing(false)
      }

      setError(null)

      try {
        if (!initialPrefetchArgs) {
          throw new Error('Missing availability context.')
        }

        if (keepExistingData && initialWindowKey) {
          const stale = getAnyCachedAvailabilitySummaryWindow(initialWindowKey)
          if (stale && seq === requestSeqRef.current) {
            setData(stale)
          }
        }

        const firstPage = await fetchAvailabilitySummaryWindow({
          ...initialPrefetchArgs,
          startDate: null,
          days: INITIAL_WINDOW_DAYS,
          includeOtherPros,
        })

        if (seq !== requestSeqRef.current) return

        setData(firstPage)
        setError(null)
      } catch (e: unknown) {
        if (seq !== requestSeqRef.current) return

        const message =
          e instanceof Error ? e.message : 'Failed to load availability.'

        if (message === 'Unauthorized.') {
          redirectToLogin(router, 'availability')
          setError('Please log in to view availability.')
          setData(null)
          return
        }

        setError(message)
      } finally {
        if (seq === requestSeqRef.current) {
          setLoading(false)
          setRefreshing(false)
        }
      }
    },
    [initialPrefetchArgs, initialWindowKey, includeOtherPros, router],
  )

  const loadMore = useCallback(async () => {
    if (!data?.hasMoreDays || !data.nextStartDate) return
    if (loading || refreshing || loadingMore) return

    setLoadingMore(true)
    setError(null)

    try {
      const nextArgs = buildAvailabilityPrefetchArgsFromContext({
        context,
        locationType,
        clientAddressId: requiresClientAddress ? normalizedClientAddressId : null,
        includeOtherPros: false,
        days: NEXT_WINDOW_DAYS,
        startDate: data.nextStartDate,
      })

      if (!nextArgs) {
        throw new Error('Missing availability context.')
      }

      const nextPage = await fetchAvailabilitySummaryWindow({
        ...nextArgs,
        startDate: data.nextStartDate,
        days: NEXT_WINDOW_DAYS,
        includeOtherPros: false,
      })

      setData((current) => mergeSummaryData(current, nextPage))
    } catch (e: unknown) {
      const message =
        e instanceof Error ? e.message : 'Failed to load more availability.'

      if (message === 'Unauthorized.') {
        redirectToLogin(router, 'availability')
        setError('Please log in to view availability.')
        setData(null)
        return
      }

      setError(message)
    } finally {
      setLoadingMore(false)
    }
  }, [
    context,
    data,
    loading,
    refreshing,
    loadingMore,
    locationType,
    requiresClientAddress,
    normalizedClientAddressId,
    router,
  ])

  useEffect(() => {
    return () => {
      requestSeqRef.current += 1
    }
  }, [])

  useEffect(() => {
    if (!open) {
      setLoading(false)
      setLoadingMore(false)
      setRefreshing(false)
      setError(null)
      return
    }

    if (!proId) {
      setLoading(false)
      setLoadingMore(false)
      setRefreshing(false)
      setData(null)
      setError('Missing professional. Please try again.')
      return
    }

    if (!serviceId) {
      setLoading(false)
      setLoadingMore(false)
      setRefreshing(false)
      setData(null)
      setError(
        'No service is linked yet. Ask the pro to attach a service to this look.',
      )
      return
    }

    if (!canFetch) {
      setLoading(false)
      setLoadingMore(false)
      setRefreshing(false)
      setData(null)
      setError(null)
      return
    }

    if (!initialWindowKey) {
      setLoading(false)
      setLoadingMore(false)
      setRefreshing(false)
      setData(null)
      setError('Missing availability context.')
      return
    }

    const fresh = getCachedAvailabilitySummaryWindow(initialWindowKey)
    if (fresh) {
      setData(fresh)
      setError(null)
      setLoading(false)
      setLoadingMore(false)
      setRefreshing(false)
      return
    }

    const stale = getAnyCachedAvailabilitySummaryWindow(initialWindowKey)
    if (stale) {
      setData(stale)
      setError(null)
      setLoading(false)
      setLoadingMore(false)
      setRefreshing(true)
      void loadInitial(true)
      return
    }

    setData(null)
    setError(null)
    setLoadingMore(false)
    void loadInitial(false)
  }, [
    open,
    proId,
    serviceId,
    canFetch,
    initialWindowKey,
    loadInitial,
  ])

  const refresh = useCallback(() => void loadInitial(false), [loadInitial])

  return {
    loading,
    loadingMore,
    refreshing,
    error,
    data,
    hasMoreDays: Boolean(data?.hasMoreDays),
    loadMore,
    setError,
    setData,
    refresh,
  }
}