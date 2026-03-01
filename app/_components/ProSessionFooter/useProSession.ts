// app/_components/ProSessionFooter/useProSession.ts
'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import type {
  ProSessionPayload,
  SessionBooking,
  StepKey,
  UiSessionCenterAction,
  UiSessionMode,
} from '@/lib/proSession/types'

type CenterState = { label: string; action: UiSessionCenterAction; href: string | null }

export const FORCE_EVENT = 'tovis:pro-session:force'

// Tuning knobs
const POLL_MS = 60_000
const SOFT_THROTTLE_MS = 10_000
const FETCH_TIMEOUT_MS = 8_000
const VISIBILITY_DEBOUNCE_MS = 200

const DEFAULT_CENTER: CenterState = { label: 'Start', action: 'NONE', href: null }

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null
}

function getString(x: unknown): string | null {
  return typeof x === 'string' ? x : null
}

function getStringProp(obj: unknown, key: string): string | null {
  if (!isRecord(obj)) return null
  return getString(obj[key])
}

function getBoolProp(obj: unknown, key: string): boolean | null {
  if (!isRecord(obj)) return null
  const v = obj[key]
  return typeof v === 'boolean' ? v : null
}

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

async function safeJson(res: Response): Promise<unknown | null> {
  try {
    return await res.json()
  } catch {
    return null
  }
}

function errorFromResponse(res: Response, data: unknown) {
  const e = getStringProp(data, 'error')
  if (e) return e
  const m = getStringProp(data, 'message')
  if (m) return m

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

function normalizeStepKey(v: unknown): StepKey | null {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : ''
  if (s === 'consult') return 'consult'
  if (s === 'session') return 'session'
  if (s === 'aftercare') return 'aftercare'
  return null
}

function parseBooking(v: unknown): SessionBooking | null {
  if (!isRecord(v)) return null
  const id = getString(v.id)
  if (!id || !id.trim()) return null

  const serviceName = getString(v.serviceName) ?? undefined
  const clientName = getString(v.clientName) ?? undefined
  const scheduledFor = getString(v.scheduledFor)
  const sessionStep = getString(v.sessionStep)

  return {
    id: id.trim(),
    serviceName: serviceName?.trim() || undefined,
    clientName: clientName?.trim() || undefined,
    scheduledFor: scheduledFor?.trim() || null,
    sessionStep: sessionStep?.trim() || null,
  }
}

function parseCenter(v: unknown): CenterState {
  if (!isRecord(v)) return DEFAULT_CENTER

  const labelRaw = getString(v.label)
  const label = labelRaw && labelRaw.trim() ? labelRaw.trim() : 'Start'

  const action = normalizeAction(v.action)

  const hrefRaw = v.href
  const href = isSafeInternalHref(hrefRaw) ? hrefRaw : null

  return { label, action, href }
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

function nextHrefFromStartFinish(data: unknown): string | null {
  const href = getStringProp(data, 'nextHref')
  return isSafeInternalHref(href) ? href : null
}

export function useProSession() {
  const router = useRouter()
  const pathname = usePathname()

  const [mode, setMode] = useState<UiSessionMode>('IDLE')
  const [booking, setBooking] = useState<SessionBooking | null>(null)
  const [targetStep, setTargetStep] = useState<StepKey | null>(null)
  const [center, setCenter] = useState<CenterState>(DEFAULT_CENTER)

  const [loading, setLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState<'start' | 'nav' | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Concurrency + freshness
  const inFlightRef = useRef<AbortController | null>(null)
  const reqIdRef = useRef(0)
  const lastLoadAtRef = useRef<number>(0)
  const redirectedRef = useRef(false)

  // Scheduling
  const pollTimerRef = useRef<number | null>(null)
  const visTimerRef = useRef<number | null>(null)
  const didInitRef = useRef(false)

  const bookingId = booking?.id ? String(booking.id) : null

  const centerDisabled = useMemo(() => {
    return !canClickCenter({
      actionLoading,
      action: center.action,
      href: center.href,
      bookingId,
    })
  }, [actionLoading, center.action, center.href, bookingId])

  const applyIdle = useCallback((opts?: LoadOpts, res?: Response, data?: unknown) => {
    setMode('IDLE')
    setBooking(null)
    setTargetStep(null)
    setCenter(DEFAULT_CENTER)
    if (!opts?.silent && res) setError(errorFromResponse(res, data))
  }, [])

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current == null) return
    window.clearTimeout(pollTimerRef.current)
    pollTimerRef.current = null
  }, [])

  const scheduleNextPoll = useCallback(
    (loadSessionFn: (opts?: LoadOpts) => Promise<ProSessionPayload | null>) => {
      stopPolling()
      // small jitter prevents all clients hitting at exactly the same time
      const jitter = Math.floor(Math.random() * 1500)
      pollTimerRef.current = window.setTimeout(() => {
        if (document.visibilityState !== 'visible') return
        void loadSessionFn({ silent: true })
        scheduleNextPoll(loadSessionFn)
      }, POLL_MS + jitter)
    },
    [stopPolling],
  )

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

      const timeoutId = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

      try {
        const res = await fetch('/api/pro/session', {
          method: 'GET',
          cache: 'no-store',
          signal: controller.signal,
        })

        // stale response guard
        if (reqIdRef.current !== myReqId) return null

        if (res.status === 401) {
          if (!redirectedRef.current) {
            redirectedRef.current = true
            redirectToLogin(router, 'pro-session')
          }
          return null
        }

        redirectedRef.current = false

        const data = await safeJson(res)

        const ok = getBoolProp(data, 'ok') === true
        if (!res.ok || !ok) {
          applyIdle(opts, res, data)
          return null
        }

        // Parse payload safely into canonical UI types
        const nextMode = normalizeMode(isRecord(data) ? data.mode : null)

        const nextBooking = parseBooking(isRecord(data) ? data.booking : null)
        const nextTarget = normalizeStepKey(isRecord(data) ? data.targetStep : null)
        const nextCenter = parseCenter(isRecord(data) ? data.center : null)

        setMode(nextMode)
        setBooking(nextBooking)
        setTargetStep(nextTarget)
        setCenter(nextCenter)

        const payload: ProSessionPayload = {
          ok: true,
          mode: nextMode,
          booking: nextBooking,
          targetStep: nextTarget,
          center: nextCenter,
        }

        return payload
      } catch (err: unknown) {
        // Abort is expected during force refresh / route changes
        if (err instanceof DOMException && err.name === 'AbortError') return null
        if (!opts?.silent) setError('Network error loading session.')
        return null
      } finally {
        window.clearTimeout(timeoutId)
        if (reqIdRef.current === myReqId) {
          if (inFlightRef.current === controller) inFlightRef.current = null
          if (!opts?.silent) setLoading(false)
        }
      }
    },
    [applyIdle, router],
  )

  // Initial load + visibility/focus management + polling (visible only)
  useEffect(() => {
    didInitRef.current = true

    const onVisibility = () => {
      if (visTimerRef.current) window.clearTimeout(visTimerRef.current)
      visTimerRef.current = window.setTimeout(() => {
        if (document.visibilityState === 'visible') {
          void loadSession({ silent: true, force: true })
          scheduleNextPoll(loadSession)
        } else {
          stopPolling()
        }
      }, VISIBILITY_DEBOUNCE_MS)
    }

    // initial load (non-silent) and start polling if visible
    void loadSession({ silent: false, force: true })
    if (document.visibilityState === 'visible') scheduleNextPoll(loadSession)

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onVisibility)

    return () => {
      stopPolling()
      if (visTimerRef.current) window.clearTimeout(visTimerRef.current)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onVisibility)
      inFlightRef.current?.abort()
      inFlightRef.current = null
    }
  }, [loadSession, scheduleNextPoll, stopPolling])

  // Route change refresh (forced) — portal footers don’t unmount
  useEffect(() => {
    if (!didInitRef.current) return
    void loadSession({ silent: true, force: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])

  // External force refresh (aftercare send, etc.)
  useEffect(() => {
    const onForce = () => void loadSession({ silent: true, force: true })
    window.addEventListener(FORCE_EVENT, onForce)
    return () => window.removeEventListener(FORCE_EVENT, onForce)
  }, [loadSession])

  const handleCenterClick = useCallback(async () => {
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

        const nextHref = nextHrefFromStartFinish(data)
        const fresh = await loadSession({ silent: true, force: true })
        const freshHref = fresh?.center?.href ?? null

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

        const nextHref = nextHrefFromStartFinish(data)
        const fresh = await loadSession({ silent: true, force: true })
        const freshHref = fresh?.center?.href ?? null

        const target = nextHref ?? freshHref ?? fallbackHub
        if (target === currentPathWithQuery()) router.refresh()
        else router.push(target)
        return
      }

      if (center.action === 'NAVIGATE' || center.action === 'CAPTURE_BEFORE' || center.action === 'CAPTURE_AFTER') {
        setActionLoading('nav')
        const target = isSafeInternalHref(center.href) ? center.href : fallbackHub
        if (target === currentPathWithQuery()) router.refresh()
        else router.push(target)
        return
      }

      router.push(fallbackHub)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Something went wrong.'
      setError(msg)
    } finally {
      setActionLoading(null)
    }
  }, [bookingId, center.action, center.href, centerDisabled, loadSession, router])

  const displayLabel = useMemo(() => {
    if (actionLoading === 'start') return 'Starting…'
    if (actionLoading === 'nav') return 'Opening…'
    return center.label
  }, [actionLoading, center.label])

  return {
    pathname,
    mode,
    booking,
    targetStep,
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