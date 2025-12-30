// app/pro/ProSessionFooter.tsx
'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'

type UiSessionState = 'idle' | 'ready' | 'active'
type StepKey = 'consult' | 'session' | 'aftercare'

type SessionBooking = {
  id: string
  serviceName?: string
  clientName?: string
  scheduledFor?: string
  sessionStep?: string | null
}

type SessionPayload = {
  mode?: string
  sessionStep?: string | null
  targetStep?: StepKey | null
  centerLabel?: string
  centerAction?: 'GO_SESSION' | 'NONE'
  booking?: SessionBooking | null
  error?: string
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
  if (res.status === 401) return 'Please log in to continue.'
  if (res.status === 403) return 'You don’t have access to do that.'
  return `Request failed (${res.status}).`
}

function normalizeUiState(data: SessionPayload): UiSessionState {
  const m = String(data?.mode || '').toUpperCase()
  if (m === 'ACTIVE') return 'active'
  if (m === 'UPCOMING') return 'ready'
  return 'idle'
}

function isCameraLabel(label: string) {
  return label.trim().toLowerCase() === 'camera'
}

function proBookingHref(bookingId: string, step?: StepKey | null) {
  const base = `/pro/bookings/${encodeURIComponent(bookingId)}`
  if (!step) return base
  return `${base}?step=${encodeURIComponent(step)}`
}

export default function ProSessionFooter() {
  const router = useRouter()
  const pathname = usePathname()

  if (!pathname) return null
  if (pathname.startsWith('/login') || pathname.startsWith('/signup')) return null

  const [sessionState, setSessionState] = useState<UiSessionState>('idle')
  const [booking, setBooking] = useState<SessionBooking | null>(null)
  const [centerLabel, setCenterLabel] = useState('Start')
  const [targetStep, setTargetStep] = useState<StepKey>('consult')

  const [loading, setLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState<'start' | 'nav' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const inFlightRef = useRef<AbortController | null>(null)
  const redirectedRef = useRef(false)

  async function loadSession(opts?: { silent?: boolean }) {
    inFlightRef.current?.abort()
    const controller = new AbortController()
    inFlightRef.current = controller

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

      if (res.status === 401) {
        if (!redirectedRef.current) {
          redirectedRef.current = true
          redirectToLogin(router, 'pro-session')
        }
        return
      }

      redirectedRef.current = false
      const data = (await safeJson(res)) as SessionPayload

      if (!res.ok) {
        setSessionState('idle')
        setBooking(null)
        setCenterLabel('Start')
        setTargetStep('consult')
        setError(errorFromResponse(res, data))
        return
      }

      setSessionState(normalizeUiState(data))
      setBooking(data.booking ?? null)

      const lbl =
        typeof data.centerLabel === 'string' && data.centerLabel.trim()
          ? data.centerLabel.trim()
          : 'Start'
      setCenterLabel(lbl)

      const ts = data.targetStep
      setTargetStep(ts === 'consult' || ts === 'session' || ts === 'aftercare' ? ts : 'consult')
    } catch (err: any) {
      if (err?.name === 'AbortError') return
      if (!opts?.silent) setError('Network error loading session.')
    } finally {
      if (inFlightRef.current === controller) inFlightRef.current = null
      if (!opts?.silent) setLoading(false)
    }
  }

  useEffect(() => {
    loadSession()
    const id = setInterval(() => loadSession({ silent: true }), 15_000)
    return () => {
      clearInterval(id)
      inFlightRef.current?.abort()
      inFlightRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    loadSession({ silent: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])

  useEffect(() => {
    function onFocus() {
      loadSession({ silent: true })
    }
    function onVisibility() {
      if (document.visibilityState === 'visible') loadSession({ silent: true })
    }

    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const isActive = sessionState === 'active'
  const isReady = sessionState === 'ready'
  const centerDisabled = !booking || loading || !!actionLoading || (!isReady && !isActive)

  async function handleCenterClick() {
    if (!booking || centerDisabled) return

    const bookingId = booking.id
    setError(null)

    try {
      if (sessionState === 'ready') {
        setActionLoading('start')

        const res = await fetch(`/api/pro/bookings/${encodeURIComponent(bookingId)}/start`, { method: 'POST' })
        if (res.status === 401) return redirectToLogin(router, 'pro-start')
        const data = await safeJson(res)

        if (!res.ok) {
          // ✅ Show backend error (e.g., waiting for client approval)
          throw new Error(errorFromResponse(res, data))
        }

        await loadSession({ silent: true })
        router.push(proBookingHref(bookingId, targetStep))
        return
      }

      if (sessionState === 'active') {
        setActionLoading('nav')
        router.push(proBookingHref(bookingId, targetStep))
        return
      }
    } catch (err: any) {
      setError(err?.message || 'Something went wrong.')
    } finally {
      setActionLoading(null)
    }
  }

  function isActivePath(href: string) {
    if (!pathname) return false
    if (href === '/pro') return pathname === '/pro'
    return pathname === href || pathname.startsWith(href + '/')
  }

  const displayLabel =
    actionLoading === 'start' ? 'Starting…' : actionLoading === 'nav' ? 'Opening…' : centerLabel
  const showCameraIcon = isCameraLabel(centerLabel)

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        height: 65,
        background: '#111',
        display: 'flex',
        justifyContent: 'space-around',
        alignItems: 'center',
        color: '#fff',
        zIndex: 200,
        borderTop: '1px solid #333',
        fontFamily: 'system-ui',
      }}
    >
      <NavItem label="Home" href="/pro" icon="🏠" active={isActivePath('/pro')} />
      <NavItem label="Calendar" href="/pro/calendar" icon="📅" active={isActivePath('/pro/calendar')} />

      <button
        type="button"
        onClick={handleCenterClick}
        disabled={centerDisabled}
        title={booking ? `${booking.serviceName ?? 'Service'} • ${booking.clientName ?? ''}` : 'No upcoming session'}
        style={{
          width: 60,
          height: 60,
          borderRadius: '50%',
          border: 'none',
          background: centerDisabled ? '#374151' : isActive ? '#ef4444' : '#3b82f6',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 11,
          fontWeight: 700,
          marginTop: -25,
          boxShadow: centerDisabled ? 'none' : '0 4px 10px rgba(0,0,0,0.3)',
          cursor: centerDisabled ? 'not-allowed' : 'pointer',
          color: '#fff',
          opacity: actionLoading ? 0.85 : 1,
        }}
      >
        {showCameraIcon ? '📷' : displayLabel}
      </button>

      <NavItem label="Messages" href="/pro/messages" icon="💬" active={isActivePath('/pro/messages')} />
      <NavItem label="Profile" href="/pro/public-profile" icon="👤" active={isActivePath('/pro/public-profile')} />

      {error && (
        <div
          style={{
            position: 'absolute',
            bottom: 68,
            right: 10,
            background: '#b91c1c',
            color: '#fff',
            borderRadius: 8,
            padding: '6px 10px',
            fontSize: 11,
            maxWidth: 280,
          }}
        >
          {error}
        </div>
      )}
    </div>
  )
}

function NavItem({ label, href, icon, active }: { label: string; href: string; icon: string; active?: boolean }) {
  return (
    <Link
      href={href}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        fontSize: 11,
        color: active ? '#60a5fa' : '#fff',
        textDecoration: 'none',
        gap: 1,
      }}
    >
      <span style={{ fontSize: 18 }}>{icon}</span>
      <span>{label}</span>
    </Link>
  )
}
