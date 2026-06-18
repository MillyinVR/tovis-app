// app/(auth)/_components/reset/ResetPasswordClient.tsx

'use client'

import { useState } from 'react'
import AuthShell from '../AuthShell'
import FieldLabel from '../FieldLabel'
import PasswordInput from '../PasswordInput'
import PrimaryButton from '../PrimaryButton'

export default function ResetPasswordClient({ token }: { token: string }) {
  const [password, setPassword] = useState('')
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
            <FieldLabel>New password</FieldLabel>

            <PasswordInput
              value={password}
              onChange={(e) => setPassword(e.target.value)}
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

          <PrimaryButton loading={loading} withArrow>
            {loading ? 'Updating…' : 'Update password'}
          </PrimaryButton>
        </form>
      )}
    </AuthShell>
  )
}
