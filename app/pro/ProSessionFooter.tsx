// app/pro/ProSessionFooter.tsx
'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import type { ProSessionPayload, SessionBooking, UiSessionCenterAction, UiSessionMode } from '@/lib/proSession/types'

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
  // Keep this permissive so adding new actions later doesn’t break the footer.
  if (s === 'START') return 'START'
  if (s === 'FINISH') return 'FINISH'
  if (s === 'NAVIGATE') return 'NAVIGATE'
  if (s === 'CAPTURE_BEFORE') return 'CAPTURE_BEFORE'
  if (s === 'CAPTURE_AFTER') return 'CAPTURE_AFTER'
  return 'NONE'
}

export default function ProSessionFooter() {
  const router = useRouter()
  const pathname = usePathname()

  // Don’t render on auth pages.
  if (!pathname) return null
  if (pathname.startsWith('/login') || pathname.startsWith('/signup')) return null

  const [mode, setMode] = useState<UiSessionMode>('IDLE')
  const [booking, setBooking] = useState<SessionBooking | null>(null)
  const [center, setCenter] = useState<{
    label: string
    action: UiSessionCenterAction
    href: string | null
  }>({ label: 'Start', action: 'NONE', href: null })

  const [loading, setLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState<'start' | 'finish' | 'nav' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const inFlightRef = useRef<AbortController | null>(null)
  const redirectedRef = useRef(false)

  const isReadyOrActive = mode === 'UPCOMING' || mode === 'ACTIVE'

  const centerDisabled = useMemo(() => {
    return !booking || loading || !!actionLoading || !isReadyOrActive || center.action === 'NONE'
  }, [booking, loading, actionLoading, isReadyOrActive, center.action])

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
      const data = (await safeJson(res)) as Partial<ProSessionPayload> & { ok?: boolean; error?: string }

      if (!res.ok || data?.ok !== true) {
        setMode('IDLE')
        setBooking(null)
        setCenter({ label: 'Start', action: 'NONE', href: null })
        setError(errorFromResponse(res, data))
        return
      }

      setMode(normalizeMode(data.mode))
      setBooking((data.booking as SessionBooking) ?? null)

      const c = data.center as any
      const label = typeof c?.label === 'string' && c.label.trim() ? c.label.trim() : 'Start'
      const action = normalizeAction(c?.action)
      const href = isSafeInternalHref(c?.href) ? (c.href as string) : null

      setCenter({ label, action, href })
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

  async function handleCenterClick() {
    if (!booking || centerDisabled) return
    setError(null)

    const bookingId = booking.id
    const fallbackBookingRoot = `/pro/bookings/${encodeURIComponent(bookingId)}`

    try {
      // START: POST /start, then navigate to server-specified href (or consult fallback)
      if (center.action === 'START') {
        setActionLoading('start')
        const res = await fetch(`/api/pro/bookings/${encodeURIComponent(bookingId)}/start`, { method: 'POST' })
        if (res.status === 401) return redirectToLogin(router, 'pro-start')
        const data = await safeJson(res)
        if (!res.ok) throw new Error(errorFromResponse(res, data))

        await loadSession({ silent: true })
        const target = center.href ?? `${fallbackBookingRoot}?step=consult`
        if (target === currentPathWithQuery()) {
          router.refresh()
        } else {
          router.push(target)
        }
        return
      }

      // FINISH: POST /finish, then navigate to server-decided nextHref.
      // If server says "stay here" (eg missing after media), show a real error.
      if (center.action === 'FINISH') {
        setActionLoading('finish')
        const res = await fetch(`/api/pro/bookings/${encodeURIComponent(bookingId)}/finish`, { method: 'POST' })
        if (res.status === 401) return redirectToLogin(router, 'pro-finish')
        const data = await safeJson(res)
        if (!res.ok) throw new Error(errorFromResponse(res, data))

        const nextHref = isSafeInternalHref(data?.nextHref) ? (data.nextHref as string) : null
        await loadSession({ silent: true })

        const target = nextHref ?? `${fallbackBookingRoot}/session/after-photos`

        // If "next" equals current, we are blocked. Do NOT pretend this is navigation.
        if (target === currentPathWithQuery()) {
          const afterCount = typeof data?.afterCount === 'number' ? data.afterCount : null
          if (afterCount === 0) {
            setError('Add at least one after photo to continue to aftercare.')
          } else {
            setError('Nothing to advance right now. Try again in a moment.')
          }
          router.refresh()
          return
        }

        router.push(target)
        return
      }

      // NAVIGATE / CAPTURE: go to center.href or booking root.
      if (center.action === 'NAVIGATE' || center.action === 'CAPTURE_BEFORE' || center.action === 'CAPTURE_AFTER') {
        setActionLoading('nav')
        const target = center.href ?? fallbackBookingRoot
        if (target === currentPathWithQuery()) {
          router.refresh()
        } else {
          router.push(target)
        }
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
    actionLoading === 'start'
      ? 'Starting…'
      : actionLoading === 'finish'
        ? 'Finishing…'
        : actionLoading === 'nav'
          ? 'Opening…'
          : center.label

  const showCameraIcon = displayLabel.trim().toLowerCase() === 'camera'
  const isActive = mode === 'ACTIVE'

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
