'use client'

import ProSessionFooter from '@/app/pro/ProSessionFooter'
// later you can add ClientFooter, GuestFooter, etc.

export default function FooterShell({ role }: { role: 'PRO' | 'CLIENT' | 'ADMIN' | 'GUEST' }) {
  // For now:
  if (role === 'PRO') return <ProSessionFooter />

  // Temporary basic footer for non-pro users (replace later)
  return (
    <div
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        height: 65,
        background: '#111',
        borderTop: '1px solid #333',
        zIndex: 200,
        display: 'grid',
        placeItems: 'center',
        color: '#fff',
        fontFamily: 'system-ui',
        fontSize: 12,
      }}
    >
      Footer placeholder ({role})
    </div>
  )
}
