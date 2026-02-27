// app/_components/ProSessionFooter/useProSession.ts
'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import type { ProSessionPayload, SessionBooking, UiSessionCenterAction, UiSessionMode } from '@/lib/proSession/types'

type CenterState = { label: string; action: UiSessionCenterAction; href: string | null }

export const FORCE_EVENT = 'tovis:pro-session:force'

// Tuning knobs
const POLL_MS = 60_000
const SOFT_THROTTLE_MS = 10_000

const DEFAULT_CENTER: CenterState = { label: 'Start', action: 'NONE', href: null }

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
  if (s === 'NAVIGATE') return 'NAVIGATE'
  if (s === 'CAPTURE_BEFORE') return 'CAPTURE_BEFORE'
  if (s === 'CAPTURE_AFTER') return 'CAPTURE_AFTER'
  if (s === 'FINISH') return 'FINISH'
  return 'NONE'
}

type LoadOpts = { silent?: boolean; force?: boolean }

function bookingRoot(bookingId: string) {
  return `/pro/bookings/${encodeURIComponent(bookingId)}`
}

function bookingSessionHub(bookingId: string) {
  return `${bookingRoot(bookingId)}/session`
}

/**
 * Center can be clicked if:
 * - not busy, AND
 * - action is not NONE, AND
 * - requirements are met for that action
 *
 * NOTE: we intentionally do NOT gate by `mode`.
 * The server is the canonical source of truth.
 */
function canClickCenter(args: {
  actionLoading: 'start' | 'nav' | null
  action: UiSessionCenterAction
  href: string | null
  bookingId: string | null
}) {
  const { actionLoading, action, href, bookingId } = args

  if (actionLoading) return false
  if (action === 'NONE') return false

  if (action === 'START' || action === 'FINISH') return Boolean(bookingId)

  if (action === 'NAVIGATE' || action === 'CAPTURE_BEFORE' || action === 'CAPTURE_AFTER') {
    return Boolean(href || bookingId)
  }

  return false
}

export function useProSession() {
  const router = useRouter()
  const pathname = usePathname()

  const [mode, setMode] = useState<UiSessionMode>('IDLE')
  const [booking, setBooking] = useState<SessionBooking | null>(null)
  const [center, setCenter] = useState<CenterState>(DEFAULT_CENTER)

  const [loading, setLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState<'start' | 'nav' | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Concurrency + freshness
  const inFlightRef = useRef<AbortController | null>(null)
  const reqIdRef = useRef(0)
  const lastLoadAtRef = useRef<number>(0)
  const redirectedRef = useRef(false)
  const visibilityDebounceRef = useRef<number | null>(null)

  const bookingId = booking?.id ? String(booking.id) : null

  const centerDisabled = useMemo(() => {
    return !canClickCenter({
      actionLoading,
      action: center.action,
      href: center.href,
      bookingId,
    })
  }, [actionLoading, center.action, center.href, bookingId])

  const applyIdle = useCallback((opts?: LoadOpts, res?: Response, data?: any) => {
    setMode('IDLE')
    setBooking(null)
    setCenter(DEFAULT_CENTER)
    if (!opts?.silent && res) setError(errorFromResponse(res, data))
  }, [])

  const loadSession = useCallback(
    async (opts?: LoadOpts): Promise<ProSessionPayload | null> => {
      const now = Date.now()

      if (!opts?.force && now - (lastLoadAtRef.current || 0) < SOFT_THROTTLE_MS) {
        return null
      }

      if (opts?.force) {
        inFlightRef.current?.abort()
        inFlightRef.current = null
      }

      const controller = new AbortController()
      inFlightRef.current = controller

      const myReqId = ++reqIdRef.current
      lastLoadAtRef.current = now

      if (!opts?.silent) {
        setLoading(true)
        setError(null)
      }

      try {
        const res = await fetch('/api/pro/session', {
          method: 'GET',
          cache: 'no-store',
          signal: controller.signal,
        })

        if (reqIdRef.current !== myReqId) return null

        if (res.status === 401) {
          if (!redirectedRef.current) {
            redirectedRef.current = true
            redirectToLogin(router, 'pro-session')
          }
          return null
        }

        redirectedRef.current = false

        const data = (await safeJson(res)) as Partial<ProSessionPayload> & { ok?: boolean }

        if (!res.ok || data?.ok !== true) {
          applyIdle(opts, res, data)
          return null
        }

        const payload = data as ProSessionPayload

        setMode(normalizeMode(payload.mode))
        setBooking((payload.booking as SessionBooking) ?? null)

        const c: any = payload.center ?? {}
        const label = typeof c?.label === 'string' && c.label.trim() ? c.label.trim() : 'Start'
        const action = normalizeAction(c?.action)
        const href = isSafeInternalHref(c?.href) ? (c.href as string) : null
        setCenter({ label, action, href })

        return payload
      } catch (err: any) {
        if (err?.name === 'AbortError') return null
        if (!opts?.silent) setError('Network error loading session.')
        return null
      } finally {
        if (reqIdRef.current === myReqId) {
          if (inFlightRef.current === controller) inFlightRef.current = null
          if (!opts?.silent) setLoading(false)
        }
      }
    },
    [applyIdle, router],
  )

  // Initial load + polling (visible only)
  useEffect(() => {
    let pollId: number | null = null

    const startPolling = () => {
      if (pollId != null) return
      pollId = window.setInterval(() => {
        if (document.visibilityState !== 'visible') return
        void loadSession({ silent: true })
      }, POLL_MS)
    }

    const stopPolling = () => {
      if (pollId == null) return
      window.clearInterval(pollId)
      pollId = null
    }

    const scheduleVisibilityLoad = () => {
      if (visibilityDebounceRef.current) window.clearTimeout(visibilityDebounceRef.current)
      visibilityDebounceRef.current = window.setTimeout(() => {
        if (document.visibilityState === 'visible') {
          void loadSession({ silent: true, force: true })
          startPolling()
        } else {
          stopPolling()
        }
      }, 200)
    }

    void loadSession({ silent: false, force: true })
    startPolling()

    document.addEventListener('visibilitychange', scheduleVisibilityLoad)
    window.addEventListener('focus', scheduleVisibilityLoad)

    return () => {
      stopPolling()
      if (visibilityDebounceRef.current) window.clearTimeout(visibilityDebounceRef.current)
      document.removeEventListener('visibilitychange', scheduleVisibilityLoad)
      window.removeEventListener('focus', scheduleVisibilityLoad)
      inFlightRef.current?.abort()
      inFlightRef.current = null
    }
  }, [loadSession])

  // Route change refresh (forced) — portal footers don’t unmount
  useEffect(() => {
    void loadSession({ silent: true, force: true })
  }, [pathname, loadSession])

  // External force refresh (aftercare send, etc.)
  useEffect(() => {
    const onForce = () => void loadSession({ silent: true, force: true })
    window.addEventListener(FORCE_EVENT, onForce)
    return () => window.removeEventListener(FORCE_EVENT, onForce)
  }, [loadSession])

  async function handleCenterClick() {
    if (centerDisabled) return
    setError(null)

    const fallbackHub = bookingId ? bookingSessionHub(bookingId) : '/pro/bookings'

    try {
      if (center.action === 'START') {
        if (!bookingId) return
        setActionLoading('start')

        const res = await fetch(`/api/pro/bookings/${encodeURIComponent(bookingId)}/start`, { method: 'POST' })
        if (res.status === 401) return redirectToLogin(router, 'pro-start')

        const data = await safeJson(res)
        if (!res.ok) {
          setError(errorFromResponse(res, data))
          await loadSession({ silent: true, force: true })
          return
        }

        const nextHref = isSafeInternalHref(data?.nextHref) ? (data.nextHref as string) : null
        const fresh = await loadSession({ silent: true, force: true })
        const freshHref = isSafeInternalHref((fresh as any)?.center?.href) ? ((fresh as any).center.href as string) : null

        const target = nextHref ?? freshHref ?? fallbackHub
        if (target === currentPathWithQuery()) router.refresh()
        else router.push(target)
        return
      }

      if (center.action === 'FINISH') {
        if (!bookingId) return
        setActionLoading('nav')

        const res = await fetch(`/api/pro/bookings/${encodeURIComponent(bookingId)}/finish`, { method: 'POST' })
        if (res.status === 401) return redirectToLogin(router, 'pro-finish')

        const data = await safeJson(res)
        if (!res.ok) {
          setError(errorFromResponse(res, data))
          await loadSession({ silent: true, force: true })
          return
        }

        const nextHref = isSafeInternalHref(data?.nextHref) ? (data.nextHref as string) : null
        const fresh = await loadSession({ silent: true, force: true })
        const freshHref = isSafeInternalHref((fresh as any)?.center?.href) ? ((fresh as any).center.href as string) : null

        const target = nextHref ?? freshHref ?? fallbackHub
        if (target === currentPathWithQuery()) router.refresh()
        else router.push(target)
        return
      }

      if (center.action === 'NAVIGATE' || center.action === 'CAPTURE_BEFORE' || center.action === 'CAPTURE_AFTER') {
        setActionLoading('nav')
        const target = isSafeInternalHref(center.href) ? center.href! : fallbackHub
        if (target === currentPathWithQuery()) router.refresh()
        else router.push(target)
        return
      }

      router.push(fallbackHub)
    } catch (err: any) {
      setError(err?.message || 'Something went wrong.')
    } finally {
      setActionLoading(null)
    }
  }

  const displayLabel = actionLoading === 'start' ? 'Starting…' : actionLoading === 'nav' ? 'Opening…' : center.label

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
    FORCE_EVENT,
  }
}