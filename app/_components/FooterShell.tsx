// app/_components/FooterShell.tsx
'use client'

import { useEffect, useMemo } from 'react'
import { usePathname } from 'next/navigation'
import ProSessionFooterPortal from '@/app/_components/ProSessionFooter/ProSessionFooterPortal'
import ClientSessionFooterPortal from '@/app/_components/ClientSessionFooter/ClientSessionFooterPortal'
import AdminSessionFooterPortal from '@/app/_components/AdminSessionFooter/AdminSessionFooterPortal'
import GuestSessionFooterPortal from '@/app/_components/GuestSessionFooter/GuestSessionFooterPortal'

export type AppRole = 'PRO' | 'CLIENT' | 'ADMIN' | 'GUEST'

type Props = {
  role: AppRole
  messagesBadge?: string | null
}

function setFooterSpace(px: number) {
  if (typeof document === 'undefined') return
  document.documentElement.style.setProperty('--app-footer-space', `${px}px`)
}

function inferFooterFromPath(pathname: string | null): AppRole | null {
  if (!pathname) return null
  if (pathname.startsWith('/admin')) return 'ADMIN'
  if (pathname.startsWith('/pro')) return 'PRO'
  if (pathname.startsWith('/client')) return 'CLIENT'
  return null
}

export default function FooterShell({ role, messagesBadge }: Props) {
  const pathname = usePathname()

  const hideOnAuth =
    pathname?.startsWith('/login') ||
    pathname?.startsWith('/signup')

  // ✅ Route-first (truthy immediately), role as fallback (can lag)
  const effectiveRole: AppRole = useMemo(() => {
    const fromPath = inferFooterFromPath(pathname ?? null)
    return fromPath ?? role
  }, [pathname, role])

  useEffect(() => {
    if (hideOnAuth) {
      setFooterSpace(0)
      return
    }

    if (effectiveRole === 'PRO') setFooterSpace(100)
    else if (effectiveRole === 'CLIENT') setFooterSpace(90)
    else if (effectiveRole === 'ADMIN') setFooterSpace(92)
    else setFooterSpace(90)

    // ✅ cleanup so we never “stick” padding if component unmounts/changes fast
    return () => setFooterSpace(0)
  }, [effectiveRole, hideOnAuth])

  if (hideOnAuth) return null

  if (effectiveRole === 'PRO') return <ProSessionFooterPortal messagesBadge={messagesBadge ?? null} />
  if (effectiveRole === 'CLIENT') return <ClientSessionFooterPortal messagesBadge={messagesBadge ?? null} />
  if (effectiveRole === 'ADMIN') return <AdminSessionFooterPortal />
  return <GuestSessionFooterPortal />
}