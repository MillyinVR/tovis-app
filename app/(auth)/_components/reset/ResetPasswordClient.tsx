// app/(auth)/_components/reset/ResetPasswordClient.tsx

'use client'

import { useState } from 'react'
import AuthShell from '../AuthShell'

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cx(
        'w-full rounded-card border px-3 py-2 text-sm outline-none transition',
        'border-surfaceGlass/10 bg-bgSecondary/35 text-textPrimary',
        'placeholder:text-textSecondary/70',
        'hover:border-surfaceGlass/16',
        'focus:border-accentPrimary/35 focus:ring-2 focus:ring-accentPrimary/15',
      )}
    />
  )
}

export default function ResetPasswordClient({ token }: { token: string }) {
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (loading) return
    setError(null)
    setLoading(true)

    try {
      const res = await fetch('/api/auth/password-reset/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      })

      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        setError(data?.error || 'Reset failed.')
        return
      }

      setDone(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell title="Choose a new password" subtitle="Make it something you won’t reuse everywhere.">
      {done ? (
        <div className="grid gap-2 text-sm text-textSecondary">
          <div className="font-black text-textPrimary">Password updated</div>
          <div>You can now sign in with your new password.</div>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="grid gap-4">
          <label className="grid gap-1.5">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-black tracking-wide text-textSecondary">New password</span>
              <button
                type="button"
                onClick={() => setShow((v) => !v)}
                className={cx(
                  'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-black transition',
                  'border-surfaceGlass/12 bg-bgPrimary/30 text-textSecondary',
                  'hover:border-surfaceGlass/18 hover:text-textPrimary',
                  'focus:outline-none focus:ring-2 focus:ring-accentPrimary/20',
                )}
              >
                {show ? 'Hide' : 'Show'}
              </button>
            </div>

            <Input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type={show ? 'text' : 'password'}
              required
              autoComplete="new-password"
              placeholder="At least 8 characters"
            />
            <span className="text-xs text-textSecondary/80">Use at least 8 characters.</span>
          </label>

          {error ? (
            <div className="rounded-card border border-toneDanger/25 bg-toneDanger/10 px-3 py-2 text-sm font-bold text-toneDanger">
              {error}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={loading}
            className={cx(
              'group relative inline-flex w-full items-center justify-center overflow-hidden rounded-full px-4 py-2.5 text-sm font-black transition',
              'border border-accentPrimary/35 bg-accentPrimary/26 text-textPrimary',
              'before:pointer-events-none before:absolute before:inset-0 before:bg-[linear-gradient(110deg,transparent,rgba(255,255,255,0.10),transparent)] before:opacity-0 before:transition',
              'hover:bg-accentPrimary/30 hover:border-accentPrimary/45 hover:before:opacity-100',
              'focus:outline-none focus:ring-2 focus:ring-accentPrimary/20',
              loading ? 'cursor-not-allowed opacity-65' : 'cursor-pointer',
            )}
          >
            <span className="relative inline-flex items-center gap-2">
              <span>{loading ? 'Updating…' : 'Update password'}</span>
              <span aria-hidden="true" className="inline-block transition-transform duration-200 group-hover:translate-x-0.5">
                →
              </span>
            </span>
          </button>
        </form>
      )}
    </AuthShell>
  )
}
