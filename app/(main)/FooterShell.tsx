// app/(main)/FooterShell.tsx
'use client'

import { usePathname } from 'next/navigation'
import ProSessionFooterPortal from '@/app/pro/_components/ProSessionFooter/ProSessionFooterPortal'

export default function FooterShell({ role }: { role: 'PRO' | 'CLIENT' | 'ADMIN' | 'GUEST' }) {
  const pathname = usePathname()

  // Hide global footer on auth pages
  if (pathname?.startsWith('/login') || pathname?.startsWith('/signup')) return null

  // ✅ Pros always get the pro footer everywhere
  if (role === 'PRO') {
    return <ProSessionFooterPortal />
  }

  // Everyone else can get whatever footer you want later
  return (
    <div
      className="border-t border-white/10 bg-bgPrimary text-textPrimary"
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        height: 65,
        zIndex: 100,
        display: 'grid',
        placeItems: 'center',
        fontFamily: 'system-ui',
        fontSize: 12,
      }}
    >
      Footer placeholder ({role})
    </div>
  )
}
