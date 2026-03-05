// app/client/components/LogoutButton.tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'

export default function LogoutButton({ className }: { className?: string }) {
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function onLogout() {
    if (loading) return
    setLoading(true)

    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
      })
    } finally {
      // Hard nav: guarantees server components re-evaluate with cleared cookie
      window.location.assign('/login')
      // (router.replace('/login') also works, hard nav is just more stubborn/reliable)
    }
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
      {loading ? 'Logging out…' : 'Logout'}
    </button>
  )
}