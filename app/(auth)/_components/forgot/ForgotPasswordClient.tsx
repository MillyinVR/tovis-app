'use client'

import { useState } from 'react'
import AuthShell from '../AuthShell'
import FieldLabel from '../FieldLabel'
import Input from '../Input'
import PrimaryButton from '../PrimaryButton'

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
      const res = await fetch('/api/v1/auth/password-reset/request', {
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
            <FieldLabel>Email</FieldLabel>
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

          <PrimaryButton loading={loading} withArrow>
            {loading ? 'Sending…' : 'Send reset link'}
          </PrimaryButton>
        </form>
      )}
    </AuthShell>
  )
}