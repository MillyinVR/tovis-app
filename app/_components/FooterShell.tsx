// app/_components/FooterShell.tsx
'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import ProSessionFooterPortal from '@/app/_components/ProSessionFooter/ProSessionFooterPortal'
import ClientSessionFooterPortal from '@/app/_components/ClientSessionFooter/ClientSessionFooterPortal'
import AdminSessionFooterPortal from '@/app/_components/AdminSessionFooter/AdminSessionFooterPortal'

export type AppRole = 'PRO' | 'CLIENT' | 'ADMIN' | 'GUEST'

type Props = {
  role: AppRole
  messagesBadge?: string | null
}

function setFooterSpace(px: number) {
  if (typeof document === 'undefined') return
  document.documentElement.style.setProperty('--app-footer-space', `${px}px`)
}

export default function FooterShell({ role, messagesBadge }: Props) {
  const pathname = usePathname()

  const hideOnAuth = pathname?.startsWith('/login') || pathname?.startsWith('/signup')

  useEffect(() => {
    if (hideOnAuth) {
      setFooterSpace(0)
      return
    }

    if (role === 'PRO') {
      setFooterSpace(100)
      return
    }

    if (role === 'CLIENT') {
      setFooterSpace(90)
      return
    }

    if (role === 'ADMIN') {
      // Admin footer is compact but still needs breathing room
      setFooterSpace(92)
      return
    }

    setFooterSpace(0)
  }, [role, hideOnAuth])

  if (hideOnAuth) return null

  if (role === 'PRO') return <ProSessionFooterPortal messagesBadge={messagesBadge ?? null} />
  if (role === 'CLIENT') return <ClientSessionFooterPortal messagesBadge={messagesBadge ?? null} />
  if (role === 'ADMIN') return <AdminSessionFooterPortal />

  return null
}
