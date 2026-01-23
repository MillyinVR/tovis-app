// app/_components/ProSessionFooter/useProSession.ts
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import type { ProSessionPayload, SessionBooking, UiSessionCenterAction, UiSessionMode } from '@/lib/proSession/types'

type CenterState = { label: string; action: UiSessionCenterAction; href: string | null }

function currentPathWithQuery() {
  if (typeof window === 'undefined') return '/'
  return window.location.pathname + window.location.search + window.location.hash
}

function sanitizeFrom(from: string) {
  const trimmed = from.trim()
  if (!trimmed) return '/'
  if (!trimmed.startsWith('/')) return '/'
  if (trimmed.startsWith('//')) return '/'
  return trimmed
}

function isSafeInternalHref(href: unknown): href is string {
  return typeof href === 'string' && href.startsWith('/') && !href.startsWith('//')
}

function redirectToLogin(router: ReturnType<typeof useRouter>, reason?: string) {
  const from = sanitizeFrom(currentPathWithQuery())
  const qs = new URLSearchParams({ from })
  if (reason) qs.set('reason', reason)
  router.push(`/login?${qs.toString()}`)
}

async function safeJson(res: Response) {
  return res.json().catch(() => ({})) as Promise<any>
}

function errorFromResponse(res: Response, data: any) {
  if (typeof data?.error === 'string') return data.error
  if (typeof data?.message === 'string') return data.message
  if (res.status === 401) return 'Please log in to continue.'
  if (res.status === 403) return 'You don’t have access to do that.'
  if (res.status === 404) return 'Not found.'
  if (res.status === 409) return 'That action isn’t allowed right now.'
  return `Request failed (${res.status}).`
}

function normalizeMode(v: unknown): UiSessionMode {
  const s = typeof v === 'string' ? v.trim().toUpperCase() : ''
  if (s === 'UPCOMING') return 'UPCOMING'
  if (s === 'ACTIVE') return 'ACTIVE'
  return 'IDLE'
}

function normalizeAction(v: unknown): UiSessionCenterAction {
  const s = typeof v === 'string' ? v.trim().toUpperCase() : ''
  if (s === 'START') return 'START'
  if (s === 'FINISH') return 'FINISH'
  if (s === 'NAVIGATE') return 'NAVIGATE'
  if (s === 'CAPTURE_BEFORE') return 'CAPTURE_BEFORE'
  if (s === 'CAPTURE_AFTER') return 'CAPTURE_AFTER'
  return 'NONE'
}

const DEFAULT_CENTER: CenterState = { label: 'Start', action: 'NONE', href: null }

export function useProSession() {
  const router = useRouter()
  const pathname = usePathname()

  const [mode, setMode] = useState<UiSessionMode>('IDLE')
  const [booking, setBooking] = useState<SessionBooking | null>(null)
  const [center, setCenter] = useState<CenterState>(DEFAULT_CENTER)

  const [loading, setLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState<'start' | 'finish' | 'nav' | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Request control
  const inFlightRef = useRef<AbortController | null>(null)
  const inFlightPromiseRef = useRef<Promise<void> | null>(null)
  const redirectedRef = useRef(false)
  const lastLoadAtRef = useRef<number>(0)

  // Monotonic request id so only the latest request updates/cleans up.
  const reqIdRef = useRef(0)

  const isReadyOrActive = mode === 'UPCOMING' || mode === 'ACTIVE'

  const centerDisabled = useMemo(() => {
    return !booking || loading || !!actionLoading || !isReadyOrActive || center.action === 'NONE'
  }, [booking, loading, actionLoading, isReadyOrActive, center.action])

  async function loadSession(opts?: { silent?: boolean; force?: boolean }) {
    // Dedupe: if a load is already running and we aren't forcing, reuse it.
    if (inFlightPromiseRef.current && !opts?.force) return inFlightPromiseRef.current

    if (opts?.force) {
      inFlightRef.current?.abort()
      inFlightRef.current = null
      inFlightPromiseRef.current = null
    }

    const controller = new AbortController()
    inFlightRef.current = controller

    const myReqId = ++reqIdRef.current

    if (!opts?.silent) {
      setLoading(true)
      setError(null)
    }

    const promise = (async () => {
      try {
        const res = await fetch('/api/pro/session', {
          method: 'GET',
          cache: 'no-store',
          signal: controller.signal,
        })

        if (res.status === 401) {
          if (!redirectedRef.current) {
            redirectedRef.current = true
            redirectToLogin(router, 'pro-session')
          }
          return
        }

        redirectedRef.current = false
        const data = (await safeJson(res)) as Partial<ProSessionPayload> & { ok?: boolean }

        if (!res.ok || data?.ok !== true) {
          setMode('IDLE')
          setBooking(null)
          setCenter(DEFAULT_CENTER)
          if (!opts?.silent) setError(errorFromResponse(res, data))
          return
        }

        setMode(normalizeMode(data.mode))
        setBooking((data.booking as SessionBooking) ?? null)

        const c = data.center as any
        const label = typeof c?.label === 'string' && c.label.trim() ? c.label.trim() : 'Start'
        const action = normalizeAction(c?.action)
        const href = isSafeInternalHref(c?.href) ? c.href : null

        setCenter({ label, action, href })
      } catch (err: any) {
        if (err?.name === 'AbortError') return
        if (!opts?.silent) setError('Network error loading session.')
      } finally {
        // Only the latest request cleans up. Older ones should not stomp state.
        if (reqIdRef.current === myReqId) {
          if (inFlightRef.current === controller) inFlightRef.current = null
          inFlightPromiseRef.current = null
          if (!opts?.silent) setLoading(false)
        }
      }
    })()

    inFlightPromiseRef.current = promise
    lastLoadAtRef.current = Date.now()
    return promise
  }

  // Initial load + polling (only when visible)
  useEffect(() => {
    let pollId: number | null = null

    const startPolling = () => {
      if (pollId != null) return
      pollId = window.setInterval(() => {
        if (document.visibilityState !== 'visible') return
        void loadSession({ silent: true })
      }, 30_000)
    }

    const stopPolling = () => {
      if (pollId == null) return
      window.clearInterval(pollId)
      pollId = null
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void loadSession({ silent: true })
        startPolling()
      } else {
        stopPolling()
      }
    }

    void loadSession({ silent: false })
    onVisibility()

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onVisibility)

    return () => {
      stopPolling()
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onVisibility)
      inFlightRef.current?.abort()
      inFlightRef.current = null
      inFlightPromiseRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Route change refresh, throttled
  useEffect(() => {
    const now = Date.now()
    const elapsed = now - (lastLoadAtRef.current || 0)
    if (elapsed < 800) return
    void loadSession({ silent: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])

  async function handleCenterClick() {
    if (!booking || centerDisabled) return
    setError(null)

    const bookingId = booking.id
    const fallbackBookingRoot = `/pro/bookings/${encodeURIComponent(bookingId)}`

    try {
      if (center.action === 'START') {
        setActionLoading('start')

        const res = await fetch(`/api/pro/bookings/${encodeURIComponent(bookingId)}/start`, { method: 'POST' })
        if (res.status === 401) return redirectToLogin(router, 'pro-start')

        const data = await safeJson(res)
        if (!res.ok) throw new Error(errorFromResponse(res, data))

        await loadSession({ silent: true, force: true })

        const target = center.href ?? `${fallbackBookingRoot}?step=consult`
        if (target === currentPathWithQuery()) router.refresh()
        else router.push(target)

        return
      }

      if (center.action === 'FINISH') {
        setActionLoading('finish')

        const res = await fetch(`/api/pro/bookings/${encodeURIComponent(bookingId)}/finish`, { method: 'POST' })
        if (res.status === 401) return redirectToLogin(router, 'pro-finish')

        const data = await safeJson(res)
        if (!res.ok) throw new Error(errorFromResponse(res, data))

        const nextHref = isSafeInternalHref(data?.nextHref) ? (data.nextHref as string) : null
        await loadSession({ silent: true, force: true })

        const target = nextHref ?? `${fallbackBookingRoot}/session/after-photos`

        if (target === currentPathWithQuery()) {
          const afterCount = typeof data?.afterCount === 'number' ? data.afterCount : null
          setError(afterCount === 0 ? 'Add at least one after photo to continue to aftercare.' : 'Nothing to advance right now.')
          router.refresh()
          return
        }

        router.push(target)
        return
      }

      if (center.action === 'NAVIGATE' || center.action === 'CAPTURE_BEFORE' || center.action === 'CAPTURE_AFTER') {
        setActionLoading('nav')
        const target = center.href ?? fallbackBookingRoot
        if (target === currentPathWithQuery()) router.refresh()
        else router.push(target)
        return
      }
    } catch (err: any) {
      setError(err?.message || 'Something went wrong.')
    } finally {
      setActionLoading(null)
    }
  }

  const displayLabel =
    actionLoading === 'start'
      ? 'Starting…'
      : actionLoading === 'finish'
        ? 'Finishing…'
        : actionLoading === 'nav'
          ? 'Opening…'
          : center.label

  return {
    pathname,
    mode,
    booking,
    center,
    loading,
    actionLoading,
    error,
    setError,
    centerDisabled,
    displayLabel,
    handleCenterClick,
  }
}
