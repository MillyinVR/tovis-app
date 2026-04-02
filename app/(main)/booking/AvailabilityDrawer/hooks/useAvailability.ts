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
import {
  startAvailabilityMetric,
  endAvailabilityMetric,
  cancelAvailabilityMetric,
} from '../perf/availabilityPerf'

type SummaryOk = Extract<
  AvailabilitySummaryResponse,
  { ok: true; mode: 'SUMMARY' }
>

type LoadMode = 'blocking' | 'background'

type BackgroundRefreshMeta = {
  refreshKind: 'initial-background' | 'other-pros-only'
  cacheState: 'cached-primary' | 'cached-full' | 'visible-primary'
}

const BACKGROUND_REFRESH_METRIC_KEY = 'background-refresh'

function mergeSummaryData(
  current: SummaryOk | null,
  incoming: SummaryOk,
): SummaryOk {
  if (!current) return incoming

  return {
    ...current,
    ...incoming,
    availableDays: mergeAvailableDays(
      current.availableDays,
      incoming.availableDays,
    ),
    windowStartDate: current.windowStartDate,
    windowEndDate: incoming.windowEndDate,
    nextStartDate: incoming.nextStartDate,
    hasMoreDays: incoming.hasMoreDays,
    otherPros:
      incoming.otherPros.length > 0 ? incoming.otherPros : current.otherPros,
    debug: incoming.debug ?? current.debug,
  }
}

function readCachedSummaryWindow(
  key: string | null,
  allowStale: boolean,
): SummaryOk | null {
  if (!key) return null

  return allowStale
    ? getAnyCachedAvailabilitySummaryWindow(key)
    : getCachedAvailabilitySummaryWindow(key)
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

  const dataRef = useRef<SummaryOk | null>(null)
  dataRef.current = data

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

  const contextRef = useRef(context)
  contextRef.current = context

  const primaryPrefetchArgs = useMemo(
    () =>
      buildAvailabilityPrefetchArgsFromContext({
        context,
        locationType,
        clientAddressId: requiresClientAddress ? normalizedClientAddressId : null,
        includeOtherPros: false,
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
    ],
  )

  const primaryWindowKey = useMemo(() => {
    if (!primaryPrefetchArgs) return null

    return buildAvailabilitySummaryPrefetchKey({
      professionalId: primaryPrefetchArgs.professionalId,
      serviceId: primaryPrefetchArgs.serviceId,
      locationType: primaryPrefetchArgs.locationType,
      mediaId: primaryPrefetchArgs.mediaId,
      clientAddressId: primaryPrefetchArgs.clientAddressId,
      viewer: primaryPrefetchArgs.viewer,
      startDate: null,
      days: INITIAL_WINDOW_DAYS,
      includeOtherPros: false,
    })
  }, [primaryPrefetchArgs])

  const fullPrefetchArgs = useMemo(() => {
    if (!includeOtherPros) return null

    return buildAvailabilityPrefetchArgsFromContext({
      context,
      locationType,
      clientAddressId: requiresClientAddress ? normalizedClientAddressId : null,
      includeOtherPros: true,
      days: INITIAL_WINDOW_DAYS,
      startDate: null,
    })
  }, [
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
  ])

  const fullWindowKey = useMemo(() => {
    if (!includeOtherPros || !fullPrefetchArgs) return null

    return buildAvailabilitySummaryPrefetchKey({
      professionalId: fullPrefetchArgs.professionalId,
      serviceId: fullPrefetchArgs.serviceId,
      locationType: fullPrefetchArgs.locationType,
      mediaId: fullPrefetchArgs.mediaId,
      clientAddressId: fullPrefetchArgs.clientAddressId,
      viewer: fullPrefetchArgs.viewer,
      startDate: null,
      days: INITIAL_WINDOW_DAYS,
      includeOtherPros: true,
    })
  }, [fullPrefetchArgs, includeOtherPros])

  const handleAvailabilityError = useCallback(
    (message: string, preserveVisibleData: boolean) => {
      if (message === 'Unauthorized.') {
        redirectToLogin(router, 'availability')

        if (!preserveVisibleData) {
          setData(null)
          setError('Please log in to view availability.')
        }

        return
      }

      if (!preserveVisibleData) {
        setError(message)
      }
    },
    [router],
  )

  const loadOtherProsOnly = useCallback(async () => {
    if (!includeOtherPros || !fullPrefetchArgs) return

    const seq = ++requestSeqRef.current

    setLoading(false)
    setRefreshing(true)

    startAvailabilityMetric({
      metric: 'background_refresh_ms',
      key: BACKGROUND_REFRESH_METRIC_KEY,
      meta: {
        professionalId: proId,
        serviceId,
        locationType: locationType ?? null,
        includeOtherPros,
        refreshKind: 'other-pros-only',
        cacheState: 'visible-primary',
      },
    })

    try {
      const fullPage = await fetchAvailabilitySummaryWindow({
        ...fullPrefetchArgs,
        startDate: null,
        days: INITIAL_WINDOW_DAYS,
        includeOtherPros: true,
      })

      if (seq !== requestSeqRef.current) {
        cancelAvailabilityMetric({
          metric: 'background_refresh_ms',
          key: BACKGROUND_REFRESH_METRIC_KEY,
          reason: 'superseded',
        })
        return
      }

      setData((current) => mergeSummaryData(current, fullPage))
      setError(null)

      endAvailabilityMetric({
        metric: 'background_refresh_ms',
        key: BACKGROUND_REFRESH_METRIC_KEY,
        meta: {
          professionalId: proId,
          serviceId,
          locationType: locationType ?? null,
          includeOtherPros,
          refreshKind: 'other-pros-only',
          cacheState: 'visible-primary',
          dayCount: fullPage.availableDays.length,
          hasOtherPros: fullPage.otherPros.length > 0,
        },
      })
    } catch (e: unknown) {
      if (seq !== requestSeqRef.current) {
        cancelAvailabilityMetric({
          metric: 'background_refresh_ms',
          key: BACKGROUND_REFRESH_METRIC_KEY,
          reason: 'superseded',
        })
        return
      }

      const message =
        e instanceof Error ? e.message : 'Failed to load availability.'

      cancelAvailabilityMetric({
        metric: 'background_refresh_ms',
        key: BACKGROUND_REFRESH_METRIC_KEY,
        reason: message,
      })

      handleAvailabilityError(message, true)
    } finally {
      if (seq === requestSeqRef.current) {
        setRefreshing(false)
      }
    }
  }, [
    fullPrefetchArgs,
    includeOtherPros,
    handleAvailabilityError,
    proId,
    serviceId,
    locationType,
  ])

  const loadInitial = useCallback(
    async (mode: LoadMode, backgroundMeta?: BackgroundRefreshMeta) => {
      const seq = ++requestSeqRef.current
      const preserveVisibleData = mode === 'background'

      if (preserveVisibleData) {
        setLoading(false)
        setRefreshing(true)

        startAvailabilityMetric({
          metric: 'background_refresh_ms',
          key: BACKGROUND_REFRESH_METRIC_KEY,
          meta: {
            professionalId: proId,
            serviceId,
            locationType: locationType ?? null,
            includeOtherPros,
            refreshKind: backgroundMeta?.refreshKind ?? 'initial-background',
            cacheState: backgroundMeta?.cacheState ?? 'cached-primary',
          },
        })
      } else {
        setLoading(true)
        setRefreshing(false)
      }

      setError(null)

      try {
        if (!primaryPrefetchArgs) {
          throw new Error('Missing availability context.')
        }

        const primaryPage = await fetchAvailabilitySummaryWindow({
          ...primaryPrefetchArgs,
          startDate: null,
          days: INITIAL_WINDOW_DAYS,
          includeOtherPros: false,
        })

        if (seq !== requestSeqRef.current) {
          if (preserveVisibleData) {
            cancelAvailabilityMetric({
              metric: 'background_refresh_ms',
              key: BACKGROUND_REFRESH_METRIC_KEY,
              reason: 'superseded',
            })
          }
          return
        }

        setData((current) => mergeSummaryData(current, primaryPage))
        setError(null)
        setLoading(false)

        if (!includeOtherPros || !fullPrefetchArgs) {
          if (preserveVisibleData) {
            endAvailabilityMetric({
              metric: 'background_refresh_ms',
              key: BACKGROUND_REFRESH_METRIC_KEY,
              meta: {
                professionalId: proId,
                serviceId,
                locationType: locationType ?? null,
                includeOtherPros,
                refreshKind:
                  backgroundMeta?.refreshKind ?? 'initial-background',
                cacheState: backgroundMeta?.cacheState ?? 'cached-primary',
                dayCount: primaryPage.availableDays.length,
                hasOtherPros: false,
              },
            })
          }

          setRefreshing(false)
          return
        }

        setRefreshing(true)

        const fullPage = await fetchAvailabilitySummaryWindow({
          ...fullPrefetchArgs,
          startDate: null,
          days: INITIAL_WINDOW_DAYS,
          includeOtherPros: true,
        })

        if (seq !== requestSeqRef.current) {
          if (preserveVisibleData) {
            cancelAvailabilityMetric({
              metric: 'background_refresh_ms',
              key: BACKGROUND_REFRESH_METRIC_KEY,
              reason: 'superseded',
            })
          }
          return
        }

        setData((current) => mergeSummaryData(current, fullPage))
        setError(null)

        if (preserveVisibleData) {
          endAvailabilityMetric({
            metric: 'background_refresh_ms',
            key: BACKGROUND_REFRESH_METRIC_KEY,
            meta: {
              professionalId: proId,
              serviceId,
              locationType: locationType ?? null,
              includeOtherPros,
              refreshKind: backgroundMeta?.refreshKind ?? 'initial-background',
              cacheState: backgroundMeta?.cacheState ?? 'cached-primary',
              dayCount: fullPage.availableDays.length,
              hasOtherPros: fullPage.otherPros.length > 0,
            },
          })
        }
      } catch (e: unknown) {
        if (seq !== requestSeqRef.current) {
          if (preserveVisibleData) {
            cancelAvailabilityMetric({
              metric: 'background_refresh_ms',
              key: BACKGROUND_REFRESH_METRIC_KEY,
              reason: 'superseded',
            })
          }
          return
        }

        const message =
          e instanceof Error ? e.message : 'Failed to load availability.'

        if (preserveVisibleData) {
          cancelAvailabilityMetric({
            metric: 'background_refresh_ms',
            key: BACKGROUND_REFRESH_METRIC_KEY,
            reason: message,
          })
        }

        handleAvailabilityError(message, preserveVisibleData)
      } finally {
        if (seq === requestSeqRef.current) {
          setLoading(false)
          setRefreshing(false)
        }
      }
    },
    [
      primaryPrefetchArgs,
      includeOtherPros,
      fullPrefetchArgs,
      handleAvailabilityError,
      proId,
      serviceId,
      locationType,
    ],
  )

  const loadMore = useCallback(async () => {
    if (!data?.hasMoreDays || !data.nextStartDate) return
    if (loading || refreshing || loadingMore) return

    setLoadingMore(true)

    try {
      const nextArgs = buildAvailabilityPrefetchArgsFromContext({
        context: contextRef.current,
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

      handleAvailabilityError(message, true)
    } finally {
      setLoadingMore(false)
    }
  }, [
    data,
    loading,
    refreshing,
    loadingMore,
    locationType,
    requiresClientAddress,
    normalizedClientAddressId,
    handleAvailabilityError,
  ])

  useEffect(() => {
    return () => {
      requestSeqRef.current += 1
      cancelAvailabilityMetric({
        metric: 'background_refresh_ms',
        key: BACKGROUND_REFRESH_METRIC_KEY,
        reason: 'unmount',
      })
    }
  }, [])

  useEffect(() => {
    if (!open) {
      cancelAvailabilityMetric({
        metric: 'background_refresh_ms',
        key: BACKGROUND_REFRESH_METRIC_KEY,
        reason: 'drawer_closed',
      })
      setLoading(false)
      setLoadingMore(false)
      setRefreshing(false)
      setError(null)
      return
    }

    if (!proId) {
      cancelAvailabilityMetric({
        metric: 'background_refresh_ms',
        key: BACKGROUND_REFRESH_METRIC_KEY,
        reason: 'missing_professional',
      })
      setLoading(false)
      setLoadingMore(false)
      setRefreshing(false)
      setData(null)
      setError('Missing professional. Please try again.')
      return
    }

    if (!serviceId) {
      cancelAvailabilityMetric({
        metric: 'background_refresh_ms',
        key: BACKGROUND_REFRESH_METRIC_KEY,
        reason: 'missing_service',
      })
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
      cancelAvailabilityMetric({
        metric: 'background_refresh_ms',
        key: BACKGROUND_REFRESH_METRIC_KEY,
        reason: 'cannot_fetch',
      })
      setLoading(false)
      setLoadingMore(false)
      setRefreshing(false)
      setData(null)
      setError(null)
      return
    }

    if (!primaryWindowKey) {
      cancelAvailabilityMetric({
        metric: 'background_refresh_ms',
        key: BACKGROUND_REFRESH_METRIC_KEY,
        reason: 'missing_context',
      })
      setLoading(false)
      setLoadingMore(false)
      setRefreshing(false)
      setData(null)
      setError('Missing availability context.')
      return
    }

    const freshFull = readCachedSummaryWindow(fullWindowKey, false)
    if (freshFull) {
      setData(freshFull)
      setError(null)
      setLoading(false)
      setLoadingMore(false)
      setRefreshing(false)
      return
    }

    const freshPrimary = readCachedSummaryWindow(primaryWindowKey, false)
    if (freshPrimary) {
      setData(freshPrimary)
      setError(null)
      setLoading(false)
      setLoadingMore(false)
      setRefreshing(false)

      if (includeOtherPros) {
        void loadOtherProsOnly()
      }

      return
    }

    const staleFull = readCachedSummaryWindow(fullWindowKey, true)
    if (staleFull) {
      setData(staleFull)
      setError(null)
      setLoading(false)
      setLoadingMore(false)
      setRefreshing(true)
      void loadInitial('background', {
        refreshKind: 'initial-background',
        cacheState: 'cached-full',
      })
      return
    }

    const stalePrimary = readCachedSummaryWindow(primaryWindowKey, true)
    if (stalePrimary) {
      setData(stalePrimary)
      setError(null)
      setLoading(false)
      setLoadingMore(false)
      setRefreshing(true)
      void loadInitial('background', {
        refreshKind: 'initial-background',
        cacheState: 'cached-primary',
      })
      return
    }

    setData(null)
    setError(null)
    setLoadingMore(false)
    void loadInitial('blocking')
  }, [
    open,
    proId,
    serviceId,
    canFetch,
    primaryWindowKey,
    fullWindowKey,
    includeOtherPros,
    loadInitial,
    loadOtherProsOnly,
  ])

  const refresh = useCallback(() => {
    const current = dataRef.current

    void loadInitial(
      current ? 'background' : 'blocking',
      current
        ? {
            refreshKind: 'initial-background',
            cacheState:
              current.otherPros.length > 0 ? 'cached-full' : 'cached-primary',
          }
        : undefined,
    )
  }, [loadInitial])

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