'use client'

import { useState } from 'react'
import AuthShell from '../AuthShell'
import { cn } from '@/lib/utils'

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        'w-full rounded-card border px-3 py-2 text-sm outline-none transition',
        'border-surfaceGlass/10 bg-bgSecondary/35 text-textPrimary',
        'placeholder:text-textSecondary/70',
        'hover:border-surfaceGlass/16',
        'focus:border-accentPrimary/35 focus:ring-2 focus:ring-accentPrimary/15',
      )}
    />
  )
}

export default function ForgotPasswordClient() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (loading) return

    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/auth/password-reset/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })

      if (!res.ok) {
        setError('Could not send reset email right now. Please try again.')
        return
      }

      setSent(true)
    } catch {
      setError('Could not send reset email right now. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell
      title="Reset password"
      subtitle="We’ll email you a secure reset link."
    >
      {sent ? (
        <div className="grid gap-2 text-sm text-textSecondary">
          <div className="font-black text-textPrimary">Check your inbox</div>
          <div>
            If an account exists for{' '}
            <span className="font-black text-textPrimary">
              {email || 'that email'}
            </span>
            , you’ll get a reset link shortly.
          </div>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="grid gap-4">
          <label className="grid gap-1.5">
            <span className="text-xs font-black tracking-wide text-textSecondary">
              Email
            </span>
            <Input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              autoComplete="email"
              required
            />
          </label>

          {error ? (
            <div className="rounded-card border border-toneDanger/25 bg-toneDanger/10 px-3 py-2 text-sm font-bold text-toneDanger">
              {error}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={loading}
            className={cn(
              'group relative inline-flex w-full items-center justify-center overflow-hidden rounded-full px-4 py-2.5 text-sm font-black transition',
              'border border-accentPrimary/35 bg-accentPrimary/26 text-textPrimary',
              'before:pointer-events-none before:absolute before:inset-0 before:bg-[linear-gradient(110deg,transparent,rgba(255,255,255,0.10),transparent)] before:opacity-0 before:transition',
              'hover:bg-accentPrimary/30 hover:border-accentPrimary/45 hover:before:opacity-100',
              'focus:outline-none focus:ring-2 focus:ring-accentPrimary/20',
              loading ? 'cursor-not-allowed opacity-65' : 'cursor-pointer',
            )}
          >
            <span className="relative inline-flex items-center gap-2">
              <span>{loading ? 'Sending…' : 'Send reset link'}</span>
              <span
                aria-hidden="true"
                className="inline-block transition-transform duration-200 group-hover:translate-x-0.5"
              >
                →
              </span>
            </span>
          </button>
        </form>
      )}
    </AuthShell>
  )
}