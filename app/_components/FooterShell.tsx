// app/_components/FooterShell.tsx
'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import ProSessionFooterPortal from '@/app/_components/ProSessionFooter/ProSessionFooterPortal'
import ClientSessionFooterPortal from '@/app/_components/ClientSessionFooter/ClientSessionFooterPortal'

export type AppRole = 'PRO' | 'CLIENT' | 'ADMIN' | 'GUEST'

type Props = {
  role: AppRole
  // optional client badge (aftercare unread count)
  clientInboxBadge?: string | null
}

function setFooterSpace(px: number) {
  if (typeof document === 'undefined') return
  document.documentElement.style.setProperty('--app-footer-space', `${px}px`)
}

export default function FooterShell({ role, clientInboxBadge }: Props) {
  const pathname = usePathname()

  const hideOnAuth =
    pathname?.startsWith('/login') ||
    pathname?.startsWith('/signup')

  useEffect(() => {
    // If footer hidden, also remove spacing.
    if (hideOnAuth) {
      setFooterSpace(0)
      return
    }

    // Match your actual footer needs:
    // PRO has 72 footer + ~28 center bump = ~100
    if (role === 'PRO') {
      setFooterSpace(100)
      return
    }

    // CLIENT: your client layout used 90px before
    if (role === 'CLIENT') {
      setFooterSpace(90)
      return
    }

    setFooterSpace(0)
  }, [role, hideOnAuth])

  if (hideOnAuth) return null

  if (role === 'PRO') return <ProSessionFooterPortal />
  if (role === 'CLIENT') return <ClientSessionFooterPortal inboxBadge={clientInboxBadge ?? null} />

  return null
}
