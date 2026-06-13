// app/_components/navigation/FooterSignOutItem.tsx
'use client'

import { useState } from 'react'
import { LogOut } from 'lucide-react'

import { hardNavigate } from '@/lib/hardNavigate'

export default function FooterSignOutItem() {
  const [loading, setLoading] = useState(false)

  async function onSignOut() {
    if (loading) return
    setLoading(true)

    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
    }).catch(() => null)

    // Hard nav: guarantees server components re-evaluate with cleared cookie
    hardNavigate('/login')
  }

  return (
    <button
      type="button"
      onClick={onSignOut}
      disabled={loading}
      className="bg-transparent p-0"
      style={{
        display: 'grid',
        gap: 2,
        justifyItems: 'center',
        color: 'rgba(122,117,105,1)',
        textShadow: '0 2px 12px rgba(0,0,0,0.8)',
        position: 'relative',
        cursor: loading ? 'not-allowed' : 'pointer',
        opacity: loading ? 0.6 : 1,
      }}
    >
      <span aria-hidden="true" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <LogOut size={20} />
      </span>

      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 9,
          fontWeight: 800,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
        }}
      >
        {loading ? 'Signing out…' : 'Sign out'}
      </span>
    </button>
  )
}
