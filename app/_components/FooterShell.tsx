// app/_components/FooterShell.tsx
'use client'

import { createPortal } from 'react-dom'
import { useCallback, useLayoutEffect, useMemo, useSyncExternalStore } from 'react'
import { usePathname } from 'next/navigation'

import ProSessionFooter from '@/app/_components/ProSessionFooter/ProSessionFooter'
import ClientSessionFooter from '@/app/_components/ClientSessionFooter/ClientSessionFooter'
import AdminSessionFooter from '@/app/_components/AdminSessionFooter/AdminSessionFooter'
import GuestSessionFooter from '@/app/_components/GuestSessionFooter/GuestSessionFooter'

import type { WorkspaceOption } from '@/lib/auth/workspaces'

export type AppRole = 'PRO' | 'CLIENT' | 'ADMIN' | 'GUEST'

type Props = {
  role: AppRole
  messagesBadge?: string | null
  /** Workspaces the user can switch into (empty when only one). */
  workspaces?: WorkspaceOption[]
}

const MOUNT_ID = 'tovis-footer-mount'
const FOOTER_SPACE_VAR = '--app-footer-space'

function setFooterSpace(px: number): void {
  document.documentElement.style.setProperty(FOOTER_SPACE_VAR, `${px}px`)
}

function clearFooterSpace(): void {
  document.documentElement.style.setProperty(FOOTER_SPACE_VAR, '0px')
}

function startsWithSegment(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`)
}

function inferFooterFromPath(pathname: string | null): AppRole | null {
  if (!pathname) return null
  if (startsWithSegment(pathname, '/admin')) return 'ADMIN'
  if (startsWithSegment(pathname, '/pro')) return 'PRO'
  if (startsWithSegment(pathname, '/client')) return 'CLIENT'
  return null
}

function getFooterMountSnapshot(): HTMLElement | null {
  if (typeof document === 'undefined') return null
  return document.getElementById(MOUNT_ID)
}

function getFooterMountServerSnapshot(): HTMLElement | null {
  return null
}

function subscribeToFooterMount(onStoreChange: () => void): () => void {
  if (typeof document === 'undefined') return () => undefined

  let rafId: number | null = window.requestAnimationFrame(onStoreChange)

  const observer = new MutationObserver(() => {
    onStoreChange()
  })

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  })

  return () => {
    observer.disconnect()

    if (rafId !== null) {
      window.cancelAnimationFrame(rafId)
      rafId = null
    }
  }
}

function useFooterMount(): HTMLElement | null {
  return useSyncExternalStore(
    subscribeToFooterMount,
    getFooterMountSnapshot,
    getFooterMountServerSnapshot,
  )
}

export default function FooterShell({
  role,
  messagesBadge = null,
  workspaces = [],
}: Props) {
  const pathname = usePathname()
  const mountEl = useFooterMount()

  const effectiveRole: AppRole = useMemo(() => {
    const fromPath = inferFooterFromPath(pathname ?? null)

    // Never show privileged footer UI to a guest just because they are on /pro/*.
    if (role === 'GUEST') return 'GUEST'

    return fromPath ?? role
  }, [pathname, role])

  const updateFooterSpace = useCallback(() => {
    if (!mountEl) {
      clearFooterSpace()
      return
    }

    const height = Math.ceil(mountEl.getBoundingClientRect().height)
    setFooterSpace(Number.isFinite(height) ? height : 0)
  }, [mountEl])

  useLayoutEffect(() => {
    if (!mountEl) {
      clearFooterSpace()
      return
    }

    updateFooterSpace()

    const observer = new ResizeObserver(updateFooterSpace)
    observer.observe(mountEl)

    return () => {
      observer.disconnect()
      clearFooterSpace()
    }
  }, [mountEl, updateFooterSpace, effectiveRole, messagesBadge])

  if (!mountEl) return null

  const footerNode =
    effectiveRole === 'PRO' ? (
      <ProSessionFooter messagesBadge={messagesBadge} />
    ) : effectiveRole === 'CLIENT' ? (
      <ClientSessionFooter messagesBadge={messagesBadge} />
    ) : effectiveRole === 'ADMIN' ? (
      <AdminSessionFooter workspaces={workspaces} />
    ) : (
      <GuestSessionFooter />
    )

  return createPortal(footerNode, mountEl)
}