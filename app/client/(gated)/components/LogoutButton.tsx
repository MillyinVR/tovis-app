// app/client/components/LogoutButton.tsx
'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { hardNavigate } from '@/lib/hardNavigate'

export default function LogoutButton({ className }: { className?: string }) {
  const [loading, setLoading] = useState(false)

  async function onLogout() {
    if (loading) return
    setLoading(true)

    await fetch('/api/v1/auth/logout', {
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
      onClick={onLogout}
      disabled={loading}
      className={cn(
        'inline-flex items-center justify-center rounded-full border px-3 py-1.5 text-[12px] font-black transition',
        'border-white/10 bg-bgSecondary text-textPrimary hover:border-white/20',
        loading ? 'opacity-60 cursor-not-allowed' : '',
        className ?? '',
      )}
    >
      {loading ? 'Signing out…' : 'Sign out'}
    </button>
  )
}