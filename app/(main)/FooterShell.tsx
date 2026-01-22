'use client'

import { usePathname } from 'next/navigation'
import ProSessionFooterPortal from '@/app/pro/_components/ProSessionFooter/ProSessionFooterPortal'
import ClientSessionFooterPortal from '@/app/_components/ClientSessionFooter/ClientSessionFooterPortal'

export default function FooterShell({ role }: { role: 'PRO' | 'CLIENT' | 'ADMIN' | 'GUEST' }) {
  const pathname = usePathname()

  // Hide global footer on auth pages
  if (pathname?.startsWith('/login') || pathname?.startsWith('/signup')) return null

  // ✅ Pros always get the pro footer everywhere
  if (role === 'PRO') return <ProSessionFooterPortal />

  // ✅ Clients get their own footer
  if (role === 'CLIENT') return <ClientSessionFooterPortal />

  // Admin / guest: nothing for now
  return null
}
