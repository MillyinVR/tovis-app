// app/signup/SignupClient.tsx
'use client'

import { useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

function safeJson(res: Response) {
  return res.json().catch(() => ({})) as Promise<any>
}

function sanitizeRole(v: string | null): 'CLIENT' | 'PRO' {
  const s = (v ?? '').toUpperCase()
  return s === 'PRO' ? 'PRO' : 'CLIENT'
}

function sanitizePhone(v: string) {
  // keep it simple: strip spaces. You'll normalize server-side later.
  return v.replace(/\s+/g, '')
}

function roleBtnStyle(isActive: boolean): React.CSSProperties {
  return {
    padding: '8px 12px',
    borderRadius: 999,
    border: isActive ? '1px solid #E2C878' : '1px solid rgba(255,255,255,0.25)',
    background: isActive ? 'rgba(226,200,120,0.18)' : 'transparent',
    color: isActive ? '#E2C878' : 'rgba(255,255,255,0.85)',
    cursor: 'pointer',
    fontWeight: isActive ? 700 : 500,
    boxShadow: isActive ? '0 0 0 3px rgba(226,200,120,0.12)' : 'none',
    transition: 'all 120ms ease',
  }
}

export default function SignupClient() {
  const router = useRouter()
  const sp = useSearchParams()

  const ti = sp.get('ti')
  const roleParam = sp.get('role')
  const roleFromQuery = useMemo(() => (roleParam ? sanitizeRole(roleParam) : null), [roleParam])
  const [role, setRole] = useState<'CLIENT' | 'PRO'>(roleFromQuery ?? 'CLIENT')

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  // Both roles use first/last now (PRO = legal name on license)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')

  const [phone, setPhone] = useState('') // SMS later, but store now

  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (loading) return

    setError(null)
    setLoading(true)

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          role,
          firstName,
          lastName,
          phone: phone ? sanitizePhone(phone) : undefined,
          tapIntentId: ti ?? undefined,
        }),
      })

      const data = await safeJson(res)

      if (!res.ok) {
        setError(data?.error || 'Signup failed.')
        return
      }

      router.refresh()

      const nextUrl = data?.nextUrl as string | undefined
      if (nextUrl && nextUrl.startsWith('/')) {
        router.replace(nextUrl)
        return
      }

      // If PRO, send to verification onboarding first.
      if (data?.user?.role === 'PRO') {
        router.replace('/pro/onboarding/verification')
      } else {
        router.replace('/client')
      }
    } catch (err) {
      console.error(err)
      setError('Network error.')
    } finally {
      setLoading(false)
    }
  }

  const surfaceText = '#e5e7eb'
  const mutedText = 'rgba(255,255,255,0.75)'
  const fieldBg = 'rgba(255,255,255,0.06)'
  const fieldBorder = 'rgba(255,255,255,0.18)'

  return (
    <div style={{ maxWidth: 520, margin: '40px auto', padding: 16, fontFamily: 'system-ui' }}>
      <h1 style={{ marginBottom: 12, color: surfaceText }}>Create account</h1>

      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <button type="button" onClick={() => setRole('CLIENT')} style={roleBtnStyle(role === 'CLIENT')}>
          Client
        </button>
        <button type="button" onClick={() => setRole('PRO')} style={roleBtnStyle(role === 'PRO')}>
          Professional
        </button>
      </div>

      <div style={{ fontSize: 12, color: mutedText, marginBottom: 12 }}>
        Selected:{' '}
        <b style={{ color: '#E2C878' }}>
          {role === 'PRO' ? 'Professional' : 'Client'}
        </b>
        {role === 'PRO' ? (
          <div style={{ marginTop: 6, fontSize: 12, color: mutedText }}>
            Use your legal name as it appears on your license.
          </div>
        ) : null}
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 12 }}>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={{ fontSize: 12, color: mutedText }}>First name</span>
          <input
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            required
            autoComplete="given-name"
            style={{
              padding: 10,
              borderRadius: 10,
              border: `1px solid ${fieldBorder}`,
              background: fieldBg,
              color: surfaceText,
              outline: 'none',
            }}
          />
        </label>

        <label style={{ display: 'grid', gap: 6 }}>
          <span style={{ fontSize: 12, color: mutedText }}>Last name</span>
          <input
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            required
            autoComplete="family-name"
            style={{
              padding: 10,
              borderRadius: 10,
              border: `1px solid ${fieldBorder}`,
              background: fieldBg,
              color: surfaceText,
              outline: 'none',
            }}
          />
        </label>

        <label style={{ display: 'grid', gap: 6 }}>
          <span style={{ fontSize: 12, color: mutedText }}>Phone (for SMS verification)</span>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            inputMode="tel"
            autoComplete="tel"
            placeholder="+1 (___) ___-____"
            style={{
              padding: 10,
              borderRadius: 10,
              border: `1px solid ${fieldBorder}`,
              background: fieldBg,
              color: surfaceText,
              outline: 'none',
            }}
          />
        </label>

        <label style={{ display: 'grid', gap: 6 }}>
          <span style={{ fontSize: 12, color: mutedText }}>Email</span>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            required
            autoComplete="email"
            style={{
              padding: 10,
              borderRadius: 10,
              border: `1px solid ${fieldBorder}`,
              background: fieldBg,
              color: surfaceText,
              outline: 'none',
            }}
          />
        </label>

        <label style={{ display: 'grid', gap: 6 }}>
          <span style={{ fontSize: 12, color: mutedText }}>Password</span>
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            required
            autoComplete="new-password"
            style={{
              padding: 10,
              borderRadius: 10,
              border: `1px solid ${fieldBorder}`,
              background: fieldBg,
              color: surfaceText,
              outline: 'none',
            }}
          />
        </label>

        {error ? <div style={{ color: '#fca5a5', fontSize: 13 }}>{error}</div> : null}

        <button
          type="submit"
          disabled={loading}
          style={{
            padding: 10,
            borderRadius: 999,
            border: '1px solid #E2C878',
            background: loading ? 'rgba(226,200,120,0.12)' : 'rgba(226,200,120,0.18)',
            color: '#E2C878',
            cursor: loading ? 'not-allowed' : 'pointer',
            fontWeight: 700,
          }}
        >
          {loading ? 'Creating…' : 'Create account'}
        </button>
      </form>
    </div>
  )
}
