// app/_components/FooterShell.tsx
'use client'

import { createPortal } from 'react-dom'
import { useLayoutEffect, useMemo, useState } from 'react'
import { usePathname } from 'next/navigation'

import ProSessionFooter from '@/app/_components/ProSessionFooter/ProSessionFooter'
import ClientSessionFooter from '@/app/_components/ClientSessionFooter/ClientSessionFooter'
import AdminSessionFooter from '@/app/_components/AdminSessionFooter/AdminSessionFooter'
import GuestSessionFooter from '@/app/_components/GuestSessionFooter/GuestSessionFooter'

export type AppRole = 'PRO' | 'CLIENT' | 'ADMIN' | 'GUEST'

type Props = { role: AppRole; messagesBadge?: string | null }

const MOUNT_ID = 'tovis-footer-mount'

function setFooterSpace(px: number) {
  document.documentElement.style.setProperty('--app-footer-space', `${px}px`)
}

function startsWithSegment(pathname: string, base: string) {
  return pathname === base || pathname.startsWith(`${base}/`)
}

function inferFooterFromPath(pathname: string | null): AppRole | null {
  if (!pathname) return null
  if (startsWithSegment(pathname, '/admin')) return 'ADMIN'
  if (startsWithSegment(pathname, '/pro')) return 'PRO'
  if (startsWithSegment(pathname, '/client')) return 'CLIENT'
  return null
}

export default function FooterShell({ role, messagesBadge }: Props) {
  const pathname = usePathname()

  const effectiveRole: AppRole = useMemo(() => {
    const fromPath = inferFooterFromPath(pathname ?? null)
    // Never show privileged footer UI to a guest just because they’re on /pro/*.
    if (role === 'GUEST') return 'GUEST'
    return fromPath ?? role
  }, [pathname, role])

  const [mountEl, setMountEl] = useState<HTMLElement | null>(null)

  // Acquire mount. Retry once via rAF (covers rare HMR/hydration timing).
  useLayoutEffect(() => {
    const el = document.getElementById(MOUNT_ID)
    if (el) {
      setMountEl(el)
      return
    }

    const raf = window.requestAnimationFrame(() => {
      setMountEl(document.getElementById(MOUNT_ID))
    })

    return () => window.cancelAnimationFrame(raf)
  }, [])

  // Measure mount height and keep CSS var synced.
  // Keep deps length stable (mountEl, effectiveRole, messagesBadge).
  useLayoutEffect(() => {
    if (!mountEl) return

    const update = () => {
      const h = Math.ceil(mountEl.getBoundingClientRect().height)
      setFooterSpace(Number.isFinite(h) ? h : 0)
    }

    update()
    const ro = new ResizeObserver(update)
    ro.observe(mountEl)

    return () => {
      ro.disconnect()
      setFooterSpace(0) // don’t leave padding stuck if unmounted in dev/HMR
    }
  }, [mountEl, effectiveRole, messagesBadge])

  if (!mountEl) return null

  const node =
    effectiveRole === 'PRO' ? (
      <ProSessionFooter messagesBadge={messagesBadge ?? null} />
    ) : effectiveRole === 'CLIENT' ? (
      <ClientSessionFooter messagesBadge={messagesBadge ?? null} />
    ) : effectiveRole === 'ADMIN' ? (
      <AdminSessionFooter />
    ) : (
      <GuestSessionFooter />
    )

  return createPortal(node, mountEl)
}